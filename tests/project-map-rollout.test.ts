import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { runProjectMapCommand as runProjectMapCommandWithGate, type ProjectMapCommandContext } from "../extensions/gentle-project-map.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { PROJECT_MAP_EXECUTABLE_ENV } from "../lib/shell-project-map-gate.ts";
import { PROJECT_MAP_ARTIFACT_PATH, readProjectMapFile } from "../lib/shell-project-map-schema.ts";

/**
 * PM9-2: rolling the feature out must not disturb what a project already has.
 *
 * These cases drive the real command against real directories and compare exact byte
 * snapshots, because "it initialized the project" is only a safe claim when the delta is
 * provably one file. The artifact is `openspec/project-map.json` and nothing else: declaring
 * and approving rewrite that one file, regenerating a draft rewrites that one file, and the
 * shared coordination store — which lives outside the worktree by construction — is never
 * touched by any of it.
 */
const NOW = "2026-09-27T12:00:00.000Z";
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";
// The executable half is opt-in; this slice drives `draft`, `declare` and `approve`, which are
// the plan half and need no gate, but the fixture states the environment explicitly anyway.
const ENABLED_ENV: NodeJS.ProcessEnv = { [PROJECT_MAP_EXECUTABLE_ENV]: "1" };

interface Harness {
	ctx: ProjectMapCommandContext;
	notified: string[];
}

function harness(cwd: string): Harness {
	const notified: string[] = [];
	const ctx: ProjectMapCommandContext = {
		cwd,
		hasUI: true,
		ui: { notify: (message: string) => { notified.push(message); }, confirm: async () => true },
	};
	return { ctx, notified };
}

function run(command: string, ctx: ProjectMapCommandContext, options: Record<string, unknown> = {}) {
	return runProjectMapCommandWithGate(command, ctx, { env: ENABLED_ENV, now: () => new Date(NOW), ...options } as never);
}

/** Writes a set of repository-relative files under a fresh temporary directory. */
function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "pm9-rollout-"));
	for (const [relativePath, text] of Object.entries(files)) {
		const path = join(root, ...relativePath.split("/"));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text, "utf8");
	}
	return root;
}

/** Every file below a root, with the sha256 of its bytes and its size, in a stable order. */
function snapshot(root: string): Map<string, string> {
	const entries = new Map<string, string>();
	const walk = (directory: string) => {
		for (const name of readdirSync(directory).sort()) {
			const path = join(directory, name);
			const stats = statSync(path);
			if (stats.isDirectory()) walk(path);
			else entries.set(relative(root, path).split(sep).join("/"), createHash("sha256").update(readFileSync(path)).digest("hex"));
		}
	};
	walk(root);
	return entries;
}

/** What changed between two snapshots, as repository-relative paths. */
function delta(before: Map<string, string>, after: Map<string, string>): { added: string[]; removed: string[]; changed: string[] } {
	return {
		added: [...after.keys()].filter((path) => !before.has(path)).sort(),
		removed: [...before.keys()].filter((path) => !after.has(path)).sort(),
		changed: [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path)).sort(),
	};
}

test("a project with no openspec directory is initialized by creating exactly its artifact", async () => {
	const root = project({ "package.json": JSON.stringify({ name: "example-shop", version: "1.0.0" }), "README.md": "keep me\n" });
	try {
		const before = snapshot(root);
		const report = await run("draft", harness(root).ctx);
		assert.equal(report.wrote, true, "the draft is written");
		const after = snapshot(root);
		assert.deepEqual(delta(before, after), { added: [PROJECT_MAP_ARTIFACT_PATH], removed: [], changed: [] });
		// The directory did not exist before, so this proves the write path created it.
		assert.equal(existsSync(join(root, "openspec")), true);
		const artifact = readProjectMapFile(join(root, PROJECT_MAP_ARTIFACT_PATH));
		assert.ok(artifact.map !== null, "the artifact on disk validates");
		assert.equal(artifact.map.approval?.state, "draft", "a generated map is a draft, never approved");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a project that already has a config, feature documents and docs keeps every one byte-identical", async () => {
	const root = project({
		"package.json": JSON.stringify({ name: "example-shop", version: "1.0.0" }),
		"openspec/config.yaml": "apply:\n  test_command: node --test\n",
		"odd/tasks/example.md": "- [ ] **Example — ships something**\n",
		"docs/keep.md": "documentation that must survive\n",
	});
	try {
		const before = snapshot(root);
		const report = await run("draft", harness(root).ctx);
		assert.equal(report.wrote, true);
		const after = snapshot(root);
		assert.deepEqual(delta(before, after), { added: [PROJECT_MAP_ARTIFACT_PATH], removed: [], changed: [] });
		assert.equal(after.get("openspec/config.yaml"), before.get("openspec/config.yaml"));
		assert.equal(after.get("odd/tasks/example.md"), before.get("odd/tasks/example.md"));
		// The draft read the sources it says it read: the declared work unit became a capability.
		const artifact = readProjectMapFile(join(root, PROJECT_MAP_ARTIFACT_PATH));
		assert.equal(artifact.map?.capabilities.length, 1);
		assert.deepEqual(artifact.map?.capabilities[0]?.featureDocs, ["odd/tasks/example.md"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the declare and approve loop rewrites the artifact and nothing else", async () => {
	const root = project({
		"package.json": JSON.stringify({ name: "example-shop", version: "1.0.0" }),
		"odd/tasks/example.md": "- [ ] **Example — ships something**\n",
	});
	try {
		await run("draft", harness(root).ctx);
		const capabilityId = readProjectMapFile(join(root, PROJECT_MAP_ARTIFACT_PATH)).map!.capabilities[0]!.id;
		const beforeDeclaration = snapshot(root);
		const declared = await run(`declare ${capabilityId} web`, harness(root).ctx);
		assert.equal(declared.wrote, true);
		assert.deepEqual(delta(beforeDeclaration, snapshot(root)), { added: [], removed: [], changed: [PROJECT_MAP_ARTIFACT_PATH] });
		const beforeApproval = snapshot(root);
		const approved = await run("approve Facundo", harness(root).ctx);
		assert.equal(approved.wrote, true);
		assert.deepEqual(delta(beforeApproval, snapshot(root)), { added: [], removed: [], changed: [PROJECT_MAP_ARTIFACT_PATH] });
		const artifact = readProjectMapFile(join(root, PROJECT_MAP_ARTIFACT_PATH));
		assert.equal(artifact.map?.approval?.state, "approved");
		assert.equal(artifact.map?.approval?.approvedBy, "Facundo");
		assert.deepEqual(artifact.map?.capabilities[0]?.surfaces, ["web"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("regenerating the draft replaces the artifact and disturbs nothing else", async () => {
	const root = project({
		"package.json": JSON.stringify({ name: "example-shop", version: "1.0.0" }),
		"odd/tasks/example.md": "- [ ] **Example — ships something**\n",
	});
	try {
		await run("draft", harness(root).ctx);
		writeFileSync(join(root, "odd", "tasks", "example.md"), "- [ ] **Example — ships something**\n- [ ] **Checkout — takes money**\n", "utf8");
		const before = snapshot(root);
		const report = await run("draft", harness(root).ctx);
		assert.equal(report.wrote, true);
		assert.deepEqual(delta(before, snapshot(root)), { added: [], removed: [], changed: [PROJECT_MAP_ARTIFACT_PATH] });
		const artifact = readProjectMapFile(join(root, PROJECT_MAP_ARTIFACT_PATH));
		assert.equal(artifact.map?.capabilities.length, 2, "the regenerated draft reflects the new source");
		assert.equal(artifact.map?.approval?.state, "draft", "regenerating returns a draft, so the previous approval does not survive it");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("every Project Map surface on disk is pinned in the pack list", () => {
	// A source guard, not a packing proof: the real check is `node scripts/verify-package-files.mjs`,
	// which runs in `prepack`/`prepublishOnly` and inside this unit's evidence. What this pins is
	// that nobody adds a surface without pinning it, because a package that silently loses a
	// module is the worst way to find out.
	const script = readFileSync(join(import.meta.dirname, "..", "scripts", "verify-package-files.mjs"), "utf8");
	const pinned = new Set([...script.matchAll(/"((?:lib\/(?:project-map|shell-project-map)[^"]+|extensions\/gentle-project-map)\.ts)"/g)].map((match) => match[1]!));
	const onDisk = [
		...readdirSync(join(import.meta.dirname, "..", "lib")).filter((name) => /^(project-map|shell-project-map).*\.ts$/.test(name)).map((name) => `lib/${name}`),
		"extensions/gentle-project-map.ts",
	];
	const unpinned = onDisk.filter((path) => !pinned.has(path)).sort();
	assert.deepEqual(unpinned, [], "every surface is pinned by name in requiredPaths");
	assert.equal(pinned.size, onDisk.length, "and the pack list pins no surface that does not exist");
});
test("initializing a project leaves an existing coordination store byte-identical, and the store is outside the worktree", async () => {
	const sandbox = mkdtempSync(join(tmpdir(), "pm9-rollout-store-"));
	const root = join(sandbox, "example-shop");
	try {
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example-shop", version: "1.0.0" }), "utf8");
		execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		const resolved = resolveProjectMapStoreRoot(root);
		assert.ok(resolved.root !== null, "a git repository has a canonical store root");
		mkdirSync(resolved.root, { recursive: true });
		assert.ok(initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW }).descriptor);
		// The store lives under the Git common directory, which is not part of the working tree.
		assert.equal(relative(join(root, ".git"), resolved.root).startsWith(".."), false, "the store root is under the common directory");

		const beforeWorktree = snapshot(root);
		const beforeStore = snapshot(resolved.root);
		const report = await run("draft", harness(root).ctx);
		assert.equal(report.wrote, true);
		assert.deepEqual(snapshot(resolved.root), beforeStore, "the store is not written by initialization");
		assert.deepEqual(delta(beforeWorktree, snapshot(root)), { added: [PROJECT_MAP_ARTIFACT_PATH], removed: [], changed: [] });
		// Nothing the store holds can appear in the worktree delta above: it has no path there.
		assert.equal(existsSync(join(root, ".gentle-ai")), false);
		assert.equal(existsSync(join(root, "gentle-ai")), false);
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});
