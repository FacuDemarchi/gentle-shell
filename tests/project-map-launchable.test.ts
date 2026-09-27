import assert from "node:assert/strict";
import test from "node:test";
import { projectMapLaunchableSet, type ProjectMapLaunchableInput } from "../lib/project-map-launchable.ts";

function input(overrides: Partial<ProjectMapLaunchableInput> = {}): ProjectMapLaunchableInput {
	return {
		map: { approval: { state: "approved" }, capabilities: [{ id: "catalog", state: "planned" }] },
		coordination: [{ capabilityId: "catalog", dependencyReady: true, openBlockers: 0, proposedContracts: 0 }],
		bound: new Set(["catalog"]),
		executable: true,
		hostAvailable: true,
		...overrides,
	};
}

test("offers a capability the evidence backs", () => {
	assert.deepEqual([...projectMapLaunchableSet(input())], ["catalog"]);
});

test("offers nothing while the executable half is off or the host is missing", () => {
	assert.equal(projectMapLaunchableSet(input({ executable: false })).size, 0);
	assert.equal(projectMapLaunchableSet(input({ hostAvailable: false })).size, 0);
});

test("offers nothing without an approved map", () => {
	assert.equal(projectMapLaunchableSet(input({ map: null })).size, 0);
	assert.equal(projectMapLaunchableSet(input({ map: { approval: { state: "draft" }, capabilities: [{ id: "catalog", state: "planned" }] } })).size, 0);
});

test("refuses the two declared states that mean do not start", () => {
	for (const state of ["done", "blocked"] as const) {
		assert.equal(projectMapLaunchableSet(input({ map: { approval: { state: "approved" }, capabilities: [{ id: "catalog", state }] } })).size, 0, state);
	}
});

test("offers every other declared state", () => {
	for (const state of ["planned", "active", "review", "ready"] as const) {
		assert.equal(projectMapLaunchableSet(input({ map: { approval: { state: "approved" }, capabilities: [{ id: "catalog", state }] } })).size, 1, state);
	}
});

test("refuses an unready dependency, an open blocker, or a proposed contract", () => {
	for (const entry of [
		{ capabilityId: "catalog", dependencyReady: false, openBlockers: 0, proposedContracts: 0 },
		{ capabilityId: "catalog", dependencyReady: true, openBlockers: 1, proposedContracts: 0 },
		{ capabilityId: "catalog", dependencyReady: true, openBlockers: 0, proposedContracts: 1 },
	]) {
		assert.equal(projectMapLaunchableSet(input({ coordination: [entry] })).size, 0, JSON.stringify(entry));
	}
});

test("refuses a capability with no worktree binding, and one the projection does not cover", () => {
	assert.equal(projectMapLaunchableSet(input({ bound: new Set() })).size, 0);
	assert.equal(projectMapLaunchableSet(input({ coordination: [] })).size, 0);
});

test("a capability the projection does not cover is never offered", () => {
	const result = projectMapLaunchableSet(input({
		map: { approval: { state: "approved" }, capabilities: [{ id: "catalog", state: "planned" }, { id: "billing", state: "planned" }] },
		bound: new Set(["catalog", "billing"]),
	}));
	assert.deepEqual([...result], ["catalog"]);
});
