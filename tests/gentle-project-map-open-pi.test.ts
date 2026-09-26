import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import gentleProjectMap, { handleProjectMapOpenPiSessionStart, OPEN_PI_SUBAGENT_CHOICE, OPEN_PI_TMUX_CHOICE, openPiFallbackOfferTitle, openPiSubagentSessionDir, runProjectMapCommand, type ProjectMapCommandContext } from "../extensions/gentle-project-map.ts";
import { planProjectMapOpenPi } from "../lib/project-map-open-pi.ts";
import { resolveGentlePiAgentHome } from "../lib/agent-home.ts";
import { agentRuntimePaths } from "../extensions/gentle-agents.ts";
import { readProjectMapCoordinationState } from "../lib/project-map-coordination-state.ts";
import { acquireProjectMapClaim, releaseProjectMapClaim } from "../lib/project-map-store-claims.ts";
import { readProjectMapStoreHeartbeat, readProjectMapStoreSessionBinding } from "../lib/project-map-store-heartbeats.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { PROJECT_MAP_ARTIFACT_PATH, PROJECT_MAP_SCHEMA_V1, serializeProjectMap } from "../lib/shell-project-map-schema.ts";

const NOW = "2026-09-26T12:00:00.000Z";
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";
const ENV = JSON.stringify({ capabilityId: "catalog", parentSessionId: "parent" });

function snapshot(root: string): Array<[string, string]> {
	const entries: Array<[string, string]> = [];
	const walk = (directory: string, relative = "") => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(directory, entry.name), name = relative ? join(relative, entry.name) : entry.name;
			if (entry.isDirectory()) { entries.push([`${name}/`, "directory"]); walk(path, name); }
			else entries.push([name, createHash("sha256").update(readFileSync(path)).digest("hex")]);
		}
	};
	walk(root); return entries;
}

function withFixture(run: (fixture: { sandbox: string; cwd: string; store: string }) => Promise<void> | void): Promise<void> {
	const sandbox = mkdtempSync(join(tmpdir(), "gentle-project-map-open-pi-")), cwd = join(sandbox, "main"), empty = join(sandbox, "empty");
	mkdirSync(empty); writeFileSync(join(empty, "config"), "");
	const env = { ...process.env, GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
	const execute = async () => {
		execFileSync("git", ["init", "--initial-branch=main", cwd], { env, stdio: "ignore" });
		execFileSync("git", ["-C", cwd, "-c", `core.hooksPath=${empty}`, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Fixture"], { env, stdio: "ignore" });
		mkdirSync(dirname(join(cwd, PROJECT_MAP_ARTIFACT_PATH)), { recursive: true });
		writeFileSync(join(cwd, PROJECT_MAP_ARTIFACT_PATH), serializeProjectMap({ version: PROJECT_MAP_SCHEMA_V1, project: { id: "example", name: "Example" }, approval: { state: "approved", approvedAt: NOW, approvedBy: "test" }, foundations: [], capabilities: [{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "ready" }] }));
		const resolved = resolveProjectMapStoreRoot(cwd); assert.ok(resolved.root && resolved.repositoryId);
		mkdirSync(resolved.root, { recursive: true }); assert.ok(initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW }).descriptor);
		await run({ sandbox, cwd, store: resolved.root });
	};
	return execute().finally(() => rmSync(sandbox, { recursive: true, force: true }));
}

function context(cwd: string, sessionId = "parent", answers: boolean[] = [true], selections?: Array<string | undefined>) {
	const notified: string[] = [], confirmations: Array<{ title: string; message: string; notified: string[] }> = [], selected: Array<{ title: string; options: string[] }> = [];
	const ui: ProjectMapCommandContext["ui"] = { notify: (message) => notified.push(message), confirm: async (title, message) => { confirmations.push({ title, message, notified: [...notified] }); return answers.shift() ?? true; } };
	if (selections !== undefined) ui.select = async (title, options) => { selected.push({ title, options }); return selections.shift(); };
	const ctx: ProjectMapCommandContext = { cwd, hasUI: true, sessionManager: { getSessionId: () => sessionId }, ui };
	return { ctx, notified, confirmations, selected };
}

test("open offers explicit tmux or background choices and never silently falls back", async () => {
	await withFixture(async ({ cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		for (const [choice, tmuxCalls, subagentCalls] of [[OPEN_PI_TMUX_CHOICE, 1, 0], [OPEN_PI_SUBAGENT_CHOICE, 0, 1], [undefined, 0, 0]] as const) {
			const open = context(cwd, "parent", [true], [choice]), launches: unknown[] = [], subagents: unknown[] = [];
			await runProjectMapCommand("open catalog", open.ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; }, subagentLaunch: async (fallback) => { subagents.push(fallback); return { launched: true, pid: 1, error: null }; }, subagentSessionDir: () => "/sessions" });
			assert.deepEqual(open.selected, [{ title: "Open Pi for this capability?", options: [OPEN_PI_TMUX_CHOICE, OPEN_PI_SUBAGENT_CHOICE] }]); assert.equal(open.confirmations.length, 0); assert.equal(launches.length, tmuxCalls); assert.equal(subagents.length, subagentCalls);
			if (subagents.length) { const fallback = subagents[0] as { cwd: string; argv: string[]; handoff: string }; assert.match(fallback.cwd, /catalog$/); assert.ok(fallback.argv.includes(fallback.handoff)); assert.ok(open.notified.some((message) => message.includes("Background subagent launch requested"))); }
			if (choice === undefined) assert.ok(open.notified.includes("Opening Pi was declined; nothing was launched."));
		}
		for (const [answer, expected] of [[false, 0], [true, 1]] as const) {
			const open = context(cwd, "parent", [answer]), launches: unknown[] = [], subagents: unknown[] = [];
			await runProjectMapCommand("open catalog", open.ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; }, subagentLaunch: async (fallback) => { subagents.push(fallback); return { launched: true, pid: 1, error: null }; } });
			assert.equal(open.confirmations.length, 1); assert.equal(launches.length, expected); assert.equal(subagents.length, 0);
			assert.ok(open.confirmations[0]!.notified.includes(open.confirmations[0]!.message), "the plan is displayed before the confirmation");
			assert.match(open.confirmations[0]!.message, /Decision: open/);
			assert.match(open.confirmations[0]!.message, /Path: /);
			assert.match(open.confirmations[0]!.message, /Attach: tmux attach-session -t project-map-open-pi-catalog/);
		}
	});
});

test("open never launches the fallback when the fallback plan itself refuses", async () => {
	await withFixture(async ({ cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		const open = context(cwd, "parent", [true], [OPEN_PI_SUBAGENT_CHOICE]), launches: unknown[] = [], subagents: unknown[] = [];
		await runProjectMapCommand("open catalog", open.ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; }, subagentLaunch: async (fallback) => { subagents.push(fallback); return { launched: true, pid: 1, error: null }; }, subagentSessionDir: () => " " });
		assert.equal(open.selected.length, 1); assert.equal(launches.length, 0); assert.equal(subagents.length, 0);
		assert.ok(open.notified.some((message) => message.includes("project-map-open-pi/session-dir-required")));
		assert.ok(open.notified.includes("Opening Pi was declined; nothing was launched."));
	});
});

test("the fallback offer names the real refusal and reports a failed background launch honestly", async () => {
	await withFixture(async ({ cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		const refusedLauncher = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "parent", now: NOW, host: { available: true, version: "tmux test" }, launcher: null });
		assert.match(openPiFallbackOfferTitle(refusedLauncher), /The tmux launch was refused/);
		const hostless = planProjectMapOpenPi({ cwd, capabilityId: "catalog", sessionId: "parent", now: NOW, host: { available: false, version: null } });
		assert.match(openPiFallbackOfferTitle(hostless), /tmux is unavailable/);
		const failed = context(cwd, "parent", [true]);
		await runProjectMapCommand("open catalog", failed.ctx, { now: () => new Date(NOW), host: { available: false, version: null }, subagentLaunch: async () => ({ launched: false, pid: null, error: "spawn ENOENT" }) });
		assert.ok(failed.notified.some((message) => message.includes("Background subagent launch failed: spawn ENOENT.")));
		assert.equal(failed.notified.some((message) => message.includes("launch requested")), false);
	});
});

test("open offers background launch only after an affirmative host-unavailable confirmation", async () => {
	await withFixture(async ({ sandbox, cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		for (const answer of [true, false]) {
			const open = context(cwd, "parent", [answer]), launches: unknown[] = [], subagents: unknown[] = [], before = snapshot(sandbox);
			await runProjectMapCommand("open catalog", open.ctx, { now: () => new Date(NOW), host: { available: false, version: null }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; }, subagentLaunch: async (fallback) => { subagents.push(fallback); return { launched: true, pid: 1, error: null }; }, subagentSessionDir: () => "/sessions" });
			assert.equal(open.confirmations.length, 1); assert.match(open.confirmations[0]!.title, /tmux is unavailable/); assert.equal(launches.length, 0); assert.equal(subagents.length, answer ? 1 : 0); assert.equal(open.notified.some((message) => message.includes("Pi launch requested")), false); if (!answer) assert.deepEqual(snapshot(sandbox), before);
		}
		const headless = context(cwd), headlessCtx = { ...headless.ctx, hasUI: false }, none: unknown[] = [];
		await runProjectMapCommand("open catalog", headlessCtx, { now: () => new Date(NOW), host: { available: false, version: null }, launch: () => { throw new Error("must not launch"); }, subagentLaunch: async (fallback) => { none.push(fallback); return { launched: true, pid: 1, error: null }; } });
		assert.equal(headless.confirmations.length, 0); assert.equal(none.length, 0); assert.ok(headless.notified.some((message) => message.includes("no UI")));
		assert.equal(releaseProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).released, true);
		const noClaim = context(cwd), blocked: unknown[] = [];
		await runProjectMapCommand("open catalog", noClaim.ctx, { now: () => new Date(NOW), host: { available: false, version: null }, subagentLaunch: async (fallback) => { blocked.push(fallback); return { launched: true, pid: 1, error: null }; } });
		assert.equal(noClaim.confirmations.length, 0); assert.equal(blocked.length, 0); assert.ok(noClaim.notified.some((message) => message.includes("Opening Pi was refused.")));
	});
});

test("open subagent session path matches the agent runtime layout", () => {
	const env = { GENTLE_PI_AGENT_HOME: "/agent-home" };
	assert.equal(openPiSubagentSessionDir(env), agentRuntimePaths("/unused", resolveGentlePiAgentHome(env)).sessions);
});

test("open reports a spawn failure and a declined confirmation without claiming launch", async () => {
	await withFixture(async ({ cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		const failed = context(cwd); await runProjectMapCommand("open catalog", failed.ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: () => ({ launched: false, error: "boom" }) });
		assert.ok(failed.notified.some((message) => message.includes("Pi launch failed: boom"))); assert.equal(failed.notified.some((message) => message.includes("Pi launch requested")), false);
		const declined = context(cwd, "parent", [false]), launches: unknown[] = [], before = snapshot(cwd); await runProjectMapCommand("open catalog", declined.ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; } });
		assert.equal(launches.length, 0); assert.equal(declined.confirmations.length, 1); assert.deepEqual(snapshot(cwd), before);
	});
});

test("open refuses to launch without a visible confirmation when the context has no UI", async () => {
	await withFixture(async ({ sandbox, cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		const headless = context(cwd), ctx: ProjectMapCommandContext = { ...headless.ctx, hasUI: false };
		const launches: unknown[] = [], before = snapshot(sandbox);
		await runProjectMapCommand("open catalog", ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; } });
		assert.equal(headless.confirmations.length, 0);
		assert.equal(launches.length, 0);
		assert.ok(headless.notified.some((message) => message.includes("no UI")));
		assert.equal(headless.notified.some((message) => message.includes("Pi launch requested")), false);
		assert.deepEqual(snapshot(sandbox), before);
	});
});

test("the receiver is inert without launch identity and writes its child binding and heartbeat without stealing claims", () => {
	return withFixture(({ sandbox, cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		const inert = context(cwd, "child"), before = snapshot(sandbox); handleProjectMapOpenPiSessionStart(inert.ctx, undefined, () => NOW); assert.deepEqual(snapshot(sandbox), before); assert.deepEqual(inert.notified, []);
		const child = context(cwd, "child"); handleProjectMapOpenPiSessionStart(child.ctx, ENV, () => NOW);
		assert.equal(readProjectMapStoreSessionBinding({ root: store, sessionId: "child" }).binding?.workspace_root, cwd); assert.equal(readProjectMapStoreSessionBinding({ root: store, sessionId: "child" }).binding?.session_id, "child"); assert.equal(readProjectMapStoreHeartbeat({ root: store, sessionId: "child", now: NOW }).heartbeat?.session_id, "child");
		assert.equal(readProjectMapStoreSessionBinding({ root: store, sessionId: "parent" }).binding, null); assert.equal(readProjectMapCoordinationState({ root: store, mapPath: join(cwd, PROJECT_MAP_ARTIFACT_PATH), now: NOW }).satellites.find((claim) => claim.capabilityId === "catalog")?.sessionId, "parent");
	});
});

test("the receiver reports a failed store write without throwing", () => {
	return withFixture(({ cwd }) => {
		const failed = context(cwd, "child");
		assert.doesNotThrow(() => handleProjectMapOpenPiSessionStart(failed.ctx, ENV, () => NOW, { bind: () => ({ binding: null, diagnostics: [{ code: "store-failed", path: "$", message: "write failed", severity: "error" }] }), heartbeat: () => { throw new Error("heartbeat must not run"); } } as never));
		assert.ok(failed.notified.some((message) => message.includes("store-failed") && message.includes("write failed")));
	});
});
