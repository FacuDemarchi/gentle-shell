import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireProjectMapClaim } from "../lib/project-map-store-claims.ts";
import { beatProjectMapStoreHeartbeat, bindProjectMapStoreSession, projectMapStoreBindingProvesDead } from "../lib/project-map-store-heartbeats.ts";
import { ensureProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { PROJECT_MAP_STORE_DIAGNOSTIC_CODES, serializeProjectMapStoreValue } from "../lib/project-map-store-schema.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { deriveProjectMapWorktreeIdentity, inspectProjectMapWorktreeTarget, planProjectMapWorktree } from "../lib/project-map-worktrees.ts";

const EPOCH = "123e4567-e89b-12d3-a456-426614174000";
const INCARNATION = "123e4567-e89b-12d3-a456-426614174001";
const NOW = "2026-09-25T12:00:00.000Z";

function fixture(t: test.TestContext, { initialize = true }: { initialize?: boolean } = {}) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "project-map-worktrees-")));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const main = join(dir, "main.repo");
	const other = join(dir, "other");
	const empty = join(dir, "empty");
	mkdirSync(empty);
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
	Object.assign(env, { GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" });
	writeFileSync(join(empty, "config"), "");
	const git = (cwd: string, args: string[]) => execFileSync("git", ["-C", cwd, "-c", `core.hooksPath=${empty}`, "-c", "commit.gpgsign=false", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	git(dir, ["init", "--initial-branch=main", `--template=${empty}`, main]);
	git(main, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Fixture"]);
	git(dir, ["init", "--initial-branch=main", `--template=${empty}`, other]);
	const resolved = ensureProjectMapStoreRoot(main);
	assert.ok(resolved.root);
	assert.ok(resolved.repositoryId);
	if (initialize) {
		const initialized = initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW });
		assert.ok(initialized.descriptor);
	}
	return { dir, main, other, env, git, store: resolved.root };
}

function snapshot(path: string): Array<[string, string]> {
	const entries: Array<[string, string]> = [];
	const walk = (root: string, relative = "") => {
		for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const child = join(root, entry.name);
			const name = relative === "" ? entry.name : join(relative, entry.name);
			if (entry.isDirectory()) {
				entries.push([`${name}/`, "directory"]);
				walk(child, name);
			} else if (entry.isSymbolicLink()) entries.push([name, `symlink:${readlinkSync(child)}`]);
			else entries.push([name, `file:${createHash("sha256").update(readFileSync(child)).digest("hex")}`]);
		}
	};
	walk(path);
	return entries;
}

function sessionFilename(sessionId: string): string {
	return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

test("derives pure capability worktree identities at capability-id boundaries", () => {
	const root = "/work/project.map";
	for (const capabilityId of ["normal-id", "a".repeat(64), "many---hyphens---between---parts", "project-map"]) {
		assert.deepEqual(deriveProjectMapWorktreeIdentity({ repositoryRoot: root, capabilityId }), {
			branch: `feat/${capabilityId}`,
			path: join("/work", "project.map-worktrees", capabilityId),
		});
	}
});

test("inspects absent and present branches plus absent, empty, populated, and file target paths", (t) => {
	const f = fixture(t);
	const absent = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "absent", sessionId: "session", now: NOW });
	assert.equal(absent.branch.exists, false);
	assert.equal(absent.directory.exists, false);
	assert.equal(absent.directory.empty, true);
	assert.equal(absent.repository.sameClone, true);

	f.git(f.main, ["branch", "feat/present"]);
	const presentPath = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "present" }).path;
	mkdirSync(presentPath, { recursive: true });
	const present = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "present", sessionId: "session", now: NOW });
	assert.equal(present.branch.exists, true);
	assert.equal(present.branch.isCurrent, false);
	assert.equal(present.directory.exists, true);
	assert.equal(present.directory.empty, true);

	const contentPath = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "content" }).path;
	mkdirSync(contentPath, { recursive: true });
	writeFileSync(join(contentPath, "preexisting.txt"), "present\n");
	const content = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "content", sessionId: "session", now: NOW });
	assert.equal(content.directory.exists, true);
	assert.equal(content.directory.empty, false);

});

test("treats a file target as existing and non-empty", (t) => {
	const f = fixture(t);
	const filePath = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "file" }).path;
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, "not a directory\n");
	let file: ReturnType<typeof inspectProjectMapWorktreeTarget> | undefined;
	assert.doesNotThrow(() => { file = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "file", sessionId: "session", now: NOW }); });
	assert.equal(file?.directory.exists, true);
	assert.equal(file?.directory.empty, false);
});

test("distinguishes nested repositories from foreign clones rooted at the target", (t) => {
	const f = fixture(t);
	const nestedPath = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "nested" }).path;
	const nestedBase = join(f.dir, "main.repo-worktrees");
	f.git(f.dir, ["init", "--initial-branch=main", nestedBase]);
	mkdirSync(nestedPath);
	const nested = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "nested", sessionId: "session", now: NOW });
	assert.equal(nested.directory.insideAnotherRepository, true);
	assert.equal(nested.repository.sameClone, false);

	const foreignPath = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "foreign" }).path;
	f.git(f.dir, ["init", "--initial-branch=main", foreignPath]);
	const foreign = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "foreign", sessionId: "session", now: NOW });
	assert.equal(foreign.directory.insideAnotherRepository, false);
	assert.equal(foreign.repository.sameClone, false);
});

test("flags a target inside this repository checkout as nested", (t) => {
	const f = fixture(t);
	mkdirSync(join(f.main, "sub"));
	const inspection = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "../main.repo/sub", sessionId: "session", now: NOW });
	assert.equal(inspection.directory.insideAnotherRepository, true);
	assert.equal(inspection.repository.sameClone, true);
});

test("reports common-directory containment and the actual escaped path", (t) => {
	const f = fixture(t);
	const normal = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "normal", sessionId: "session", now: NOW });
	assert.equal(normal.directory.insideCommonDir, false);
	const escaped = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "../../escaped", sessionId: "session", now: NOW });
	assert.equal(escaped.identity.path, join(f.dir, "..", "escaped"));
	assert.equal(escaped.directory.insideCommonDir, false);
	const commonDirPath = join(f.main, ".git", "forbidden");
	mkdirSync(commonDirPath);
	const commonDir = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "../main.repo/.git/forbidden", sessionId: "session", now: NOW });
	assert.equal(commonDir.directory.insideCommonDir, true);
	const redirectedBase = join(f.dir, "main.repo-worktrees");
	symlinkSync(join(f.main, ".git"), redirectedBase);
	const redirected = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "redirected", sessionId: "session", now: NOW });
	assert.equal(redirected.directory.insideCommonDir, true);
});

test("fails closed when common-directory containment cannot be inspected", (t) => {
	// A privileged root bypasses directory permission bits, so this fixture cannot
	// produce EACCES there and the test is skipped rather than asserted falsely.
	if (process.getuid?.() === 0) {
		t.skip("root bypasses permission bits, so EACCES cannot be produced");
		return;
	}
	const f = fixture(t);
	const unreadableBase = join(f.dir, "main.repo-worktrees");
	mkdirSync(unreadableBase);
	chmodSync(unreadableBase, 0o000);
	try {
		const unreadable = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "unreadable", sessionId: "session", now: NOW });
		assert.equal(unreadable.directory.insideCommonDir, true);
		assert.ok(unreadable.diagnostics.some((entry) => entry.code === PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE && entry.message === "Worktree target path could not be inspected for common-directory containment."));
	} finally {
		chmodSync(unreadableBase, 0o700);
	}
});

test("recognizes a same-clone linked worktree as safe reuse", (t) => {
	const f = fixture(t);
	const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "linked" }).path;
	f.git(f.main, ["worktree", "add", "-b", "feat/linked", target]);
	const linked = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "linked", sessionId: "session", now: NOW });
	assert.equal(linked.directory.insideAnotherRepository, false);
	assert.equal(linked.repository.sameClone, true);
});

test("recognizes a same-clone worktree through a symlinked base as safe reuse", (t) => {
	const f = fixture(t);
	// A worktree reached through a symlinked base is physically elsewhere, so both
	// sides of the nested comparison must be canonicalized or legitimate reuse is
	// refused as nested.
	const realBase = join(f.dir, "real-base");
	mkdirSync(realBase);
	symlinkSync(realBase, join(f.dir, "main.repo-worktrees"));
	const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "symlinked" }).path;
	f.git(f.main, ["worktree", "add", "-b", "feat/symlinked", target]);
	const inspection = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "symlinked", sessionId: "session", now: NOW });
	assert.equal(inspection.directory.exists, true);
	assert.equal(inspection.directory.insideAnotherRepository, false);
	assert.equal(inspection.repository.sameClone, true);
});

test("maps free, own live, other live, and stale claims from the store", (t) => {
	const f = fixture(t);
	const free = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "free", sessionId: "requester", now: NOW });
	assert.deepEqual(free.claim, { status: "free", sessionId: null });

	assert.ok(acquireProjectMapClaim({ root: f.store, capabilityId: "own", sessionId: "requester", now: NOW }).claim);
	const own = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "own", sessionId: "requester", now: NOW });
	assert.deepEqual(own.claim, { status: "live", sessionId: "requester" });

	assert.ok(acquireProjectMapClaim({ root: f.store, capabilityId: "other", sessionId: "other-session", now: NOW }).claim);
	const other = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "other", sessionId: "requester", now: NOW });
	assert.deepEqual(other.claim, { status: "held-by-other", sessionId: "other-session" });

	assert.ok(acquireProjectMapClaim({ root: f.store, capabilityId: "stale", sessionId: "expired-session", now: NOW }).claim);
	const stale = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "stale", sessionId: "requester", now: "2026-09-25T12:01:00.001Z" });
	assert.deepEqual(stale.claim, { status: "stale", sessionId: "expired-session" });
});

test("reports free claim and no occupancy when the store is not initialized", (t) => {
	const f = fixture(t, { initialize: false });
	const inspection = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "uninitialized", sessionId: "requester", now: NOW });
	assert.equal(inspection.claim.status, "free");
	assert.equal(inspection.session.occupiedBy, null);
	assert.equal(inspection.session.heartbeat, "missing");
	assert.equal(inspection.diagnostics.some((entry) => entry.code === PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED), false);
});

test("finds fresh and doubtful stale session occupancy but excludes proved-dead stale bindings", (t) => {
	const f = fixture(t);
	const freshTarget = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "fresh-occupied" }).path;
	assert.ok(bindProjectMapStoreSession({ root: f.store, sessionId: "fresh-session", pid: process.pid, incarnation: INCARNATION, workspaceRoot: freshTarget, now: NOW }).binding);
	assert.ok(beatProjectMapStoreHeartbeat({ root: f.store, sessionId: "fresh-session", pid: process.pid, incarnation: INCARNATION, now: NOW }).heartbeat);
	const fresh = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "fresh-occupied", sessionId: "requester", now: NOW });
	assert.equal(fresh.session.occupiedBy, "fresh-session");
	assert.equal(fresh.session.heartbeat, "fresh");

	const staleTarget = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "stale-occupied" }).path;
	assert.ok(bindProjectMapStoreSession({ root: f.store, sessionId: "stale-session", pid: process.pid, incarnation: INCARNATION, workspaceRoot: staleTarget, now: NOW }).binding);
	assert.ok(beatProjectMapStoreHeartbeat({ root: f.store, sessionId: "stale-session", pid: process.pid, incarnation: INCARNATION, now: NOW }).heartbeat);
	const stale = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "stale-occupied", sessionId: "requester", now: "2026-09-25T12:01:00.001Z" });
	assert.equal(stale.session.occupiedBy, "stale-session");
	assert.equal(stale.session.heartbeat, "stale");

	const deadTarget = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "dead-occupied" }).path;
	const dead = spawnSync(process.execPath, ["--eval", ""], { stdio: "ignore" });
	assert.equal(dead.status, 0);
	assert.ok(dead.pid);
	const deadBinding = bindProjectMapStoreSession({ root: f.store, sessionId: "dead-session", pid: dead.pid!, incarnation: "123e4567-e89b-12d3-a456-426614174002", workspaceRoot: deadTarget, now: NOW });
	assert.ok(deadBinding.binding);
	assert.equal(projectMapStoreBindingProvesDead(deadBinding.binding), true);
	assert.ok(beatProjectMapStoreHeartbeat({ root: f.store, sessionId: "dead-session", pid: dead.pid!, incarnation: "123e4567-e89b-12d3-a456-426614174002", now: NOW }).heartbeat);
	const provedDead = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "dead-occupied", sessionId: "requester", now: NOW });
	assert.equal(provedDead.session.occupiedBy, null);
	assert.equal(provedDead.session.heartbeat, "missing");

	const missingHeartbeatTarget = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "missing-heartbeat" }).path;
	assert.ok(bindProjectMapStoreSession({ root: f.store, sessionId: "missing-heartbeat-session", pid: process.pid, incarnation: INCARNATION, workspaceRoot: missingHeartbeatTarget, now: NOW }).binding);
	const missingHeartbeat = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "missing-heartbeat", sessionId: "requester", now: NOW });
	assert.equal(missingHeartbeat.session.occupiedBy, "missing-heartbeat-session");
	assert.equal(missingHeartbeat.session.heartbeat, "missing");
});

test("reports corrupt and non-canonical session bindings after a fresh occupant", (t) => {
	const f = fixture(t);
	const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "corrupt-occupancy" }).path;
	assert.ok(bindProjectMapStoreSession({ root: f.store, sessionId: "fresh-occupant", pid: process.pid, incarnation: INCARNATION, workspaceRoot: target, now: NOW }).binding);
	assert.ok(beatProjectMapStoreHeartbeat({ root: f.store, sessionId: "fresh-occupant", pid: process.pid, incarnation: INCARNATION, now: NOW }).heartbeat);
	writeFileSync(join(f.store, "sessions", "aaaa-corrupt.json"), "not JSON\n");
	writeFileSync(join(f.store, "sessions", "zzzz-corrupt.json"), "not JSON\n");
	const nonCanonicalSession = "123e4567-e89b-12d3-a456-426614174003";
	const serialized = serializeProjectMapStoreValue("session-binding", {
		schema: "gentle-shell.project-map-store/v1",
		kind: "session-binding",
		session_id: nonCanonicalSession,
		pid: process.pid,
		incarnation: INCARNATION,
		workspace_root: target,
		bound_at: NOW,
	});
	assert.ok(serialized.record);
	writeFileSync(join(f.store, "sessions", sessionFilename(nonCanonicalSession)), JSON.stringify(JSON.parse(serialized.record)));
	const inspection = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "corrupt-occupancy", sessionId: "requester", now: NOW });
	assert.equal(inspection.session.occupiedBy, "fresh-occupant");
	assert.equal(inspection.session.heartbeat, "fresh");
	const corruptPaths = new Set(inspection.diagnostics
		.filter((entry) => entry.code === PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED && entry.path.startsWith("$.sessions."))
		.map((entry) => entry.path));
	assert.deepEqual(corruptPaths, new Set([
		"$.sessions.aaaa-corrupt.json",
		`$.sessions.${sessionFilename(nonCanonicalSession)}`,
		"$.sessions.zzzz-corrupt.json",
	]));
	assert.ok(corruptPaths.has("$.sessions.zzzz-corrupt.json"));
});

function claim(f: ReturnType<typeof fixture>, capabilityId: string, sessionId = "requester"): void {
	assert.ok(acquireProjectMapClaim({ root: f.store, capabilityId, sessionId, now: NOW }).claim);
}

function plan(f: ReturnType<typeof fixture>, capabilityId: string, sessionId = "requester") {
	return planProjectMapWorktree({ cwd: f.main, capabilityId, sessionId, now: NOW });
}

function hasCode(result: { diagnostics: Array<{ code: string }> }, code: string): boolean {
	return result.diagnostics.some((entry) => entry.code === code);
}

test("plans require a live caller claim or a live lead", (t) => {
	const f = fixture(t);
	assert.equal(plan(f, "free").decision, "refuse");
	assert.ok(hasCode(plan(f, "free"), PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_CLAIM_REQUIRED));
	claim(f, "held", "holder");
	assert.ok(hasCode(plan(f, "held"), PROJECT_MAP_STORE_DIAGNOSTIC_CODES.CLAIM_HELD));
	claim(f, "__lead", "requester");
	assert.equal(plan(f, "held").decision, "create");
});

test("plans a clean create from the resolved HEAD without changing the target", (t) => {
	const f = fixture(t);
	claim(f, "create");
	const expectedBase = f.git(f.main, ["rev-parse", "HEAD"]).trim();
	const proposed = plan(f, "create");
	assert.equal(proposed.decision, "create");
	assert.equal(proposed.baseCommit, expectedBase);
	assert.deepEqual(proposed.command, ["git", "worktree", "add", "-b", "feat/create", proposed.inspection.identity.path, expectedBase]);
	assert.equal(proposed.dirty, false);
	assert.deepEqual(proposed.diagnostics, []);
	assert.equal(existsSync(proposed.inspection.identity.path), false);
	assert.equal(f.git(f.main, ["branch", "--list", "feat/create"]).trim(), "");
});

test("plans clean and dirty reusable worktrees and refuses an unreadable porcelain status", (t) => {
	const f = fixture(t);
	for (const capabilityId of ["clean", "dirty"]) {
		claim(f, capabilityId);
		const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId }).path;
		f.git(f.main, ["worktree", "add", "-b", `feat/${capabilityId}`, target]);
	}
	const clean = plan(f, "clean");
	assert.equal(clean.decision, "reuse");
	assert.equal(clean.dirty, false);
	writeFileSync(join(deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "dirty" }).path, "dirty.txt"), "dirty\n");
	const dirty = plan(f, "dirty");
	assert.equal(dirty.decision, "reuse");
	assert.equal(dirty.dirty, true);
	const statusFailure = ((file: string, args: readonly string[], options: Parameters<typeof execFileSync>[2]) => {
		if (file === "git" && args.includes("status")) throw Object.assign(new Error("status unavailable"), { status: 128, stdout: "", stderr: "status unavailable" });
		return execFileSync(file, args, options);
	}) as typeof execFileSync;
	const unreadable = planProjectMapWorktree({ cwd: f.main, capabilityId: "clean", sessionId: "requester", now: NOW, run: statusFailure });
	assert.equal(unreadable.decision, "refuse");
	assert.equal(unreadable.dirty, false);
	assert.ok(hasCode(unreadable, PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD));
});

test("plans refuse unsafe target states without changing bytes", (t) => {
	const f = fixture(t);
	for (const capabilityId of ["nonempty", "nested", "foreign", "occupied", "../main.repo/.git/escape"]) claim(f, capabilityId);
	const nonempty = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "nonempty" }).path;
	mkdirSync(nonempty, { recursive: true }); writeFileSync(join(nonempty, "x"), "x");
	f.git(f.dir, ["init", "--initial-branch=main", deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "foreign" }).path]);
	const occupied = deriveProjectMapWorktreeIdentity({ repositoryRoot: f.main, capabilityId: "occupied" }).path;
	assert.ok(bindProjectMapStoreSession({ root: f.store, sessionId: "occupant", pid: process.pid, incarnation: INCARNATION, workspaceRoot: occupied, now: NOW }).binding);
	const before = snapshot(f.dir);
	for (const [capabilityId, code] of [["nonempty", "WORKTREE_TARGET_NOT_EMPTY"], ["foreign", "WORKTREE_FOREIGN_CLONE"], ["occupied", "WORKTREE_OCCUPIED"], ["../main.repo/.git/escape", "WORKTREE_PATH_ESCAPES"]] as const) assert.ok(hasCode(plan(f, capabilityId), PROJECT_MAP_STORE_DIAGNOSTIC_CODES[code]));
	assert.deepEqual(snapshot(f.dir), before);
	const nestedBase = join(f.dir, "main.repo-worktrees"); f.git(f.dir, ["init", "--initial-branch=main", nestedBase]); mkdirSync(join(nestedBase, "nested"));
	const nested = plan(f, "nested");
	assert.ok(hasCode(nested, PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_NESTED_REPOSITORY));
	assert.ok(hasCode(nested, PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_FOREIGN_CLONE));
});

test("plans refuse an unattached branch", (t) => {
	const f = fixture(t);
	claim(f, "orphan"); f.git(f.main, ["branch", "feat/orphan"]);
	assert.equal(plan(f, "orphan").decision, "refuse");
	assert.ok(hasCode(plan(f, "orphan"), PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD));
});

test("inspection is byte-level read-only for filesystem, store, branches, and worktrees", (t) => {
	const f = fixture(t);
	symlinkSync("empty", join(f.dir, "empty-link"));
	const beforeTree = snapshot(f.dir);
	assert.ok(beforeTree.some(([name, detail]) => name === "empty/" && detail === "directory"));
	assert.ok(beforeTree.some(([name, detail]) => name === "empty-link" && detail === "symlink:empty"));
	assert.ok(beforeTree.some(([, detail]) => detail.startsWith("file:")));
	const beforeBranches = f.git(f.main, ["branch", "--format=%(refname)"]);
	const beforeWorktrees = f.git(f.main, ["worktree", "list", "--porcelain"]);
	const inspected = inspectProjectMapWorktreeTarget({ cwd: f.main, capabilityId: "readonly", sessionId: "requester", now: NOW });
	assert.equal(inspected.directory.exists, false);
	assert.deepEqual(snapshot(f.dir), beforeTree);
	assert.equal(f.git(f.main, ["branch", "--format=%(refname)"]), beforeBranches);
	assert.equal(f.git(f.main, ["worktree", "list", "--porcelain"]), beforeWorktrees);
	assert.equal(existsSync(inspected.identity.path), false);
});
