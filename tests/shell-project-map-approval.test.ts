import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PROJECT_MAP_SCHEMA_V1,
	readProjectMapFile,
	validateProjectMap,
	type ProjectMapV1,
} from "../lib/shell-project-map-schema.ts";
import { approveProjectMap, declareProjectMapSurfaces, writeProjectMapFile } from "../lib/shell-project-map-approval.ts";

const APPROVED_AT = "2026-09-23T12:00:00Z";
const APPROVED_BY = "facundo";

function draftMap(overrides: Partial<ProjectMapV1> = {}): ProjectMapV1 {
	return {
		version: PROJECT_MAP_SCHEMA_V1,
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "draft" },
		foundations: [{ id: "repository-tooling", outcome: "Tooling is declared.", state: "done", evidence: ["package.json"] }],
		capabilities: [
			{
				id: "merchant-catalog",
				outcome: "Merchants manage their catalog.",
				foundationRefs: ["repository-tooling"],
				dependsOn: [],
				contracts: [],
				featureDocs: ["odd/tasks/catalog.md"],
				surfaces: ["web", "api"],
				state: "planned",
			},
		],
		...overrides,
	};
}

function incompleteDraft(): ProjectMapV1 {
	return draftMap({
		capabilities: [
			{
				id: "shopping-cart",
				outcome: "Shoppers build a cart.",
				foundationRefs: [],
				dependsOn: [],
				contracts: [],
				featureDocs: [],
				surfaces: [],
				state: "planned",
			},
		],
	});
}

function withTempDirectory(run: (directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "project-map-approval-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("approves a draft with an actor and a timestamp", () => {
	const result = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
	assert.equal(result.ok, true);
	assert.deepEqual(result.diagnostics, []);
	assert.deepEqual(result.map?.approval, { state: "approved", approvedAt: APPROVED_AT, approvedBy: APPROVED_BY });
});

test("does not mutate the map it was given", () => {
	const draft = draftMap();
	const before = JSON.parse(JSON.stringify(draft)) as ProjectMapV1;
	approveProjectMap({ map: draft, approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
	assert.deepEqual(draft, before);
});

test("refuses to approve an already approved map", () => {
	const approved = draftMap({ approval: { state: "approved", approvedAt: APPROVED_AT, approvedBy: APPROVED_BY } });
	const result = approveProjectMap({ map: approved, approvedBy: "someone-else", approvedAt: "2026-10-01T00:00:00Z" });
	assert.equal(result.ok, false);
	assert.equal(result.map, null);
	assert.equal(result.diagnostics.length, 1);
	assert.equal(result.diagnostics[0].path, "$.approval.state");
});

test("refuses an unusable actor or timestamp", () => {
	for (const request of [
		{ map: draftMap(), approvedBy: "   ", approvedAt: APPROVED_AT },
		{ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: "yesterday" },
		{ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: "2026-02-30T00:00:00Z" },
	]) {
		const result = approveProjectMap(request);
		assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(request)}`);
		assert.equal(result.map, null);
		assert.ok(result.diagnostics.length > 0);
	}
});

test("refuses to approve a map whose capabilities declare no surface", () => {
	const result = approveProjectMap({ map: incompleteDraft(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
	assert.equal(result.ok, false);
	assert.equal(result.map, null);
	assert.deepEqual(
		result.diagnostics.map((diagnostic) => diagnostic.path),
		["$.capabilities[0].surfaces"],
	);
});

test("refuses to approve a map that does not validate", () => {
	const broken = draftMap({ project: { id: "example-shop", name: "" } });
	const result = approveProjectMap({ map: broken, approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
	assert.equal(result.ok, false);
	assert.equal(result.map, null);
	assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path === "$.project.name"));
});

test("returns a map the validator accepts", () => {
	const result = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
	assert.ok(result.map);
	const validated = validateProjectMap(result.map);
	assert.deepEqual(validated.diagnostics, []);
	assert.deepEqual(validated.map, result.map);
});

test("declares exactly the requested surfaces without mutating the draft", () => {
	const draft = draftMap();
	const before = JSON.parse(JSON.stringify(draft)) as ProjectMapV1;
	const result = declareProjectMapSurfaces({ map: draft, capabilityId: "merchant-catalog", surfaces: ["security"] });
	assert.equal(result.ok, true);
	assert.deepEqual(result.diagnostics, []);
	assert.deepEqual(result.map?.capabilities[0]?.surfaces, ["security"]);
	assert.deepEqual(draft, before);
});

test("clears a draft capability back to undetermined surfaces", () => {
	const result = declareProjectMapSurfaces({ map: draftMap(), capabilityId: "merchant-catalog", surfaces: [] });
	assert.equal(result.ok, true);
	assert.deepEqual(result.map?.capabilities[0]?.surfaces, []);
});

test("canonicalizes declared surfaces into the frozen vocabulary order", () => {
	const result = declareProjectMapSurfaces({ map: draftMap(), capabilityId: "merchant-catalog", surfaces: ["tests", "web", "productUx"] });
	assert.equal(result.ok, true);
	assert.deepEqual(result.map?.capabilities[0]?.surfaces, ["productUx", "web", "tests"]);
});

test("refuses surface declarations on an approved map before every other check", () => {
	const approved = draftMap({ approval: { state: "approved", approvedAt: APPROVED_AT, approvedBy: APPROVED_BY } });
	const result = declareProjectMapSurfaces({ map: approved, capabilityId: "", surfaces: ["not-a-surface"] });
	assert.equal(result.ok, false);
	assert.equal(result.map, null);
	assert.equal(result.diagnostics.length, 1);
	assert.equal(result.diagnostics[0]?.path, "$.approval.state");
	assert.match(result.diagnostics[0]?.message ?? "", /draft-time action/);
	assert.match(result.diagnostics[0]?.message ?? "", /would replace the approved plan/);
	assert.match(result.diagnostics[0]?.message ?? "", /no plan-preserving return to draft/);
});

test("refuses an empty capability id", () => {
	const result = declareProjectMapSurfaces({ map: draftMap(), capabilityId: "   ", surfaces: ["unknown"] });
	assert.equal(result.ok, false);
	assert.equal(result.map, null);
	assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), ["$.capabilities"]);
});

test("refuses a capability id the map does not declare and names its ids", () => {
	const result = declareProjectMapSurfaces({ map: draftMap(), capabilityId: "missing", surfaces: ["unknown"] });
	assert.equal(result.ok, false);
	assert.equal(result.map, null);
	assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), ["$.capabilities"]);
	assert.match(result.diagnostics[0]?.message ?? "", /merchant-catalog/);
});

test("refuses unknown and repeated declared surfaces by naming the frozen vocabulary", () => {
	for (const surfaces of [["unknown"], ["web", "web"]]) {
		const result = declareProjectMapSurfaces({ map: draftMap(), capabilityId: "merchant-catalog", surfaces });
		assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(surfaces)}`);
		assert.equal(result.map, null);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.path), ["$.capabilities[0].surfaces"]);
		assert.match(result.diagnostics[0]?.message ?? "", /productUx, web, api, data, security, operations, tests/);
	}
});

test("writes the artifact and reports its path", () => {
	withTempDirectory((directory) => {
		const path = join(directory, "project-map.json");
		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		const written = writeProjectMapFile(path, approved.map);
		assert.equal(written.ok, true);
		assert.equal(written.path, path);
		assert.deepEqual(written.diagnostics, []);
		const read = readProjectMapFile(path);
		assert.deepEqual(read.diagnostics, []);
		assert.deepEqual(read.map, approved.map);
	});
});

test("refuses to write a map that does not validate and leaves the artifact intact", () => {
	withTempDirectory((directory) => {
		const path = join(directory, "project-map.json");
		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		writeProjectMapFile(path, approved.map);
		const before = readFileSync(path, "utf8");

		const broken = draftMap({ project: { id: "example-shop", name: "" } });
		const written = writeProjectMapFile(path, broken);
		assert.equal(written.ok, false);
		assert.ok(written.diagnostics.some((diagnostic) => diagnostic.path === "$.project.name"));
		assert.equal(readFileSync(path, "utf8"), before);
	});
});

test("writes a valid draft, because persisting a draft is what makes the state exist", () => {
	withTempDirectory((directory) => {
		const path = join(directory, "project-map.json");
		const written = writeProjectMapFile(path, incompleteDraft());
		assert.equal(written.ok, true);
		assert.deepEqual(written.diagnostics, []);
		const read = readProjectMapFile(path);
		assert.deepEqual(read.diagnostics, []);
		assert.equal(read.map?.approval.state, "draft");
		assert.deepEqual(read.map?.capabilities[0].surfaces, []);
	});
});

test("leaves no temporary sibling behind when the write fails after the temp file exists", () => {
	withTempDirectory((directory) => {
		// The destination is a directory, so the failure lands on the rename and the temp file
		// already exists. A failure before the temp file is created would prove nothing about
		// cleanup, which is why the destination is not merely unreachable.
		const path = join(directory, "project-map.json");
		mkdirSync(path);
		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		const written = writeProjectMapFile(path, approved.map);
		assert.equal(written.ok, false);
		assert.ok(written.diagnostics.length > 0);
		assert.deepEqual(readdirSync(directory), ["project-map.json"]);
		assert.equal(statSync(path).isDirectory(), true);
	});
});

test("leaves no temporary sibling behind when the parent is not a directory", () => {
	withTempDirectory((directory) => {
		const blocker = join(directory, "blocker");
		writeFileSync(blocker, "not a directory", "utf8");
		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		const written = writeProjectMapFile(join(blocker, "project-map.json"), approved.map);
		assert.equal(written.ok, false);
		assert.deepEqual(readdirSync(directory), ["blocker"]);
	});
});

test("touches exactly one path and leaves unrelated files alone", () => {
	withTempDirectory((directory) => {
		const path = join(directory, "project-map.json");
		const unrelated = join(directory, "unrelated.txt");
		writeFileSync(unrelated, "leave me alone", "utf8");
		const unrelatedBefore = statSync(unrelated).mtimeMs;

		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		assert.equal(writeProjectMapFile(path, approved.map).ok, true);

		assert.equal(readFileSync(unrelated, "utf8"), "leave me alone");
		assert.equal(statSync(unrelated).mtimeMs, unrelatedBefore);
		assert.deepEqual(readdirSync(directory).sort(), ["project-map.json", "unrelated.txt"]);
	});
});

test("does not rewrite an artifact that already holds identical bytes, and does rewrite a different one", () => {
	withTempDirectory((directory) => {
		const path = join(directory, "project-map.json");
		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		writeProjectMapFile(path, approved.map);
		const firstInode = statSync(path).ino;
		const firstWrite = statSync(path).mtimeMs;

		assert.equal(writeProjectMapFile(path, approved.map).ok, true);
		// A rename-based rewrite replaces the directory entry, so an unchanged inode proves the
		// writer skipped the write instead of replacing the file with identical bytes.
		assert.equal(statSync(path).ino, firstInode);
		assert.equal(statSync(path).mtimeMs, firstWrite);
		assert.deepEqual(readdirSync(directory), ["project-map.json"]);

		const other = approveProjectMap({ map: draftMap(), approvedBy: "someone-else", approvedAt: "2026-10-01T00:00:00Z" });
		assert.ok(other.map);
		assert.equal(writeProjectMapFile(path, other.map).ok, true);
		assert.equal(readFileSync(path, "utf8").includes("someone-else"), true);
	});
});

test("round-trips an approved map through the artifact", () => {
	withTempDirectory((directory) => {
		const path = join(directory, "project-map.json");
		const approved = approveProjectMap({ map: draftMap(), approvedBy: APPROVED_BY, approvedAt: APPROVED_AT });
		assert.ok(approved.map);
		writeProjectMapFile(path, approved.map);
		const read = readProjectMapFile(path);
		assert.equal(read.map?.approval.state, "approved");
		assert.equal(read.map?.approval.approvedBy, APPROVED_BY);
		assert.ok(existsSync(path));
	});
});
