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
import { PROJECT_MAP_LEAD_CAPABILITY_ID } from "../lib/project-map-coordination-state.ts";
import { PROJECT_MAP_ARTIFACT_PATH, PROJECT_MAP_SCHEMA_V1, serializeProjectMap, type ProjectMapCapabilityV1, type ProjectMapV1 } from "../lib/shell-project-map-schema.ts";
import { serializeProjectMapStoreValue } from "../lib/project-map-store-schema.ts";
import { awaitProjectMapOpenPiConfirmation, deriveProjectMapOpenPiSessionName, openProjectMapPi, planProjectMapOpenPi, planProjectMapOpenPiFallback, probeProjectMapOpenPiHost, projectMapOpenPiSessionExists, PROJECT_MAP_OPEN_PI_ENV, projectMapOpenPiReadiness, resolveProjectMapOpenPiLauncher, runProjectMapOpenPiFallback } from "../lib/project-map-open-pi.ts";

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

type OpenPiFixture = { sandbox: string; cwd: string; store: string; git: (args: string[]) => string };

function setupFixture(map = projectMap(), provisionWorktree = true): { fixture: OpenPiFixture; cleanup: () => void } {
	const sandbox = mkdtempSync(join(tmpdir(), "project-map-open-pi-"));
	const cwd = join(sandbox, "main");
	const empty = join(sandbox, "empty");
	mkdirSync(empty);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
	writeFileSync(join(empty, "config"), "", "utf8");
	execFileSync("git", ["init", "--initial-branch=main", cwd], { env, stdio: "ignore" });
	const git = (args: string[]) => String(execFileSync("git", ["-C", cwd, "-c", `core.hooksPath=${empty}`, "-c", "commit.gpgsign=false", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
	git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Fixture"]);
	// Open Pi requires a provisioned worktree, so the fixture provisions the real one.
	if (provisionWorktree) git(["worktree", "add", "-b", "feat/catalog", deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" }).path]);
	mkdirSync(dirname(join(cwd, PROJECT_MAP_ARTIFACT_PATH)), { recursive: true });
	writeFileSync(join(cwd, PROJECT_MAP_ARTIFACT_PATH), serializeProjectMap(map), "utf8");
	const resolved = resolveProjectMapStoreRoot(cwd);
	assert.ok(resolved.root && resolved.repositoryId, resolved.diagnostics.map((entry) => entry.message).join("\n"));
	mkdirSync(resolved.root, { recursive: true, mode: 0o700 });
	assert.ok(initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW }).descriptor);
	return { fixture: { sandbox, cwd, store: resolved.root, git }, cleanup: () => rmSync(sandbox, { recursive: true, force: true }) };
}

function withFixture(run: (fixture: OpenPiFixture) => void, map = projectMap(), provisionWorktree = true): void {
	let cleanup = (): void => {};
	try {
		const setup = setupFixture(map, provisionWorktree);
		cleanup = setup.cleanup;
		run(setup.fixture);
	} finally { cleanup(); }
}

async function withAsyncFixture(run: (fixture: OpenPiFixture) => Promise<void>, map = projectMap(), provisionWorktree = true): Promise<void> {
	let cleanup = (): void => {};
	try {
		const setup = setupFixture(map, provisionWorktree);
		cleanup = setup.cleanup;
		await run(setup.fixture);
	} finally { cleanup(); }
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

test("probe availability remains deterministic through an injected tmux runner", () => {
	assert.deepEqual(probeProjectMapOpenPiHost({ env: {}, timeoutMs: 1, run: (() => "tmux 3.6\n") as unknown as typeof execFileSync }), { available: true, version: "tmux 3.6" });
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
		assert.deepEqual(plan.argv, ["tmux", "new-session", "-d", "-e", `${PROJECT_MAP_OPEN_PI_ENV}=${JSON.stringify({ capabilityId: "catalog", parentSessionId: "session-a" })}`, "-s", plan.sessionName, "-c", plan.cwd, process.execPath, plan.launcher.path, plan.handoff]);
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

test("the launch paths feed only non-destructive commands to their executors", async () => {
	await withAsyncFixture(async ({ cwd, store }) => {
		claim(store);
		const planned = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST });
		const fallback = planProjectMapOpenPiFallback(planned, { sessionDir: "/sessions" });
		// The unit launches; it never delivers. These are the exact values handed to the executors.
		const forbidden = ["commit", "push", "pull-request", "merge", "branch", "worktree", "rm", "reset", "clean", "--force", "-D"];
		for (const argv of [planned.argv, fallback.argv]) for (const token of forbidden) assert.equal(argv.includes(token), false, `${token} must not appear in ${JSON.stringify(argv)}`);
		assert.equal(planned.argv[0], "tmux"); assert.equal(planned.argv[1], "new-session");
		const spawned: string[][] = [];
		await runProjectMapOpenPiFallback(fallback, { mkdir: (() => {}) as never, spawn: ((command: string, args: string[]) => { spawned.push([command, ...args]); return { pid: 1, once: (event: string, listener: () => void) => { if (event === "spawn") listener(); } }; }) as never });
		assert.equal(spawned.length, 1);
		for (const token of forbidden) assert.equal(spawned[0]!.includes(token), false, `${token} must not be spawned`);
	});
});

test("the tmux session receives the launch identity in its own environment", (t) => {
	if (!probeProjectMapOpenPiHost({ env: process.env, timeoutMs: 1000 }).available) return t.skip("tmux is not installed");
	withFixture(({ cwd, store }) => {
		claim(store);
		const plan = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST });
		// Run the real plan's own -e argument against a real tmux server: tmux does not forward new
		// client variables on its own, so this fails if the identity travels by environment alone.
		const name = `project-map-open-pi-identity-${process.pid}`;
		try {
			const opened = openProjectMapPi({ ...plan, argv: [...plan.argv.slice(0, 5), "-s", name, "-c", cwd, "sleep", "20"] });
			assert.equal(opened.launched, true);
			// The session environment is set when the session is created, so this needs no waiting.
			const value = String(execFileSync("tmux", ["show-environment", "-t", name, PROJECT_MAP_OPEN_PI_ENV], { encoding: "utf8" })).trim();
			assert.equal(value, `${PROJECT_MAP_OPEN_PI_ENV}=${JSON.stringify({ capabilityId: "catalog", parentSessionId: "session-a" })}`);
		} finally {
			try { execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" }); } catch {}
		}
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

test("fallback plans only around the host gate and executes its planned argv without a real process", async () => {
	await withAsyncFixture(async ({ cwd, store }) => {
		claim(store);
		const plan = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: { available: false, version: null } });
		const fallback = planProjectMapOpenPiFallback(plan, { sessionDir: "/sessions", extensionPaths: ["/extension.ts"], pi: { command: "/pi", args: ["/cli.js"] }, exists: () => true });
		assert.equal(fallback.decision, "offer"); assert.equal(fallback.cwd, plan.cwd); assert.equal(fallback.handoff, plan.handoff); assert.deepEqual(JSON.parse(fallback.env[PROJECT_MAP_OPEN_PI_ENV] ?? ""), { capabilityId: "catalog", parentSessionId: "session-a" }); assert.deepEqual(fallback.diagnostics, []);
		assert.deepEqual(fallback.argv, ["/pi", "/cli.js", "--print", "--session-dir", "/sessions", "--extension", "/extension.ts", "--append-system-prompt", plan.handoff, plan.handoff]);
		const ready = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST });
		assert.equal(planProjectMapOpenPiFallback(ready, { sessionDir: "/sessions" }).decision, "offer");
		const refused = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: { available: false, version: null } });
		// A live claim held by another session is a non-host readiness denial.
		const noClaim = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-b", now: NOW, host: { available: false, version: null } });
		const denied = planProjectMapOpenPiFallback(noClaim, { sessionDir: "/sessions" });
		assert.equal(denied.decision, "refuse"); assert.ok(denied.diagnostics.some((entry) => entry.code !== "project-map-open-pi/host-unavailable"));
		assert.ok(planProjectMapOpenPiFallback(refused, { sessionDir: " " }).diagnostics.some((entry) => entry.code === "project-map-open-pi/session-dir-required"));
		const transport = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW, host: HOST, launcher: null, sessionExists: () => true });
		assert.equal(planProjectMapOpenPiFallback(transport, { sessionDir: "/sessions" }).decision, "offer");
		let mkdirs = 0, spawns = 0, unrefs = 0;
		assert.deepEqual(await runProjectMapOpenPiFallback(denied, { mkdir: (() => { mkdirs += 1; }) as never, spawn: (() => { spawns += 1; return {}; }) as never }), { launched: false, pid: null, error: null });
		assert.equal(mkdirs, 0); assert.equal(spawns, 0);
		const result = await runProjectMapOpenPiFallback(fallback, { mkdir: ((path, options) => { mkdirs += 1; assert.equal(path, "/sessions"); assert.deepEqual(options, { recursive: true }); }) as never, spawn: ((command, args, options) => { spawns += 1; assert.equal(command, fallback.argv[0]); assert.deepEqual(args, fallback.argv.slice(1)); assert.deepEqual(options, { cwd: fallback.cwd, env: fallback.env, detached: true, stdio: "ignore", windowsHide: true }); return { pid: 42, unref: () => { unrefs += 1; }, once: (event: string, listener: () => void) => { if (event === "spawn") listener(); } }; }) as never });
		assert.deepEqual(result, { launched: true, pid: 42, error: null }); assert.equal(mkdirs, 1); assert.equal(spawns, 1); assert.equal(unrefs, 1);
		assert.deepEqual(await runProjectMapOpenPiFallback(fallback, { mkdir: (() => { throw new Error("mkdir failed"); }) as never }), { launched: false, pid: null, error: "mkdir failed" });
		assert.deepEqual(await runProjectMapOpenPiFallback(fallback, { mkdir: (() => {}) as never, spawn: (() => { throw new Error("spawn failed"); }) as never }), { launched: false, pid: null, error: "spawn failed" });
	});
});

test("fallback reports an asynchronous spawn failure instead of a launch request", async () => {
	const fallback = { decision: "offer" as const, argv: ["/pi", "--print", "brief"], cwd: "/worktree", env: {}, handoff: "brief", sessionDir: "/sessions", diagnostics: [] };
	let unrefs = 0;
	const failed = await runProjectMapOpenPiFallback(fallback, {
		mkdir: (() => {}) as never,
		spawn: (() => ({ once: (event: string, listener: (error?: unknown) => void) => { if (event === "error") listener(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })); }, unref: () => { unrefs += 1; } })) as never,
	});
	assert.deepEqual(failed, { launched: false, pid: null, error: "spawn ENOENT" });
	assert.equal(unrefs, 1);
	const silent = await runProjectMapOpenPiFallback(fallback, { mkdir: (() => {}) as never, spawn: (() => ({ pid: 7, once: () => undefined })) as never, settleMs: 5 });
	assert.deepEqual(silent, { launched: false, pid: null, error: "the background runner did not report a spawn within 5ms." });
});

test("fallback strips the parent's interactive-host signal and keeps its own launch identity", () => {
	const plan = {
		decision: "refuse" as const, argv: [], cwd: "/worktree", handoff: "brief", sessionName: "project-map-open-pi-catalog", attachCommand: [], launcher: { command: "", path: "", source: "path" as const }, diagnostics: [],
		env: { GENTLE_SHELL_INTERACTIVE_HOST: "1", KEEP: "yes", [PROJECT_MAP_OPEN_PI_ENV]: JSON.stringify({ capabilityId: "catalog", parentSessionId: "session-a" }) },
		readiness: { diagnostics: [] } as unknown as ReturnType<typeof readiness>,
	};
	const fallback = planProjectMapOpenPiFallback(plan, { sessionDir: "/sessions", pi: { command: "/pi", args: [] } });
	assert.equal(fallback.env.GENTLE_SHELL_INTERACTIVE_HOST, undefined);
	assert.equal(fallback.env.KEEP, "yes");
	assert.match(fallback.argv.join(" "), /--append-system-prompt brief brief$/);
});

test("tmux adapter passes its detached plan through an injected runner", () => {
	const plan = {
		decision: "open" as const, argv: ["tmux", "new-session", "-d"], cwd: "/worktree", env: {}, handoff: "test", diagnostics: [],
		readiness: {} as ReturnType<typeof readiness>, sessionName: "project-map-open-pi-catalog", attachCommand: ["tmux", "attach-session", "-t", "project-map-open-pi-catalog"], launcher: { command: "sh", path: "sh", source: "path" as const },
	};
	let call: unknown;
	assert.deepEqual(openProjectMapPi(plan, ((command, args, options) => { call = { command, args, options }; return ""; }) as typeof execFileSync), { launched: true, error: null });
	assert.deepEqual(call, { command: "tmux", args: ["new-session", "-d"], options: { cwd: "/worktree", env: {}, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true } });
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

function confirmationBinding(sessionId: string, workspaceRoot: string, boundAt: string, pid = process.pid): string {
	const serialized = serializeProjectMapStoreValue("session-binding", { schema: "gentle-shell.project-map-store/v1", kind: "session-binding", session_id: sessionId, pid, incarnation: INCARNATION, workspace_root: workspaceRoot, bound_at: boundAt });
	assert.ok(serialized.record);
	return serialized.record;
}

function confirmationEntry(sessionId: string): string {
	return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

test("confirmation requires this child's fresh post-launch binding through injected readers", async () => {
	const freshBinding = { heartbeat: { session_id: "child", pid: process.pid, incarnation: INCARNATION, beat_at: "2026-09-26T12:00:00.001Z" }, status: "fresh", diagnostics: [] };
	const result = await awaitProjectMapOpenPiConfirmation({
		root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => "2026-09-26T12:00:01.000Z",
		readdir: () => [confirmationEntry("child")], readFile: () => confirmationBinding("child", "/worktree", "2026-09-26T12:00:00.001Z"),
		readHeartbeat: (() => freshBinding) as never,
		sleep: async () => { throw new Error("a confirmed first attempt must not sleep"); },
	});
	assert.deepEqual(result, { confirmed: true, sessionId: "child", heartbeat: "fresh", observation: `session "child" (pid ${process.pid}) wrote its own binding for "/worktree" at 2026-09-26T12:00:00.001Z with a fresh heartbeat, and this identifies the capability worktree rather than the exact child, because this host does not expose the launched child's pid.`, diagnostics: [] });
	// With the launched child's pid known, the same evidence says so and requires the match.
	const matched = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, expectedPid: process.pid, timeoutMs: 0, now: () => NOW, readdir: () => [confirmationEntry("child")], readFile: () => confirmationBinding("child", "/worktree", "2026-09-26T12:00:00.001Z"), readHeartbeat: (() => freshBinding) as never });
	assert.equal(matched.confirmed, true); assert.match(matched.observation, /matches the child this launch started/);
	// A permissive heartbeat keeps the pid filter the only reason this cannot confirm.
	const otherPid = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, expectedPid: 4242, timeoutMs: 0, now: () => NOW, readdir: () => [confirmationEntry("child")], readFile: () => confirmationBinding("child", "/worktree", "2026-09-26T12:00:00.001Z"), readHeartbeat: (() => freshBinding) as never });
	assert.equal(otherPid.confirmed, false);
	// A fresh heartbeat belonging to a different process is a mixed pair, not evidence.
	const mixed = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => NOW, readdir: () => [confirmationEntry("child")], readFile: () => confirmationBinding("child", "/worktree", "2026-09-26T12:00:00.001Z"), readHeartbeat: (() => ({ heartbeat: { session_id: "child", pid: 4242, incarnation: INCARNATION, beat_at: NOW }, status: "fresh", diagnostics: [] })) as never });
	assert.equal(mixed.confirmed, false);
});

test("confirmation rejects stale, dead, foreign, and pre-launch evidence without sleeping at timeout", async () => {
	let sleeps = 0, heartbeatReads = 0;
	const records = new Map([
		[confirmationEntry("stale"), confirmationBinding("stale", "/worktree", "2026-09-26T12:00:00.001Z")],
		[confirmationEntry("dead"), confirmationBinding("dead", "/worktree", "2026-09-26T12:00:00.001Z", 999_999)],
		[confirmationEntry("foreign"), confirmationBinding("foreign", "/other-worktree", "2026-09-26T12:00:00.001Z")],
		[confirmationEntry("old"), confirmationBinding("old", "/worktree", "2026-09-26T11:59:59.999Z")],
	]);
	const result = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => NOW,
		readdir: () => [...records.keys()], readFile: (path) => records.get(path.slice(path.lastIndexOf("/") + 1))!,
		readHeartbeat: (() => { heartbeatReads += 1; return { heartbeat: null, status: "stale", diagnostics: [] }; }) as never,
		sleep: async () => { sleeps += 1; },
	});
	assert.deepEqual(result, { confirmed: false, sessionId: null, heartbeat: null, observation: 'no binding for "/worktree" written at or after 2026-09-26T12:00:00.000Z was observed during 0ms of polling, so the child never proved it started.', diagnostics: [] });
	assert.equal(heartbeatReads, 1); assert.equal(sleeps, 0);
	// An offset spelling that is earlier than the launch must not pass as post-launch evidence,
	// even with a permissive fresh heartbeat, so the instant comparison is the only filter here.
	const offset = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: "2026-09-26T12:00:00.000Z", timeoutMs: 0, now: () => NOW,
		readdir: () => [confirmationEntry("offset")], readFile: () => confirmationBinding("offset", "/worktree", "2026-09-26T13:00:00+02:00"),
		readHeartbeat: (() => ({ heartbeat: { session_id: "offset", pid: process.pid, incarnation: INCARNATION, beat_at: NOW }, status: "fresh", diagnostics: [] })) as never });
	assert.equal(offset.confirmed, false);
});

test("confirmation reports corrupted records and treats a missing sessions directory as no evidence", async () => {
	const corrupted = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => NOW, readdir: () => [confirmationEntry("bad")], readFile: () => "{ bad", readHeartbeat: (() => { throw new Error("corrupted bindings do not read heartbeats"); }) as never });
	assert.equal(corrupted.confirmed, false); assert.ok(corrupted.diagnostics.some((entry) => entry.code === "project-map-store/invalid-json"));
	// A parseable record whose bytes are not the store's canonical form is corrupted, not evidence.
	const nonCanonical = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => NOW, readdir: () => [confirmationEntry("child")], readFile: () => confirmationBinding("child", "/worktree", "2026-09-26T12:00:00.001Z").replace("{", "{ "), readHeartbeat: (() => { throw new Error("non-canonical bindings do not read heartbeats"); }) as never });
	assert.equal(nonCanonical.confirmed, false); assert.ok(nonCanonical.diagnostics.some((entry) => entry.code === "project-map-store/store-corrupted"));
	const missing = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => NOW, readdir: (() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }) as never });
	assert.equal(missing.confirmed, false); assert.deepEqual(missing.diagnostics, []);
	// A reader that fails without an error object must still be contained.
	const thrownNull = await awaitProjectMapOpenPiConfirmation({ root: "/store", worktree: "/worktree", since: NOW, timeoutMs: 0, now: () => NOW, readdir: (() => { throw null; }) as never });
	assert.equal(thrownNull.confirmed, false); assert.ok(thrownNull.diagnostics.some((entry) => entry.code === "project-map-open-pi/confirmation-unreadable"));
});

test("readiness refuses a target nested inside another repository and forwards the boundary code", () => {
	// No provisioned worktree here: the target must be a plain directory inside another repository.
	withFixture(({ cwd, store }) => {
		claim(store);
		const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" }).path;
		// A repository at the worktree base makes the derived target a subdirectory of another working tree, and its
		// common directory is a different clone, so both boundary refusals are forwarded by readiness unchanged.
		execFileSync("git", ["init", "--initial-branch=main", dirname(target)], { stdio: "ignore" });
		mkdirSync(target, { recursive: true }); writeFileSync(join(target, "occupied"), "x");
		const result = readiness(cwd);
		assert.equal(result.permitted, false);
		assert.ok(result.diagnostics.some((entry) => entry.code === "project-map-store/worktree-nested-repository"), result.diagnostics.map((entry) => entry.code).join(","));
		assert.ok(result.diagnostics.some((entry) => entry.code === "project-map-store/worktree-foreign-clone"), result.diagnostics.map((entry) => entry.code).join(","));
	}, projectMap(), false);
});

test("readiness permits the live lead to open a capability claimed by another session and reports the claim owner", () => {
	withFixture(({ cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "session-b", now: NOW }).claim);
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: PROJECT_MAP_LEAD_CAPABILITY_ID, sessionId: "session-a", now: NOW }).claim);
		const result = readiness(cwd);
		assert.equal(result.permitted, true, result.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("\n"));
		assert.equal(result.claim?.sessionId, "session-b");
		assert.equal(result.claim?.status, "live");
	});
});

test("readiness names every readiness disqualifier", () => {
	const cases: Array<{ name: string; map?: ProjectMapV1; prepare?: (fixture: { cwd: string; store: string; git: (args: string[]) => string }) => void; capabilityId?: string; host?: typeof HOST; code: string }> = [
		{ name: "missing capability", capabilityId: "missing", code: "project-map-open-pi/capability-not-found" },
		{ name: "unapproved map", map: projectMap([capability()], { state: "draft" }), code: "project-map-open-pi/capability-not-approved" },
		{ name: "dependency not ready", map: projectMap([capability("dependency"), capability("catalog", { dependsOn: ["dependency"] })]), prepare: ({ store }) => claim(store), code: "project-map-open-pi/dependencies-not-ready" },
		{ name: "open blocker", prepare: ({ store }) => { claim(store); raiseProjectMapStoreBlocker({ root: store, capabilityId: "catalog", blockerId: "blocker", owner: "test", reason: "Blocked", sessionId: "session-a", now: NOW }); }, code: "project-map-open-pi/open-blocker" },
		{ name: "proposed contract", prepare: ({ store }) => { claim(store); assert.ok(proposeProjectMapContract({ root: store, capabilityId: "catalog", contractId: "contract", title: "Contract", digest: `sha256:${"a".repeat(64)}`, sessionId: "session-a", now: NOW }).contract); }, code: "project-map-open-pi/proposed-contract" },
		{ name: "missing live claim", code: "project-map-store/worktree-claim-required" },
		{ name: "stale claim", prepare: ({ store }) => { assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "session-a", now: "2026-09-20T00:00:00.000Z" }).claim); }, code: "project-map-store/worktree-claim-required" },
		{ name: "unprovisioned worktree", prepare: ({ store }) => claim(store), code: "project-map-open-pi/worktree-not-provisioned" },
		{ name: "other claim", prepare: ({ store }) => claim(store, "catalog", "session-b"), code: "project-map-store/claim-held" },
		{ name: "refused worktree", prepare: ({ cwd, store }) => { claim(store); const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" }).path; mkdirSync(target, { recursive: true }); writeFileSync(join(target, "occupied"), "x"); }, code: "project-map-store/worktree-target-not-empty" },
		{ name: "occupied worktree", prepare: ({ cwd, store, git }) => { claim(store); const target = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" }).path; git(["worktree", "add", "-b", "feat/catalog", target]); assert.ok(bindProjectMapStoreSession({ root: store, sessionId: "session-b", workspaceRoot: target, pid: 1, incarnation: INCARNATION, now: NOW }).binding); assert.ok(beatProjectMapStoreHeartbeat({ root: store, sessionId: "session-b", pid: 1, incarnation: INCARNATION, now: NOW }).heartbeat); }, code: "project-map-store/worktree-occupied" },
		{ name: "host unavailable", prepare: ({ store }) => claim(store), host: { available: false, version: null }, code: "project-map-open-pi/host-unavailable" },
	];
	// Three cases own the worktree path themselves: two conflict with a provisioned target, one needs it absent.
	const selfProvisioned = new Set(["refused worktree", "occupied worktree", "unprovisioned worktree"]);
	for (const entry of cases) withFixture(({ cwd, store, git }) => {
		entry.prepare?.({ cwd, store, git });
		const result = readiness(cwd, entry.capabilityId, "session-a", entry.host ?? HOST);
		assert.equal(result.permitted, false, entry.name);
		assert.ok(hasCode(result, entry.code), `${entry.name} should report ${entry.code}`);
	}, entry.map ?? projectMap(), !selfProvisioned.has(entry.name));
});
