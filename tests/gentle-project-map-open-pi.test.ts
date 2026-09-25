import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import gentleProjectMap, { handleProjectMapOpenPiSessionStart, runProjectMapCommand, type ProjectMapCommandContext } from "../extensions/gentle-project-map.ts";
import { readProjectMapCoordinationState } from "../lib/project-map-coordination-state.ts";
import { acquireProjectMapClaim } from "../lib/project-map-store-claims.ts";
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

function context(cwd: string, sessionId = "parent", answers: boolean[] = [true]) {
	const notified: string[] = [], confirmations: Array<{ title: string; message: string; notified: string[] }> = [];
	const ctx: ProjectMapCommandContext = { cwd, hasUI: true, sessionManager: { getSessionId: () => sessionId }, ui: { notify: (message) => notified.push(message), confirm: async (title, message) => { confirmations.push({ title, message, notified: [...notified] }); return answers.shift() ?? true; } } };
	return { ctx, notified, confirmations };
}

test("open prints the real plan before its confirmation, and refusal never asks or launches", async () => {
	await withFixture(async ({ cwd, store }) => {
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "parent", now: NOW }).claim);
		const open = context(cwd), launches: unknown[] = [];
		await runProjectMapCommand("open catalog", open.ctx, { now: () => new Date(NOW), host: { available: true, version: "tmux test" }, launch: (plan) => { launches.push(plan); return { launched: true, error: null }; } });
		assert.equal(open.confirmations.length, 1); assert.ok(open.confirmations[0]!.notified.includes(open.confirmations[0]!.message));
		assert.match(open.confirmations[0]!.message, /Decision: open/); assert.match(open.confirmations[0]!.message, new RegExp(`Path: ${launches[0] && (launches[0] as { cwd: string }).cwd}`)); assert.match(open.confirmations[0]!.message, /Attach: tmux attach-session -t project-map-open-pi-catalog/); assert.equal(launches.length, 1);
		const refused = context(cwd), noLaunches: unknown[] = [];
		await runProjectMapCommand("open catalog", refused.ctx, { now: () => new Date(NOW), host: { available: false, version: null }, launch: (plan) => { noLaunches.push(plan); return { launched: true, error: null }; } });
		assert.equal(refused.confirmations.length, 0); assert.equal(noLaunches.length, 0);
	});
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
