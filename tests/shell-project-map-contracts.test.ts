import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("normalizes a valid but non-canonical artifact while changing only the contracts semantically", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		const canonical = approvedMap(["zeta", "alpha"]);
		// Valid but not canonical: the capabilities and one capability's contracts are out of
		// order, which `validateProjectMap` accepts because it validates structure, not ordering.
		const nonCanonical: ProjectMapV1 = {
			...canonical,
			capabilities: [...canonical.capabilities].reverse(),
		};
		writeFileSync(path, `${JSON.stringify(nonCanonical, null, 2)}\n`, "utf8");
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "beta" });

		assert.equal(result.applied, true);
		// The single authorized writer canonicalizes the whole artifact, so the bytes differ from a
		// non-canonical input even though only one array changed semantically. The returned map is
		// canonical too — `validateProjectMap` canonicalizes what it returns — which is why both
		// comparisons go through the serializer.
		assert.notEqual(readFileSync(path, "utf8"), before);
		assert.equal(readFileSync(path, "utf8"), serializeProjectMap(approvedMap(["alpha", "beta", "zeta"])));
		assert.equal(serializeProjectMap(result.map!), readFileSync(path, "utf8"));
		// Order preservation is not observable through this API: `validateProjectMap` canonicalizes the
		// map it returns, so both the returned map and the artifact are sorted.
		assert.deepEqual(result.map?.capabilities.find((capability) => capability.id === "catalog")?.contracts, ["alpha", "beta", "zeta"]);
	});
});

test("reports a supersession that writes while adding nothing", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap(["alpha", "beta"]));
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "beta", supersedes: "alpha" });

		// The id was already present, so nothing is added, but the array did change, so the write
		// happens: `applied: false` alone does not mean "wrote nothing".
		assert.equal(result.applied, false);
		assert.equal(result.removed, true);
		assert.notEqual(readFileSync(path, "utf8"), before);
		assert.equal(readFileSync(path, "utf8"), serializeProjectMap(approvedMap(["beta"])));
	});
});

test("leaves a non-canonical artifact untouched when nothing changes", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		const canonical = approvedMap(["zeta", "alpha"]);
		writeFileSync(path, `${JSON.stringify({ ...canonical, capabilities: [...canonical.capabilities].reverse() }, null, 2)}\n`, "utf8");
		const before = readFileSync(path, "utf8");

		const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "alpha" });

		// The early return is load-bearing here: without it the candidate would be canonicalized and
		// the file rewritten, which is exactly what a no-op must not do to an artifact it was not
		// asked to change.
		assert.equal(result.applied, false);
		assert.equal(result.removed, false);
		assert.equal(readFileSync(path, "utf8"), before);
		assert.deepEqual(result.map?.capabilities.find((capability) => capability.id === "catalog")?.contracts, ["alpha", "zeta"]);
	});
});

test("treats a self-superseding apply and an absent superseded id as no change", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap(["alpha", "beta"]));
		const before = readFileSync(path, "utf8");

		const selfSuperseding = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "beta", supersedes: "beta" });
		assert.equal(selfSuperseding.applied, false);
		assert.equal(selfSuperseding.removed, false);
		assert.equal(readFileSync(path, "utf8"), before);

		const absentSuperseded = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "alpha", supersedes: "missing" });
		assert.equal(absentSuperseded.applied, false);
		assert.equal(absentSuperseded.removed, false);
		assert.equal(readFileSync(path, "utf8"), before);
	});
});

test("changes only the targeted capability when the other metadata varies", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		const varied = approvedMap(["catalog-v1"]);
		varied.capabilities[1] = {
			...varied.capabilities[1],
			contracts: ["checkout-v1"],
			outcome: "Checkout is available and varied.",
			surfaces: ["api", "operations"],
			featureDocs: ["odd/tasks/checkout.md"],
			state: "active",
		};
		writeMap(path, varied);

		const result = await applyProjectMapContract({ path, capabilityId: "checkout", contractId: "checkout-v2" });

		assert.equal(result.applied, true);
		assert.deepEqual(result.map?.capabilities.find((capability) => capability.id === "catalog")?.contracts, ["catalog-v1"]);
		const checkout = result.map?.capabilities.find((capability) => capability.id === "checkout");
		assert.deepEqual(checkout?.contracts, ["checkout-v1", "checkout-v2"]);
		assert.equal(checkout?.outcome, "Checkout is available and varied.");
		assert.deepEqual(checkout?.surfaces, ["api", "operations"]);
		assert.deepEqual(checkout?.featureDocs, ["odd/tasks/checkout.md"]);
		assert.equal(checkout?.state, "active");
	});
});

test("fails closed when the artifact cannot be written", async () => {
	await withTempDirectory(async (directory) => {
		const path = join(directory, "project-map.json");
		writeMap(path, approvedMap());
		const before = readFileSync(path, "utf8");
		chmodSync(directory, 0o500);
		try {
			const result = await applyProjectMapContract({ path, capabilityId: "catalog", contractId: "catalog-api-v1" });
			assert.equal(result.applied, false);
			assert.equal(result.removed, false);
			assert.equal(result.map, null);
			assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_DIAGNOSTIC_CODES.UNREADABLE_ARTIFACT));
		} finally {
			chmodSync(directory, 0o700);
		}
		assert.equal(readFileSync(path, "utf8"), before);
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
		assert.equal(result.applied, false);
		assert.equal(result.removed, false);
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
			assert.equal(result.applied, false, `expected no application for ${JSON.stringify(request)}`);
			assert.equal(result.removed, false, `expected no removal for ${JSON.stringify(request)}`);
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

test("canonicalizes the artifact deterministically across additive application orders", async () => {
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
