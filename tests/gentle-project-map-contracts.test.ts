import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PROJECT_MAP_SUB_ACTIONS,
	parseProjectMapSubAction,
	runProjectMapCommand,
	type ProjectMapCommandContext,
} from "../extensions/gentle-project-map.ts";
import { PROJECT_MAP_LEAD_CAPABILITY_ID } from "../lib/project-map-coordination-state.ts";
import { readProjectMapContract } from "../lib/project-map-store-contracts.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { PROJECT_MAP_SCHEMA_V1, serializeProjectMap, type ProjectMapV1 } from "../lib/shell-project-map-schema.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const LATER = new Date("2026-09-26T12:00:10.000Z");
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

function hasCode(messages: string[], code: string): boolean {
	return messages.some((message) => message.includes(code));
}

test("parser accepts lead and contract while still rejecting an unknown sub-action", () => {
	assert.ok(PROJECT_MAP_SUB_ACTIONS.includes("lead"));
	assert.ok(PROJECT_MAP_SUB_ACTIONS.includes("contract"));
	assert.equal(parseProjectMapSubAction("lead claim").action, "lead");
	assert.equal(parseProjectMapSubAction("contract list").action, "contract");
	assert.equal(parseProjectMapSubAction("unknown").ok, false);
});

test("lead claim belongs to one session and preserves bytes on claim-held", async () => {
	await withFixture(async ({ cwd, store }) => {
		const first = await runProjectMapCommand("lead claim", harness(cwd, "session-a").ctx, { now: () => NOW });
		assert.equal(first.wrote, false);
		const before = readFileSync(claimPath(store), "utf8");
		const secondProbe = harness(cwd, "session-b");
		const second = await runProjectMapCommand("lead claim", secondProbe.ctx, { now: () => LATER });
		assert.equal(second.wrote, false);
		assert.ok(hasCode(secondProbe.notified, "project-map-store/claim-held"));
		assert.equal(readFileSync(claimPath(store), "utf8"), before);
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

test("contract propose hashes its body and refuses a missing body without writing", async () => {
	await withFixture(async ({ cwd, store }) => {
		const body = join(cwd, "contract.md");
		writeFileSync(body, "Contract body\n", "utf8");
		const report = await runProjectMapCommand(`contract propose catalog pricing Pricing ${body}`, harness(cwd, "satellite").ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
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
		assert.equal(report.wrote, false);
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
		assert.equal(report.wrote, false);
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

test("an acceptance of a contract already in the map writes nothing and says so", async () => {
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
		assert.equal(report.wrote, false);
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
