import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PROJECT_MAP_DIAGNOSTIC_CODES,
	PROJECT_MAP_SCHEMA_V1,
	serializeProjectMap,
	type ProjectMapV1,
} from "../lib/shell-project-map-schema.ts";

const APPROVED_AT = "2026-09-25T12:00:00Z";
const APPROVED_BY = "facundo";

type ApplyOutcome = {
	applied: boolean;
	removed: boolean;
	map: ProjectMapV1 | null;
	diagnostics: Array<{ code: string; path: string; message: string; severity: string }>;
};

async function applyProjectMapContract(request: { path: string; capabilityId: string; contractId: string; supersedes?: string }): Promise<ApplyOutcome> {
	const subject = await import("../lib/shell-project-map-contracts.ts").catch(() => ({})) as {
		applyProjectMapContract?: (request: { path: string; capabilityId: string; contractId: string; supersedes?: string }) => ApplyOutcome;
	};
	assert.equal(typeof subject.applyProjectMapContract, "function", "applyProjectMapContract must be exported by shell-project-map-contracts.ts");
	return subject.applyProjectMapContract!(request);
}

function approvedMap(contracts: string[] = []): ProjectMapV1 {
	return {
		version: PROJECT_MAP_SCHEMA_V1,
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "approved", approvedAt: APPROVED_AT, approvedBy: APPROVED_BY },
		foundations: [{ id: "tooling", outcome: "Tooling is ready.", state: "done", evidence: ["package.json"] }],
		capabilities: [
			{
				id: "catalog",
				outcome: "Catalog is available.",
				foundationRefs: ["tooling"],
				dependsOn: [],
				contracts,
				featureDocs: ["odd/tasks/catalog.md"],
				surfaces: ["web", "api"],
				state: "planned",
			},
			{
				id: "checkout",
				outcome: "Checkout is available.",
				foundationRefs: [],
				dependsOn: ["catalog"],
				contracts: [],
				featureDocs: [],
				surfaces: ["web"],
				state: "planned",
			},
		],
	};
}

function withTempDirectory(run: (directory: string) => Promise<void> | void): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "project-map-contracts-"));
	return Promise.resolve(run(directory)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

function writeMap(path: string, map: ProjectMapV1): void {
	writeFileSync(path, serializeProjectMap(map), "utf8");
}

test("applies an accepted contract to exactly one capability field", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		const beforeMap = approvedMap();
		writeMap(path, beforeMap);
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v1" });
		const after = readFileSync(path, "utf8");
		const expected = approvedMap(["catalog-api-v1"]);
		assert.equal(result.applied, true);
		assert.equal(result.removed, false);
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.map, expected);
		assert.equal(after, serializeProjectMap(expected));
		assert.notEqual(after, before);
		assert.deepEqual(result.map?.capabilities[0], { ...beforeMap.capabilities[0], contracts: ["catalog-api-v1"] });
		assert.deepEqual(result.map?.capabilities[1], beforeMap.capabilities[1]);
		assert.deepEqual(result.map?.approval, beforeMap.approval);
		assert.deepEqual(result.map?.foundations, beforeMap.foundations);
		assert.deepEqual(result.map?.project, beforeMap.project);
	});
});

test("reports a second application as a byte-identical no-op", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap());
		assert.equal((await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v1" })).applied, true);
		const before = readFileSync(path, "utf8");
		const inode = statSync(path).ino;

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v1" });

		assert.equal(result.applied, false);
		assert.equal(result.removed, false);
		assert.deepEqual(result.diagnostics, []);
		assert.equal(readFileSync(path, "utf8"), before);
		assert.equal(statSync(path).ino, inode);
	});
});

test("replaces a superseded contract in one write", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap(["catalog-api-v1"]));

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v2", supersedes: "catalog-api-v1" });

		assert.equal(result.applied, true);
		assert.equal(result.removed, true);
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.map?.capabilities[0]?.contracts, ["catalog-api-v2"]);
		assert.equal(readFileSync(path, "utf8"), serializeProjectMap(approvedMap(["catalog-api-v2"])));
	});
});

test("reports an absent superseded id without inventing a removal", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap(["alpha"]));

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "beta", supersedes: "not-present" });

		assert.equal(result.applied, true);
		assert.equal(result.removed, false);
		assert.deepEqual(result.map?.capabilities[0]?.contracts, ["alpha", "beta"]);
		assert.equal(readFileSync(path, "utf8"), serializeProjectMap(approvedMap(["alpha", "beta"])));
	});
});

test("refuses a draft map without touching its bytes", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		const draft = approvedMap();
		draft.approval = { state: "draft" };
		writeMap(path, draft);
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v1" });

		assert.equal(result.map, null);
		assert.equal(result.applied, false);
		assert.equal(result.removed, false);
		assert.deepEqual(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]), [[PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.approval.state"]]);
		assert.equal(readFileSync(path, "utf8"), before);
	});
});

test("refuses an unknown capability without touching the artifact", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap());
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "missing", contractId: "catalog-api-v1" });

		assert.equal(result.map, null);
		assert.ok(result.diagnostics[0]?.message.includes("missing"));
		assert.equal(readFileSync(path, "utf8"), before);
	});
});

test("refuses empty contract identifiers and whitespace-only supersession identifiers", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap(["catalog-api-v1"]));
		const before = readFileSync(path, "utf8");
		for (const request of [
			{ path, capabilityId: "catalog", contractId: "" },
			{ path, capabilityId: "catalog", contractId: "   " },
			{ path, capabilityId: "catalog", contractId: "catalog-api-v2", supersedes: "   " },
		]) {
			const result = await applyProjectMapContract(request);
			assert.equal(result.map, null, `expected refusal for ${JSON.stringify(request)}`);
			assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD));
			assert.equal(readFileSync(path, "utf8"), before);
		}
	});
});

test("never writes a structured artifact that fails validation", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		const invalid = approvedMap(["catalog-api-v1", "catalog-api-v1"]);
		writeFileSync(path, JSON.stringify(invalid, null, 2), "utf8");
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v2" });

		assert.equal(result.map, null);
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path === "$.capabilities[0].contracts[1]"));
		assert.equal(readFileSync(path, "utf8"), before);
	});
});

test("fails closed for missing and corrupt artifacts without creating or overwriting them", async () => {
	await withTempDirectory(async (directory) => {
		const missingPath = join(directory, "missing.json");
		const missing = await applyProjectMapContract({ path: missingPath, capabilityId: "catalog", contractId: "catalog-api-v1" });
		assert.equal(missing.map, null);
		assert.ok(missing.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_DIAGNOSTIC_CODES.UNREADABLE_ARTIFACT));
		assert.equal(existsSync(missingPath), false);

		const corruptPath = join(directory, "corrupt.json");
		writeFileSync(corruptPath, "{ not json", "utf8");
		const before = readFileSync(corruptPath, "utf8");
		const corrupt = await applyProjectMapContract({ path: corruptPath, capabilityId: "catalog", contractId: "catalog-api-v1" });
		assert.equal(corrupt.map, null);
		assert.ok(corrupt.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_JSON));
		assert.equal(readFileSync(corruptPath, "utf8"), before);
	});
});

test("preserves contract order, appends new ids, and canonicalizes repeated applications", async () => {
	await withTempDirectory(async (directory) => {
		const firstPath = join(directory, "first.json");
		writeMap(firstPath, approvedMap(["alpha", "legacy"]));
		const first = await applyProjectMapContract({ path: firstPath, capabilityId: "catalog", contractId: "zulu" });
		assert.deepEqual(first.map?.capabilities[0]?.contracts, ["alpha", "legacy", "zulu"]);

		const leftPath = join(directory, "left.json");
		const rightPath = join(directory, "right.json");
		writeMap(leftPath, approvedMap());
		writeMap(rightPath, approvedMap());
		await applyProjectMapContract({ path: leftPath, capabilityId: "catalog", contractId: "alpha" });
		await applyProjectMapContract({ path: leftPath, capabilityId: "catalog", contractId: "beta" });
		await applyProjectMapContract({ path: rightPath, capabilityId: "catalog", contractId: "beta" });
		await applyProjectMapContract({ path: rightPath, capabilityId: "catalog", contractId: "alpha" });
		assert.equal(readFileSync(leftPath, "utf8"), readFileSync(rightPath, "utf8"));
		const beforeNoOp = readFileSync(leftPath, "utf8");
		await applyProjectMapContract({ path: leftPath, capabilityId: "catalog", contractId: "alpha" });
		await applyProjectMapContract({ path: leftPath, capabilityId: "catalog", contractId: "beta" });
		assert.equal(readFileSync(leftPath, "utf8"), beforeNoOp);
	});
});
