import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { raiseProjectMapStoreBlocker } from "../lib/project-map-store-blockers.ts";
import { acquireProjectMapClaim } from "../lib/project-map-store-claims.ts";
import { proposeProjectMapContract } from "../lib/project-map-store-contracts.ts";
import { beatProjectMapStoreHeartbeat, bindProjectMapStoreSession } from "../lib/project-map-store-heartbeats.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { deriveProjectMapWorktreeIdentity } from "../lib/project-map-worktrees.ts";
import { PROJECT_MAP_ARTIFACT_PATH, PROJECT_MAP_SCHEMA_V1, serializeProjectMap, type ProjectMapCapabilityV1, type ProjectMapV1 } from "../lib/shell-project-map-schema.ts";
import { deriveProjectMapOpenPiSessionName, openProjectMapPi, planProjectMapOpenPi, probeProjectMapOpenPiHost, projectMapOpenPiSessionExists, PROJECT_MAP_OPEN_PI_ENV, projectMapOpenPiReadiness, resolveProjectMapOpenPiLauncher } from "../lib/project-map-open-pi.ts";

const NOW = "2026-09-26T12:00:00.000Z";
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";
const INCARNATION = "123e4567-e89b-12d3-a456-426614174001";
const HOST = { available: true, version: "tmux 3.6" };

function capability(id = "catalog", overrides: Partial<ProjectMapCapabilityV1> = {}): ProjectMapCapabilityV1 {
	return { id, outcome: `${id} is available.`, foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "ready", ...overrides };
}

function projectMap(capabilities = [capability()], approval: ProjectMapV1["approval"] = { state: "approved", approvedAt: NOW, approvedBy: "test" }): ProjectMapV1 {
	return { version: PROJECT_MAP_SCHEMA_V1, project: { id: "example", name: "Example" }, approval, foundations: [], capabilities };
}

function snapshot(root: string, relative = ""): Array<{ path: string; bytes: string | null; mtimeNs: bigint }> {
	const path = join(root, relative);
	const state = lstatSync(path, { bigint: true });
	const entries = [{ path: relative || ".", bytes: state.isDirectory() ? null : createHash("sha256").update(readFileSync(path)).digest("hex"), mtimeNs: state.mtimeNs }];
	if (!state.isDirectory()) return entries;
	for (const entry of readdirSync(path).sort()) entries.push(...snapshot(root, relative === "" ? entry : join(relative, entry)));
	return entries;
}

function withFixture(run: (fixture: { sandbox: string; cwd: string; store: string; git: (args: string[]) => string }) => void, map = projectMap()): void {
	const sandbox = mkdtempSync(join(tmpdir(), "project-map-open-pi-"));
	try {
		const cwd = join(sandbox, "main");
		const empty = join(sandbox, "empty");
		mkdirSync(empty);
		const env = { ...process.env, GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
		writeFileSync(join(empty, "config"), "", "utf8");
		execFileSync("git", ["init", "--initial-branch=main", cwd], { env, stdio: "ignore" });
		const git = (args: string[]) => String(execFileSync("git", ["-C", cwd, "-c", `core.hooksPath=${empty}`, "-c", "commit.gpgsign=false", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
		git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Fixture"]);
		mkdirSync(dirname(join(cwd, PROJECT_MAP_ARTIFACT_PATH)), { recursive: true });
		writeFileSync(join(cwd, PROJECT_MAP_ARTIFACT_PATH), serializeProjectMap(map), "utf8");
		const resolved = resolveProjectMapStoreRoot(cwd);
		assert.ok(resolved.root && resolved.repositoryId, resolved.diagnostics.map((entry) => entry.message).join("\n"));
		mkdirSync(resolved.root, { recursive: true, mode: 0o700 });
		assert.ok(initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW }).descriptor);
		run({ sandbox, cwd, store: resolved.root, git });
	} finally { rmSync(sandbox, { recursive: true, force: true }); }
}

function claim(store: string, capabilityId = "catalog", sessionId = "session-a"): void {
	assert.ok(acquireProjectMapClaim({ root: store, capabilityId, sessionId, now: NOW }).claim);
}

function readiness(cwd: string, capabilityId = "catalog", sessionId = "session-a", host = HOST) {
	return projectMapOpenPiReadiness({ cwd, capabilityId, sessionId, now: NOW, host });
}

function hasCode(result: ReturnType<typeof readiness>, code: string): boolean {
	return result.diagnostics.some((diagnostic) => diagnostic.code === code);
}

test("probe reports available, absent, timeout, and unexpected tmux results through its runner", () => {
	const calls: Array<[string, string[], { timeout?: number; env?: NodeJS.ProcessEnv }]> = [];
	const run = ((file: string, args: string[], options: { timeout?: number; env?: NodeJS.ProcessEnv }) => {
		calls.push([file, args, options]);
		return "tmux 3.6\n";
	}) as typeof execFileSync;
	assert.deepEqual(probeProjectMapOpenPiHost({ env: { GIT_DIR: "ignored", PATH: "/bin" }, timeoutMs: 123, run }), { available: true, version: "tmux 3.6" });
	assert.deepEqual(calls.map(([file, args, options]) => [file, args, options.timeout, options.env?.GIT_DIR, options.env?.PATH]), [["tmux", ["-V"], 123, undefined, "/bin"]]);
	for (const error of [{ code: "ENOENT" }, { code: "ETIMEDOUT" }, { status: 2 }]) {
		const unavailable = probeProjectMapOpenPiHost({ env: {}, timeoutMs: 123, run: (() => { throw error; }) as typeof execFileSync });
		assert.deepEqual(unavailable, { available: false, version: null });
	}
});

test("probe runs tmux -V when tmux is installed", (t) => {
	const result = probeProjectMapOpenPiHost({ env: process.env, timeoutMs: 1000 });
	if (!result.available) t.skip("tmux is not installed");
	else assert.match(result.version ?? "", /^tmux /);
});

test("readiness permits an approved, claimed, plannable capability and writes nothing", () => {
	withFixture(({ sandbox, cwd, store }) => {
		claim(store);
		const before = snapshot(sandbox);
		const result = readiness(cwd);
		assert.equal(result.permitted, true);
		assert.deepEqual(result.diagnostics, []);
		assert.equal(result.claim?.sessionId, "session-a");
		assert.notEqual(result.worktree, null);
		assert.deepEqual(snapshot(sandbox), before);
	});
});

test("readiness permits only capabilities declared ready", () => {
	const cases: Array<{ state: ProjectMapCapabilityV1["state"]; permitted: boolean }> = [
		{ state: "done", permitted: false },
		{ state: "active", permitted: false },
		{ state: "review", permitted: false },
		{ state: "ready", permitted: true },
		{ state: "blocked", permitted: false },
		{ state: "planned", permitted: false },
	];
	for (const entry of cases) withFixture(({ cwd, store }) => {
		claim(store);
		const result = readiness(cwd);
		assert.equal(result.permitted, entry.permitted, entry.state);
		assert.equal(hasCode(result, "project-map-open-pi/capability-not-ready"), !entry.permitted, entry.state);
	}, projectMap([capability("catalog", { state: entry.state })]));
});

test("readiness fails closed when an unrelated store record is corrupted", () => {
	withFixture(({ cwd, store }) => {
		claim(store, "catalog");
		const unrelatedRecord = join(store, "claims", `${createHash("sha256").update("billing").digest("hex")}.json`);
		writeFileSync(unrelatedRecord, "{ not json", "utf8");
		const result = readiness(cwd);
		assert.equal(result.permitted, false);
		assert.ok(result.diagnostics.some((entry) => entry.code === "project-map-store/store-corrupted"));
	}, projectMap([capability("catalog"), capability("billing")]));
});

test("plans a named detached tmux session, attach command, and structured handoff without launching", () => {
	withFixture(({ cwd, store }) => {
		claim(store);
		const plan = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST });
		assert.equal(plan.decision, "open");
		assert.equal(plan.sessionName, "project-map-open-pi-catalog");
		assert.deepEqual(plan.attachCommand, ["tmux", "attach-session", "-t", plan.sessionName]);
		assert.deepEqual(plan.argv, ["tmux", "new-session", "-d", "-s", plan.sessionName, "-c", plan.cwd, process.execPath, plan.launcher.path, plan.handoff]);
		assert.equal(plan.cwd, plan.readiness.worktree.inspection.identity.path);
		assert.deepEqual(JSON.parse(plan.env[PROJECT_MAP_OPEN_PI_ENV] ?? ""), { capabilityId: "catalog", parentSessionId: "session-a" });
		assert.equal(plan.handoff, [
			"Project Map Open Pi handoff",
			"Capability: catalog",
			"Objective and outcome: catalog is available.",
			"Approved surfaces: web",
			"Dependencies: none",
			"Accepted contracts: none",
			"Feature documents: none",
			"Parent session: session-a",
			"Verification requirements: not declared by the map.",
		].join("\n"));
	});
});

test("derives a bounded deterministic tmux session name and refuses a collision", () => {
	const maximumId = "a".repeat(64);
	assert.equal(deriveProjectMapOpenPiSessionName(maximumId), `project-map-open-pi-${maximumId}`);
	withFixture(({ cwd, store }) => {
		claim(store);
		const plan = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST, sessionExists: () => true });
		assert.equal(plan.decision, "refuse");
		assert.ok(plan.diagnostics.some((entry) => entry.code === "project-map-open-pi/session-name-occupied"));
	});
	assert.equal(projectMapOpenPiSessionExists({ name: "project-map-open-pi-catalog", env: {}, run: (() => "") as unknown as typeof execFileSync }), true);
	assert.equal(projectMapOpenPiSessionExists({ name: "project-map-open-pi-catalog", env: {}, run: (() => { throw new Error("absent"); }) as typeof execFileSync }), false);
});

test("resolves the package launcher through Node before a verified PATH fallback and refuses no launcher", () => {
	const local = resolveProjectMapOpenPiLauncher({ packageRoot: "/package", nodeExecPath: "/node", env: { PATH: "/bin" }, exists: (path) => path === "/package/bin/gentle-shell.mjs" });
	assert.deepEqual(local, { command: "/node", path: "/package/bin/gentle-shell.mjs", source: "package-local" });
	const fallback = resolveProjectMapOpenPiLauncher({ packageRoot: "/package", nodeExecPath: "/node", env: { PATH: "/bin:/usr/bin" }, exists: (path) => path === "/usr/bin/gentle-shell" });
	assert.deepEqual(fallback, { command: "/usr/bin/gentle-shell", path: "/usr/bin/gentle-shell", source: "path" });
	assert.equal(resolveProjectMapOpenPiLauncher({ packageRoot: "/package", nodeExecPath: "/node", env: { PATH: "/bin" }, exists: () => false }), null);
	withFixture(({ cwd, store }) => {
		claim(store);
		const refused = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST, launcher: null });
		assert.equal(refused.decision, "refuse"); assert.ok(refused.diagnostics.some((entry) => entry.code === "project-map-open-pi/launcher-unavailable"));
		const fallbackPlan = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST, launcher: fallback! });
		assert.equal(fallbackPlan.argv.filter((entry) => entry === fallback!.command).length, 1, "a PATH launcher is the command, not its own argument");
	});
});

test("executes only an open plan's argv and refuses never launches", () => {
	withFixture(({ cwd, store }) => {
		claim(store);
		const plan = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST });
		const calls: Array<[string, string[]]> = [];
		assert.equal(openProjectMapPi(plan, ((file, args) => { calls.push([file, args]); return ""; }) as typeof execFileSync).launched, true);
		assert.deepEqual(calls, [["tmux", plan.argv.slice(1)]]);
		const refused = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: { available: false, version: null } });
		let refusedCalls = 0;
		assert.equal(openProjectMapPi(refused, (() => { refusedCalls += 1; return ""; }) as unknown as typeof execFileSync).launched, false);
		assert.equal(refusedCalls, 0, "a refusal never reaches the spawner");
	});
});

test("tmux adapter creates a detached session only in a temporary sandbox", (t) => {
	if (!probeProjectMapOpenPiHost({ env: process.env, timeoutMs: 1000 }).available) return t.skip("tmux is not installed");
	const sandbox = mkdtempSync(join(tmpdir(), "project-map-open-pi-tmux-"));
	const name = `project-map-open-pi-${process.pid}-${Date.now()}`;
	try {
		const result = openProjectMapPi({
			decision: "open", argv: ["tmux", "new-session", "-d", "-s", name, "-c", sandbox, "sh", "-c", "sleep 30"], cwd: sandbox, env: process.env, handoff: "test", diagnostics: [],
			readiness: {} as ReturnType<typeof readiness>, sessionName: name, attachCommand: ["tmux", "attach-session", "-t", name], launcher: { command: "sh", path: "sh", source: "path" },
		});
		assert.equal(result.launched, true);
		assert.doesNotThrow(() => execFileSync("tmux", ["has-session", "-t", name], { stdio: "ignore" }));
	} finally {
		try { execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" }); } catch {}
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("readiness names every readiness disqualifier", () => {
	const cases: Array<{ name: string; map?: ProjectMapV1; prepare?: (fixture: { cwd: string; store: string; git: (args: string[]) => string }) => void; capabilityId?: string; host?: typeof HOST; code: string }> = [
		{ name: "missing capability", capabilityId: "missing", code: "project-map-open-pi/capability-not-found" },
		{ name: "unapproved map", map: projectMap([capability()], { state: "draft" }), code: "project-map-open-pi/capability-not-approved" },
		{ name: "dependency not ready", map: projectMap([capability("dependency"), capability("catalog", { dependsOn: ["dependency"] })]), prepare: ({ store }) => claim(store), code: "project-map-open-pi/dependencies-not-ready" },
		{ name: "open blocker", prepare: ({ store }) => { claim(store); raiseProjectMapStoreBlocker({ root: store, capabilityId: "catalog", blockerId: "blocker", owner: "test", reason: "Blocked", sessionId: "session-a", now: NOW }); }, code: "project-map-open-pi/open-blocker" },
		{ name: "proposed contract", prepare: ({ store }) => { claim(store); assert.ok(proposeProjectMapContract({ root: store, capabilityId: "catalog", contractId: "contract", title: "Contract", digest: `sha256:${"a".repeat(64)}`, sessionId: "session-a", now: NOW }).contract); }, code: "project-map-open-pi/proposed-contract" },
		{ name: "missing live claim", code: "project-map-store/worktree-claim-required" },
		{ name: "other claim", prepare: ({ store }) => claim(store, "catalog", "session-b"), code: "project-map-store/claim-held" },
		{ name: "refused worktree", prepare: ({ cwd, store }) => { claim(store); const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" }).path; mkdirSync(target, { recursive: true }); writeFileSync(join(target, "occupied"), "x"); }, code: "project-map-store/worktree-target-not-empty" },
		{ name: "occupied worktree", prepare: ({ cwd, store, git }) => { claim(store); const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" }).path; git(["worktree", "add", "-b", "feat/catalog", target]); assert.ok(bindProjectMapStoreSession({ root: store, sessionId: "session-b", workspaceRoot: target, pid: 1, incarnation: INCARNATION, now: NOW }).binding); assert.ok(beatProjectMapStoreHeartbeat({ root: store, sessionId: "session-b", pid: 1, incarnation: INCARNATION, now: NOW }).heartbeat); }, code: "project-map-store/worktree-occupied" },
		{ name: "host unavailable", prepare: ({ store }) => claim(store), host: { available: false, version: null }, code: "project-map-open-pi/host-unavailable" },
	];
	for (const entry of cases) withFixture(({ cwd, store, git }) => {
		entry.prepare?.({ cwd, store, git });
		const result = readiness(cwd, entry.capabilityId, "session-a", entry.host ?? HOST);
		assert.equal(result.permitted, false, entry.name);
		assert.ok(hasCode(result, entry.code), `${entry.name} should report ${entry.code}`);
	}, entry.map ?? projectMap());
});
