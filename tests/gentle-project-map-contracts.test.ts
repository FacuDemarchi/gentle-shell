import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PROJECT_MAP_SUB_ACTIONS,
	parseProjectMapSubAction,
	runProjectMapCommand as runProjectMapCommandWithGate,
	type ProjectMapCommandContext,
} from "../extensions/gentle-project-map.ts";
import { PROJECT_MAP_EXECUTABLE_ENV } from "../lib/shell-project-map-gate.ts";
import { PROJECT_MAP_LEAD_CAPABILITY_ID } from "../lib/project-map-coordination-state.ts";
import { readProjectMapContract } from "../lib/project-map-store-contracts.ts";
import { PROJECT_MAP_STORE_DIAGNOSTIC_CODES } from "../lib/project-map-store-schema.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { PROJECT_MAP_SCHEMA_V1, serializeProjectMap, type ProjectMapV1 } from "../lib/shell-project-map-schema.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
// PM9-1: the executable half is opt-in and these cases drive it, so every call runs with the
// gate explicitly on unless a case overrides `env`. What is under test is the route's own
// behavior, not the switch that guards it — the switch has its own cases.
const ENABLED_ENV: NodeJS.ProcessEnv = { [PROJECT_MAP_EXECUTABLE_ENV]: "1" };
const runProjectMapCommand: typeof runProjectMapCommandWithGate = (command, ctx, options = {}) => runProjectMapCommandWithGate(command, ctx, { env: ENABLED_ENV, ...options });
const LATER = new Date("2026-09-26T12:00:10.000Z");
/** Past the 60-second claim lease: the holder is gone, not merely quiet. */
const EXPIRED = new Date("2026-09-26T12:02:00.000Z");
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";

interface Harness {
	ctx: ProjectMapCommandContext;
	notified: string[];
	confirmations: number;
}

function harness(cwd: string, sessionId: string, answers: boolean[] = [true]): Harness {
	const notified: string[] = [];
	const state = { confirmations: 0 };
	return {
		ctx: {
			cwd,
			hasUI: true,
			sessionManager: { getSessionId: () => sessionId },
			ui: {
				notify: (message) => { notified.push(message); },
				confirm: async () => { state.confirmations += 1; return answers.shift() ?? true; },
			},
		},
		notified,
		get confirmations() { return state.confirmations; },
	};
}

function map(): ProjectMapV1 {
	return {
		version: PROJECT_MAP_SCHEMA_V1,
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "approved", approvedAt: NOW.toISOString(), approvedBy: "human" },
		foundations: [],
		capabilities: [{ id: "catalog", outcome: "Catalog is available.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "planned" }],
	};
}

function withFixture(run: (fixture: { cwd: string; store: string; artifact: string }) => Promise<void> | void): Promise<void> {
	const cwd = mkdtempSync(join(tmpdir(), "gentle-project-map-contracts-"));
	const empty = join(cwd, "empty");
	mkdirSync(empty);
	const env = { ...process.env, GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
	writeFileSync(join(empty, "config"), "", "utf8");
	execFileSync("git", ["init", "--initial-branch=main", cwd], { env, stdio: "ignore" });
	const artifact = join(cwd, "openspec", "project-map.json");
	mkdirSync(join(cwd, "openspec"), { recursive: true });
	writeFileSync(artifact, serializeProjectMap(map()), "utf8");
	const resolved = resolveProjectMapStoreRoot(cwd);
	assert.ok(resolved.root && resolved.repositoryId, resolved.diagnostics.map((entry) => entry.message).join("\n"));
	mkdirSync(resolved.root, { recursive: true, mode: 0o700 });
	const initialized = initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: EPOCH, now: NOW.toISOString() });
	assert.ok(initialized.descriptor, initialized.diagnostics.map((entry) => entry.message).join("\n"));
	return Promise.resolve(run({ cwd, store: resolved.root, artifact })).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

function claimPath(store: string): string {
	return join(store, "claims", `${createHash("sha256").update(PROJECT_MAP_LEAD_CAPABILITY_ID).digest("hex")}.json`);
}

function capabilityClaimPath(store: string, capabilityId: string): string {
	return join(store, "claims", `${createHash("sha256").update(capabilityId).digest("hex")}.json`);
}

function hasCode(messages: string[], code: string): boolean {
	return messages.some((message) => message.includes(code));
}

test("parser accepts lead and contract while still rejecting an unknown sub-action", () => {
	assert.ok(PROJECT_MAP_SUB_ACTIONS.includes("lead"));
	assert.ok(PROJECT_MAP_SUB_ACTIONS.includes("contract"));
	assert.equal(parseProjectMapSubAction("lead claim").action, "lead");
	assert.equal(parseProjectMapSubAction("lead claim catalog").action, "lead");
	assert.equal(parseProjectMapSubAction("lead claim catalog").argument, "claim catalog");
	assert.equal(parseProjectMapSubAction("contract list").action, "contract");
	assert.equal(parseProjectMapSubAction("unknown").ok, false);
});

test("lead claim belongs to one session and preserves bytes on claim-held", async () => {
	await withFixture(async ({ cwd, store }) => {
		const first = await runProjectMapCommand("lead claim", harness(cwd, "session-a").ctx, { now: () => NOW });
		assert.equal(first.wrote, true, "the claim is a durable store record, so the report says something was written");
		const before = readFileSync(claimPath(store), "utf8");
		const secondProbe = harness(cwd, "session-b");
		const second = await runProjectMapCommand("lead claim", secondProbe.ctx, { now: () => LATER });
		assert.equal(second.wrote, false, "a refused claim changes nothing");
		assert.ok(hasCode(secondProbe.notified, "project-map-store/claim-held"));
		assert.equal(readFileSync(claimPath(store), "utf8"), before);
	});
});

test("a stale claim recovered by the next session is reported as a recovery, not a refusal", async () => {
	await withFixture(async ({ cwd, store }) => {
		await runProjectMapCommand("lead claim", harness(cwd, "dead-session").ctx, { now: () => NOW });
		const survivor = harness(cwd, "survivor");
		const report = await runProjectMapCommand("lead claim", survivor.ctx, { now: () => EXPIRED });
		assert.equal((JSON.parse(readFileSync(claimPath(store), "utf8")) as { session_id: string }).session_id, "survivor");
		assert.equal(report.wrote, true, "the claim moved, so the report says something was written");
		assert.deepEqual(report.diagnostics.map((entry) => entry.severity), ["warning"], "a recovery is a warning, never an error");
		assert.ok(hasCode(survivor.notified, "project-map-store/stale-claim-recovered"), "the recovery warning is surfaced rather than swallowed");
		assert.ok(survivor.notified.some((message) => message.includes("Claimed the Project Map lead claim")), survivor.notified.join("\n"));
		assert.equal(survivor.notified.some((message) => message.includes("was refused")), false, "a recovery must not be announced as a refusal");
	});
});

test("a renewal outside its cadence is refused, and every lead mutation reports honestly", async () => {
	await withFixture(async ({ cwd, store }) => {
		await runProjectMapCommand("lead claim", harness(cwd, "session-a").ctx, { now: () => NOW });
		const early = harness(cwd, "session-a");
		const renewal = await runProjectMapCommand("lead renew", early.ctx, { now: () => NOW });
		assert.equal(renewal.wrote, false, "a cadence refusal writes nothing");
		assert.ok(hasCode(early.notified, "project-map-store/renewal-too-early"));
		const later = harness(cwd, "session-a");
		const renewed = await runProjectMapCommand("lead renew", later.ctx, { now: () => LATER });
		assert.equal(renewed.wrote, true, "a renewal rewrites the lease");
		const released = await runProjectMapCommand("lead release", harness(cwd, "session-a").ctx, { now: () => LATER });
		assert.equal(released.wrote, true, "releasing removes the record, which is a change too");
		assert.equal(existsSync(claimPath(store)), false, "the claim record is gone");
	});
});

test("lead status reports the current lead and a free store", async () => {
	await withFixture(async ({ cwd }) => {
		const free = harness(cwd, "session-a");
		await runProjectMapCommand("lead status", free.ctx, { now: () => NOW });
		assert.ok(free.notified.some((message) => message.includes("free")));
		await runProjectMapCommand("lead claim", harness(cwd, "session-a").ctx, { now: () => NOW });
		const live = harness(cwd, "session-b");
		await runProjectMapCommand("lead status", live.ctx, { now: () => NOW });
		assert.ok(live.notified.some((message) => message.includes("session-a") && message.includes("live")));
	});
});

test("lead renew enforces cadence and release makes it free", async () => {
	await withFixture(async ({ cwd }) => {
		await runProjectMapCommand("lead claim", harness(cwd, "session-a").ctx, { now: () => NOW });
		const renewal = harness(cwd, "session-a");
		await runProjectMapCommand("lead renew", renewal.ctx, { now: () => NOW });
		assert.ok(hasCode(renewal.notified, "project-map-store/renewal-too-early"));
		await runProjectMapCommand("lead release", harness(cwd, "session-a").ctx, { now: () => LATER });
		const status = harness(cwd, "session-b");
		await runProjectMapCommand("lead status", status.ctx, { now: () => LATER });
		assert.ok(status.notified.some((message) => message.includes("free")));
	});
});

test("lead claim accepts a capability id and writes that capability's claim", async () => {
	await withFixture(async ({ cwd, store }) => {
		const probe = harness(cwd, "session-a");
		const claimed = await runProjectMapCommand("lead claim catalog", probe.ctx, { now: () => NOW });
		assert.equal(claimed.wrote, true, "a capability claim is a durable store record");
		assert.equal((JSON.parse(readFileSync(capabilityClaimPath(store, "catalog"), "utf8")) as { session_id: string }).session_id, "session-a");
		assert.ok(probe.notified.some((message) => message.includes("catalog")), probe.notified.join("\n"));
	});
});

test("lead claim refuses a capability the map does not declare, without writing", async () => {
	await withFixture(async ({ cwd, store }) => {
		const probe = harness(cwd, "session-a");
		const report = await runProjectMapCommand("lead claim ghost", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(report.diagnostics.some((entry) => entry.severity === "error"));
		assert.ok(probe.notified.some((message) => message.includes("catalog")), "the refusal names what the map does declare");
		assert.equal(existsSync(capabilityClaimPath(store, "ghost")), false);
	});
});

test("a capability claim belongs to one session, and status and release see the same record", async () => {
	await withFixture(async ({ cwd }) => {
		await runProjectMapCommand("lead claim catalog", harness(cwd, "session-a").ctx, { now: () => NOW });
		const other = harness(cwd, "session-b");
		const held = await runProjectMapCommand("lead claim catalog", other.ctx, { now: () => LATER });
		assert.equal(held.wrote, false, "a refused claim changes nothing");
		assert.ok(hasCode(other.notified, PROJECT_MAP_STORE_DIAGNOSTIC_CODES.CLAIM_HELD));
		const live = harness(cwd, "session-b");
		await runProjectMapCommand("lead status catalog", live.ctx, { now: () => LATER });
		assert.ok(live.notified.some((message) => message.includes("catalog") && message.includes("session-a")), live.notified.join("\n"));
		const released = await runProjectMapCommand("lead release catalog", harness(cwd, "session-a").ctx, { now: () => LATER });
		assert.equal(released.wrote, true, "releasing removes the record, which is a change too");
		const free = harness(cwd, "session-b");
		await runProjectMapCommand("lead status catalog", free.ctx, { now: () => LATER });
		assert.ok(free.notified.some((message) => message.includes("catalog") && message.includes("free")), free.notified.join("\n"));
	});
});

test("contract propose hashes its body and refuses a missing body without writing", async () => {
	await withFixture(async ({ cwd, store }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Contract body\n", "utf8");
		const report = await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		assert.equal(report.wrote, true, "the proposal is a durable store record");
		const proposed = readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" });
		assert.equal(proposed.contract?.digest, `sha256:${createHash("sha256").update(readFileSync(body)).digest("hex")}`);
		const missing = harness(cwd, "satellite");
		await runProjectMapCommand(`contract propose catalog missing Missing ${join(cwd, "missing.md")}`, missing.ctx, { now: () => NOW });
		assert.ok(hasCode(missing.notified, "project-map-store/unreadable-store"));
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "missing" }).status, "free");
	});
});

test("contract accept refuses a non-lead without writing state or artifact", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		const before = readFileSync(artifact, "utf8");
		const probe = harness(cwd, "not-lead");
		await runProjectMapCommand("contract accept catalog pricing needed", probe.ctx, { now: () => NOW });
		assert.ok(probe.notified.some((message) => message.includes("lead")));
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" }).status, "proposed");
		assert.equal(readFileSync(artifact, "utf8"), before);
	});
});

test("the lead accepts durably then applies the contract to an approved map", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		const probe = harness(cwd, "lead", [true]);
		const report = await runProjectMapCommand("contract accept catalog pricing accepted", probe.ctx, { now: () => LATER });
		assert.equal(report.wrote, true);
		assert.equal(probe.confirmations, 1);
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" }).status, "accepted");
		assert.deepEqual(JSON.parse(readFileSync(artifact, "utf8")).capabilities[0].contracts, ["pricing"]);
	});
});

test("an accepted decision survives a failed artifact apply and can be retried", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		rmSync(artifact);
		mkdirSync(artifact);
		const probe = harness(cwd, "lead", [true]);
		const report = await runProjectMapCommand("contract accept catalog pricing accepted", probe.ctx, { now: () => LATER });
		assert.equal(report.wrote, true, "the decision landed durably even though the artifact could not be applied");
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" }).status, "accepted");
		assert.ok(probe.notified.some((message) => message.includes("can be retried")));
	});
});

test("contract reject records the decision without touching the artifact", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		const before = readFileSync(artifact, "utf8");
		const report = await runProjectMapCommand("contract reject catalog pricing rejected", harness(cwd, "lead").ctx, { now: () => LATER });
		assert.equal(report.wrote, true, "the rejection is a durable decision record");
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" }).status, "rejected");
		assert.equal(readFileSync(artifact, "utf8"), before);
	});
});

test("contract list includes proposed and decided entries by capability or across the map", async () => {
	await withFixture(async ({ cwd, artifact }) => {
		const declared = JSON.parse(readFileSync(artifact, "utf8")) as ProjectMapV1;
		declared.capabilities.push({ id: "billing", outcome: "Billing is available.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["api"], state: "planned" });
		writeFileSync(artifact, serializeProjectMap(declared), "utf8");
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog proposed Proposed ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand(`contract propose catalog decided Decided ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand(`contract propose billing invoice Invoice ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		await runProjectMapCommand("contract reject catalog decided no", harness(cwd, "lead").ctx, { now: () => LATER });
		const requested = harness(cwd, "satellite");
		await runProjectMapCommand("contract list catalog", requested.ctx, { now: () => LATER });
		assert.ok(requested.notified.some((message) => message.includes("proposed") && message.includes("decided") && message.includes("rejected")));
		assert.equal(requested.notified.some((message) => message.includes("invoice")), false);
		const all = harness(cwd, "satellite");
		await runProjectMapCommand("contract list", all.ctx, { now: () => LATER });
		assert.ok(all.notified.some((message) => message.includes("proposed") && message.includes("decided") && message.includes("invoice")));
	});
});

test("a declined acceptance writes neither the decision nor the artifact", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		const before = readFileSync(artifact, "utf8");
		const probe = harness(cwd, "lead", [false]);
		const report = await runProjectMapCommand("contract accept catalog pricing declined", probe.ctx, { now: () => LATER });
		assert.equal(probe.confirmations, 1);
		assert.equal(report.wrote, false);
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" }).status, "proposed");
		assert.equal(readFileSync(artifact, "utf8"), before);
	});
});

test("an acceptance with no durable proposal never reaches the artifact", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		const before = readFileSync(artifact, "utf8");
		const probe = harness(cwd, "lead", [true]);
		const report = await runProjectMapCommand("contract accept catalog ghost accepted", probe.ctx, { now: () => LATER });
		assert.equal(report.wrote, false);
		assert.ok(hasCode(probe.notified, "project-map-store/contract-absent"));
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "ghost" }).status, "free");
		assert.equal(readFileSync(artifact, "utf8"), before);
	});
});

test("an acceptance of a contract already in the map changes no artifact byte and says so", async () => {
	await withFixture(async ({ cwd, store, artifact }) => {
		const declared = JSON.parse(readFileSync(artifact, "utf8")) as ProjectMapV1;
		declared.capabilities[0].contracts = ["pricing"];
		writeFileSync(artifact, serializeProjectMap(declared), "utf8");
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		const before = readFileSync(artifact, "utf8");
		const report = await runProjectMapCommand("contract accept catalog pricing already", harness(cwd, "lead", [true]).ctx, { now: () => LATER });
		assert.equal(report.wrote, true, "the decision was recorded, even though the artifact already declared the contract");
		assert.equal(readProjectMapContract({ root: store, capabilityId: "catalog", contractId: "pricing" }).status, "accepted");
		assert.equal(readFileSync(artifact, "utf8"), before);
	});
});

test("store and map refusals retain their diagnostic codes", async () => {
	await withFixture(async ({ cwd }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Body", "utf8");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		const exists = harness(cwd, "satellite");
		await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, exists.ctx, { now: () => NOW });
		assert.ok(hasCode(exists.notified, "project-map-store/contract-exists"));
		await runProjectMapCommand("lead claim", harness(cwd, "lead").ctx, { now: () => NOW });
		await runProjectMapCommand("contract reject catalog pricing no", harness(cwd, "lead").ctx, { now: () => LATER });
		const decided = harness(cwd, "lead");
		await runProjectMapCommand("contract reject catalog pricing again", decided.ctx, { now: () => LATER });
		assert.ok(hasCode(decided.notified, "project-map-store/contract-already-decided"));
		const absent = harness(cwd, "lead");
		await runProjectMapCommand("contract reject catalog absent no", absent.ctx, { now: () => LATER });
		assert.ok(hasCode(absent.notified, "project-map-store/contract-absent"));
	});
});
