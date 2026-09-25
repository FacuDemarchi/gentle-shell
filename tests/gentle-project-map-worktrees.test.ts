import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	applyProjectMapWorktreeProvision,
	runProjectMapCommand,
	type ProjectMapCommandContext,
	type ProjectMapWorktreeRegistrationPort,
} from "../extensions/gentle-project-map.ts";
import { acquireProjectMapClaim } from "../lib/project-map-store-claims.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { bindProjectMapStoreWorktree, listProjectMapStoreWorktreeBindings } from "../lib/project-map-store-worktrees.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { deriveProjectMapWorktreeIdentity, planProjectMapWorktree } from "../lib/project-map-worktrees.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";

interface Harness {
	ctx: ProjectMapCommandContext;
	notified: string[];
	confirmations: number;
	confirmationSnapshots: Array<{ message: string; notified: string[] }>;
}

function harness(cwd: string, sessionId: string, answers: boolean[] = [true]): Harness {
	const notified: string[] = [];
	const state = { confirmations: 0, confirmationSnapshots: [] as Array<{ message: string; notified: string[] }> };
	return {
		ctx: {
			cwd,
			hasUI: true,
			sessionManager: { getSessionId: () => sessionId },
			ui: {
				notify: (message) => { notified.push(message); },
				confirm: async (_title, message) => {
					state.confirmations += 1;
					state.confirmationSnapshots.push({ message, notified: [...notified] });
					return answers.shift() ?? true;
				},
			},
		},
		notified,
		get confirmations() { return state.confirmations; },
		get confirmationSnapshots() { return state.confirmationSnapshots; },
	};
}

function snapshot(root: string): Array<[string, string]> {
	const entries: Array<[string, string]> = [];
	const walk = (directory: string, relative = "") => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
			const path = join(directory, entry.name);
			const name = relative === "" ? entry.name : join(relative, entry.name);
			if (entry.isDirectory()) {
				entries.push([`${name}/`, "directory"]);
				walk(path, name);
			} else entries.push([name, `file:${createHash("sha256").update(readFileSync(path)).digest("hex")}`]);
		}
	};
	walk(root);
	return entries;
}

function withFixture(run: (fixture: { sandbox: string; cwd: string; store: string; git: (args: string[]) => string }) => Promise<void> | void): Promise<void> {
	const sandbox = mkdtempSync(join(tmpdir(), "gentle-project-map-worktree-command-"));
	const cwd = join(sandbox, "main");
	const empty = join(sandbox, "empty");
	mkdirSync(empty);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
	writeFileSync(join(empty, "config"), "", "utf8");
	const git = (args: string[]) => String(execFileSync("git", ["-C", cwd, "-c", `core.hooksPath=${empty}`, "-c", "commit.gpgsign=false", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
	execFileSync("git", ["init", "--initial-branch=main", cwd], { env, stdio: "ignore" });
	git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Fixture"]);
	const resolved = resolveProjectMapStoreRoot(cwd);
	assert.ok(resolved.root && resolved.repositoryId, resolved.diagnostics.map((entry) => entry.message).join("\n"));
	mkdirSync(resolved.root, { recursive: true, mode: 0o700 });
	assert.ok(initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW.toISOString() }).descriptor);
	return Promise.resolve(run({ sandbox, cwd, store: resolved.root, git })).finally(() => rmSync(sandbox, { recursive: true, force: true }));
}

function liveClaim(store: string, capabilityId: string, sessionId = "session-a"): void {
	assert.ok(acquireProjectMapClaim({ root: store, capabilityId, sessionId, now: NOW.toISOString() }).claim);
}

function hasCode(messages: string[], code: string): boolean {
	return messages.some((message) => message.includes(code));
}

test("worktree inspect prints its plan without changing the store or filesystem", async () => {
	await withFixture(async ({ sandbox, cwd, store }) => {
		liveClaim(store, "catalog");
		const before = snapshot(sandbox);
		const probe = harness(cwd, "session-a");
		const report = await runProjectMapCommand("worktree inspect catalog", probe.ctx, { now: () => NOW });
		assert.equal(report.action, "worktree");
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.ok(probe.notified.some((message) => message.includes("feat/catalog") && message.includes("Base commit")));
		assert.deepEqual(snapshot(sandbox), before);
	});
});

test("worktree provision refuses an invalid plan without asking", async () => {
	await withFixture(async ({ sandbox, cwd }) => {
		const before = snapshot(sandbox);
		const probe = harness(cwd, "session-a");
		const report = await runProjectMapCommand("worktree provision catalog", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.ok(hasCode(probe.notified, "project-map-store/worktree-claim-required"));
		assert.deepEqual(snapshot(sandbox), before);
	});
});

test("worktree provision confirms the displayed plan, creates, binds, and registers", async () => {
	await withFixture(async ({ cwd, store, git }) => {
		liveClaim(store, "catalog");
		const registrations: Array<[string, string]> = [];
		const worktrees: ProjectMapWorktreeRegistrationPort = {
			register(path, evidence) {
				registrations.push([path, evidence]);
				return path;
			},
		};
		const probe = harness(cwd, "session-a", [true]);
		const report = await runProjectMapCommand("worktree provision catalog", probe.ctx, { now: () => NOW, worktrees });
		const identity = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" });
		assert.equal(report.wrote, true);
		assert.equal(probe.confirmations, 1);
		const confirmation = probe.confirmationSnapshots[0];
		assert.ok(confirmation);
		assert.ok(confirmation.notified.includes(confirmation.message), "the rendered plan is notified before confirmation");
		// The decision and the base commit must be their real values, not merely their labels: blanking
		// either one while keeping the label in place would otherwise still satisfy this test.
		const plannedBaseCommit = git(["rev-parse", "HEAD"]).trim();
		assert.ok(confirmation.message.includes("Decision: create") && confirmation.message.includes("Branch: feat/catalog") && confirmation.message.includes(`Path: ${identity.path}`) && confirmation.message.includes(`Base commit: ${plannedBaseCommit}`));
		assert.equal(existsSync(identity.path), true);
		assert.deepEqual(registrations, [[identity.path, "capability:catalog"]]);
		const bindings = listProjectMapStoreWorktreeBindings({ root: store });
		assert.deepEqual(bindings.diagnostics, []);
		assert.deepEqual(bindings.bindings.map((binding) => [binding.capability_id, binding.branch, binding.worktree_root, binding.session_id]), [["catalog", "feat/catalog", identity.path, "session-a"]]);
	});
});

test("worktree provision refuses when the plan's base changes during confirmation", async () => {
	await withFixture(async ({ cwd, store, git }) => {
		liveClaim(store, "catalog");
		const probe = harness(cwd, "session-a");
		const confirm = probe.ctx.ui.confirm;
		probe.ctx.ui.confirm = async (title, message) => {
			git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Changed during confirmation"]);
			return confirm(title, message);
		};
		const report = await runProjectMapCommand("worktree provision catalog", probe.ctx, { now: () => NOW });
		const identity = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 1);
		assert.equal(existsSync(identity.path), false);
		assert.deepEqual(listProjectMapStoreWorktreeBindings({ root: store }).bindings, []);
		assert.ok(probe.notified.some((message) => message.includes("approved worktree plan no longer matches")));
	});
});

test("worktree provision creates, binds, and registers nothing when declined", async () => {
	await withFixture(async ({ cwd, store }) => {
		liveClaim(store, "catalog");
		const registrations: Array<[string, string]> = [];
		const probe = harness(cwd, "session-a", [false]);
		const report = await runProjectMapCommand("worktree provision catalog", probe.ctx, {
			now: () => NOW,
			worktrees: { register: (path, evidence) => { registrations.push([path, evidence]); return path; } },
		});
		const identity = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 1);
		assert.equal(existsSync(identity.path), false);
		assert.deepEqual(registrations, []);
		assert.deepEqual(listProjectMapStoreWorktreeBindings({ root: store }).bindings, []);
	});
});

test("an uncertain provision does not register or bind, while a verified provision does", async () => {
	await withFixture(({ cwd, store }) => {
		liveClaim(store, "catalog");
		const plan = planProjectMapWorktree({ cwd, capabilityId: "catalog", sessionId: "session-a", now: NOW.toISOString() });
		const registrations: Array<[string, string]> = [];
		const worktrees = { register: (path: string, evidence: string) => { registrations.push([path, evidence]); return path; } };
		const uncertain = applyProjectMapWorktreeProvision({
			plan,
			provisioned: { decision: "create", created: null, branchCreated: null, outcome: "uncertain", branch: plan.inspection.identity.branch, path: plan.inspection.identity.path, baseCommit: plan.baseCommit, dirty: false, diagnostics: [] },
			root: store,
			capabilityId: "catalog",
			sessionId: "session-a",
			now: NOW.toISOString(),
			worktrees,
		});
		assert.equal(uncertain.wrote, false);
		assert.deepEqual(registrations, []);
		assert.deepEqual(listProjectMapStoreWorktreeBindings({ root: store }).bindings, []);
		assert.ok(uncertain.notifications.some((message) => message.includes("uncertain")));

		const verified = applyProjectMapWorktreeProvision({
			plan,
			provisioned: { decision: "create", created: true, branchCreated: true, outcome: "verified", branch: plan.inspection.identity.branch, path: plan.inspection.identity.path, baseCommit: plan.baseCommit, dirty: false, diagnostics: [] },
			root: store,
			capabilityId: "catalog",
			sessionId: "session-a",
			now: NOW.toISOString(),
			worktrees,
		});
		assert.equal(verified.wrote, true);
		assert.deepEqual(registrations, [[plan.inspection.identity.path, "capability:catalog"]]);
		assert.equal(listProjectMapStoreWorktreeBindings({ root: store }).bindings[0]?.capability_id, "catalog");
	});
});

test("worktree provision without a registry warns and still binds the verified result", async () => {
	await withFixture(async ({ cwd, store }) => {
		liveClaim(store, "catalog");
		const probe = harness(cwd, "session-a", [true]);
		const report = await runProjectMapCommand("worktree provision catalog", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, true);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.severity === "warning" && diagnostic.message.includes("no session worktree registry")));
		assert.ok(probe.notified.some((message) => message.includes("warning") && message.includes("no session worktree registry")));
		// The successful result must still be reported on the missing-port path, not only the warning.
		const identity = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" });
		assert.ok(probe.notified.some((message) => message.includes("Capability worktree created") && message.includes("feat/catalog") && message.includes(identity.path)));
		assert.equal(listProjectMapStoreWorktreeBindings({ root: store }).bindings[0]?.capability_id, "catalog");
	});
});

test("worktree registration failure warns without losing a verified provision or binding", async () => {
	await withFixture(async ({ cwd, store }) => {
		liveClaim(store, "catalog");
		const probe = harness(cwd, "session-a", [true]);
		const report = await runProjectMapCommand("worktree provision catalog", probe.ctx, {
			now: () => NOW,
			worktrees: { register: () => { throw new Error("inactive session"); } },
		});
		const identity = deriveProjectMapWorktreeIdentity({ repositoryRoot: cwd, capabilityId: "catalog" });
		assert.equal(report.wrote, true);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.severity === "warning" && diagnostic.message.includes("inactive session")));
		assert.ok(probe.notified.some((message) => message.includes("warning") && message.includes("inactive session")));
		assert.ok(probe.notified.some((message) => message.includes("Capability worktree created") && message.includes("feat/catalog") && message.includes(identity.path)));
		assert.equal(listProjectMapStoreWorktreeBindings({ root: store }).bindings[0]?.capability_id, "catalog");
	});
});

test("worktree list prints bindings and reports corrupt records", async () => {
	await withFixture(async ({ cwd, store }) => {
		for (const capabilityId of ["billing", "catalog"]) {
			assert.ok(bindProjectMapStoreWorktree({
				root: store,
				capabilityId,
				branch: `feat/${capabilityId}`,
				worktreeRoot: join(cwd, "..", "main-worktrees", capabilityId),
				sessionId: "session-a",
				baseCommit: "a".repeat(40),
				now: NOW.toISOString(),
			}).binding);
		}
		mkdirSync(join(store, "worktrees"), { recursive: true });
		writeFileSync(join(store, "worktrees", "corrupt.json"), "{", "utf8");
		const probe = harness(cwd, "session-a");
		const report = await runProjectMapCommand("worktree list", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(probe.notified.some((message) => message.includes("billing") && message.includes("feat/billing") && message.includes(join(cwd, "..", "main-worktrees", "billing"))));
		assert.ok(hasCode(probe.notified, "project-map-store/store-corrupted"));
	});
});
