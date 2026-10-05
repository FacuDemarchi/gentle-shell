import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProjectMapCommand as runProjectMapCommandWithGate, type ProjectMapCommandContext } from "../extensions/gentle-project-map.ts";
import { bindProjectMapStoreWorktree } from "../lib/project-map-store-worktrees.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { readProjectMapStoreReadinessReceipts } from "../lib/project-map-store-receipts.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { PROJECT_MAP_EXECUTABLE_ENV } from "../lib/shell-project-map-gate.ts";
import { PROJECT_MAP_LEAD_CAPABILITY_ID } from "../lib/project-map-coordination-state.ts";
import { PROJECT_MAP_SCHEMA_V1, serializeProjectMap, type ProjectMapV1 } from "../lib/shell-project-map-schema.ts";

/**
 * PM9-3: the end-to-end scenarios the roadmap names, over a real clone with two real
 * worktrees, a real Git history and one real coordination store.
 *
 * Unit tests already cover each mechanism in isolation. What these cases add is the seam
 * between them: two sessions in two worktrees of one clone, a session that died, a record
 * that rotted, and readiness measured against a real branch. Two of them pin defects found
 * here rather than fixed here — each is marked, and each is recorded as debt in
 * `odd/tasks/pm-9-rollout-e2e.md` because a fix is a behavior change of a closed unit and
 * needs its own candidate and its own decision.
 */
const NOW = new Date("2026-09-27T12:00:00.000Z");
/** Far beyond any lease: the point is that the previous holder is gone, not how long it waited. */
const LATER = new Date("2026-09-27T12:30:00.000Z");
const EPOCH = "123e4567-e89b-12d3-a456-426614174002";
const ENABLED_ENV: NodeJS.ProcessEnv = { [PROJECT_MAP_EXECUTABLE_ENV]: "1" };

interface Harness {
	ctx: ProjectMapCommandContext;
	notified: string[];
}

function harness(cwd: string, sessionId: string): Harness {
	const notified: string[] = [];
	const ctx: ProjectMapCommandContext = {
		cwd,
		hasUI: true,
		ui: { notify: (message: string) => { notified.push(message); }, confirm: async () => true },
		sessionManager: { getSessionId: () => sessionId },
	};
	return { ctx, notified };
}

function run(command: string, ctx: ProjectMapCommandContext, now: Date) {
	return runProjectMapCommandWithGate(command, ctx, { env: ENABLED_ENV, now: () => now } as never);
}

function map(): ProjectMapV1 {
	return {
		version: PROJECT_MAP_SCHEMA_V1,
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "approved", approvedAt: NOW.toISOString(), approvedBy: "human" },
		foundations: [],
		capabilities: [{ id: "catalog", outcome: "Catalog is available.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: ["odd/tasks/catalog.md"], surfaces: ["web"], state: "ready" }],
	};
}

interface Clone {
	main: string;
	satellite: string;
	store: string;
	artifact: string;
	baseCommit: string;
	git: (cwd: string, arguments_: string[]) => string;
}

/**
 * One clone, two worktrees, one store. The satellite worktree is created from the commit that
 * already carries the map and the project's own test command, so both worktrees read the same
 * approved plan, and the store lives under the shared Git common directory as designed.
 */
function withClone(runScenario: (clone: Clone) => Promise<void> | void): Promise<void> {
	const sandbox = mkdtempSync(join(tmpdir(), "pm9-e2e-"));
	const main = join(sandbox, "example-shop");
	const satellite = join(sandbox, "example-shop-catalog");
	mkdirSync(main, { recursive: true });
	const empty = join(sandbox, "empty-config");
	mkdirSync(empty);
	const config = join(empty, "config");
	writeFileSync(config, "", "utf8");
	const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
	const git = (cwd: string, arguments_: string[]) => String(execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...arguments_], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
	git(main, ["init", "--initial-branch=main"]);
	mkdirSync(join(main, "openspec"), { recursive: true });
	writeFileSync(join(main, "openspec", "config.yaml"), "apply:\n  test_command: node --test\n", "utf8");
	const artifact = join(main, "openspec", "project-map.json");
	writeFileSync(artifact, serializeProjectMap(map()), "utf8");
	writeFileSync(join(main, "README.md"), "start\n", "utf8");
	// The capability declares a feature document with open tasks, so the `tasks` check can agree
	// with a declared state of `ready`: without it the candidate stays unverified for a reason
	// that has nothing to do with what this scenario measures.
	mkdirSync(join(main, "odd", "tasks"), { recursive: true });
	writeFileSync(join(main, "odd", "tasks", "catalog.md"), "- [x] one\n- [ ] two\n", "utf8");
	git(main, ["add", "-A"]);
	git(main, ["commit", "-m", "init"]);
	const baseCommit = git(main, ["rev-parse", "HEAD"]).trim();
	git(main, ["worktree", "add", "-b", "feat/catalog", satellite]);
	const resolved = resolveProjectMapStoreRoot(main);
	assert.ok(resolved.root && resolved.repositoryId, resolved.diagnostics.map((entry) => entry.message).join("\n"));
	mkdirSync(resolved.root, { recursive: true, mode: 0o700 });
	const initialized = initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW.toISOString() });
	assert.ok(initialized.descriptor, initialized.diagnostics.map((entry) => entry.message).join("\n"));
	return Promise.resolve(runScenario({ main, satellite, store: resolved.root, artifact, baseCommit, git })).finally(() => rmSync(sandbox, { recursive: true, force: true }));
}

function claimPath(store: string, capabilityId: string): string {
	return join(store, "claims", `${createHash("sha256").update(capabilityId).digest("hex")}.json`);
}

function storeFiles(store: string): string[] {
	const listed: string[] = [];
	const walk = (directory: string) => {
		for (const name of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, name.name);
			if (name.isDirectory()) walk(path);
			else listed.push(path);
		}
	};
	walk(store);
	return listed.sort();
}

test("two sessions in two worktrees of one clone share one coordination store", async () => {
	await withClone(async ({ main, satellite, store }) => {
		const lead = harness(main, "lead-session");
		const claimed = await run("lead claim", lead.ctx, NOW);
		assert.deepEqual(claimed.diagnostics, []);
		assert.ok(lead.notified.some((message) => /Claimed the Project Map lead claim/.test(message)), lead.notified.join("\n"));

		// The satellite is a different session in a different worktree and sees the same claim.
		const remote = harness(satellite, "satellite-session");
		await run("lead status", remote.ctx, NOW);
		assert.ok(remote.notified.some((message) => /Lead is live: lead-session/.test(message)), remote.notified.join("\n"));

		// A contract proposed from the satellite worktree lands in the shared store.
		const body = join(satellite, "pricing.md");
		writeFileSync(body, "price shape\n", "utf8");
		const proposed = await run(`contract propose catalog pricing Pricing ${body}`, remote.ctx, NOW);
		assert.deepEqual(proposed.diagnostics, []);
		assert.ok(remote.notified.some((message) => /Proposed contract pricing for catalog/.test(message)), remote.notified.join("\n"));
		assert.equal(readdirSync(join(store, "contracts")).length > 0, true, "the proposal is a durable shared record");
	});
});

test("a session that died is recovered by the next claim, and the store loses nothing", async () => {
	await withClone(async ({ main, store }) => {
		await run("lead claim", harness(main, "dead-session").ctx, NOW);
		const before = storeFiles(store);
		const claimFile = claimPath(store, PROJECT_MAP_LEAD_CAPABILITY_ID);
		const heldByDeadSession = readFileSync(claimFile, "utf8");
		assert.match(heldByDeadSession, /dead-session/);

		// The deadline passes with no renewal: the next session takes the claim over.
		const survivor = harness(main, "survivor-session");
		const recovered = await run("lead claim", survivor.ctx, LATER);
		assert.match(readFileSync(claimFile, "utf8"), /survivor-session/, "the claim moved to the new session");
		assert.match(recovered.diagnostics[0]?.code ?? "", /stale-claim-recovered/);
		assert.equal(recovered.diagnostics[0]?.severity, "warning");
		assert.deepEqual(storeFiles(store).sort(), before.sort(), "recovery deletes nothing");

		// F2's regression guard: the takeover succeeded — the record above proves it — and the report
		// now says so, surfacing the recovery warning instead of announcing a refusal.
		assert.equal(recovered.wrote, true, "something durable changed, and the report says so");
		assert.deepEqual(recovered.diagnostics.map((entry) => entry.severity), ["warning"]);
		assert.ok(survivor.notified.some((message) => /Claimed the Project Map lead claim/.test(message)), survivor.notified.join("\n"));
		assert.ok(survivor.notified.some((message) => /stale-claim-recovered/.test(message)), "the recovery warning is surfaced rather than swallowed");
		assert.equal(survivor.notified.some((message) => /was refused/.test(message)), false, "a recovery is never announced as a refusal");
	});
});

test("a corrupted record is refused, reported, and preserved rather than repaired", async () => {
	await withClone(async ({ main, store }) => {
		await run("lead claim", harness(main, "dead-session").ctx, NOW);
		const claimFile = claimPath(store, PROJECT_MAP_LEAD_CAPABILITY_ID);
		const corrupted = "{ not json";
		writeFileSync(claimFile, corrupted, "utf8");

		const reader = harness(main, "reader-session");
		const status = await run("lead status", reader.ctx, NOW);
		assert.equal(status.diagnostics.some((diagnostic) => /store-corrupted/.test(diagnostic.code)), true, reader.notified.join("\n"));
		const claimed = await run("lead claim", harness(main, "next-session").ctx, NOW);
		assert.equal(claimed.wrote, false, "a corrupted record is never silently replaced");
		assert.equal(readFileSync(claimFile, "utf8"), corrupted, "the corrupted bytes are preserved for a human, never repaired in place");
	});
});

test("readiness measures a real branch against the real integration target", async () => {
	await withClone(async ({ main, satellite, store, baseCommit }) => {
		const bound = bindProjectMapStoreWorktree({ root: store, capabilityId: "catalog", branch: "feat/catalog", worktreeRoot: satellite, sessionId: "satellite-session", baseCommit, now: NOW.toISOString() });
		assert.deepEqual(bound.diagnostics, []);

		const integrator = harness(main, "integrator-session");
		const report = await run("integrate", integrator.ctx, NOW);
		const text = integrator.notified.join("\n");
		assert.equal(report.wrote, false, "readiness probes Git and grants nothing");
		assert.match(text, /catalog/, "the bound candidate is named");
		assert.match(text, /behind main by 0/, "the base commit is contained in the target, and the distance is measured");
		assert.match(text, /Readiness grants nothing/, "the report repeats that it is not permission");

		// F1's regression guard: the run issues the first receipt itself, so the cycle is closed and
		// the vocabulary of readiness is reachable from a fresh store. It used to be impossible.
		const first = readProjectMapStoreReadinessReceipts({ root: store, capabilityId: "catalog", limit: 10 }).receipts.length;
		assert.equal(first, 1, "the first receipt comes from the first run");
		assert.match(text, /Next safe integration action: catalog/, "and a candidate can actually be ready");
		assert.match(text, /coverage: no readiness receipt recorded yet/, "the report still states the fact");
		const again = harness(main, "integrator-session");
		await run("integrate", again.ctx, NOW);
		assert.equal(readProjectMapStoreReadinessReceipts({ root: store, capabilityId: "catalog", limit: 10 }).receipts.length, 2, "every run records its own evidence, and the receipts accumulate by design");
	});
});
