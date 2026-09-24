import assert from "node:assert/strict";
import test from "node:test";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	PROJECT_MAP_SCHEMA_V1,
	serializeProjectMap,
	validateProjectMap,
} from "../lib/shell-project-map-schema.ts";
import { generateProjectMapDraft } from "../lib/shell-project-map-draft.ts";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		name: "example-shop",
		description: "An example shop.",
		scripts: { test: "node --test tests/*.test.ts" },
		...overrides,
	};
}

const config = [
	"schema: spec-driven",
	"strict_tdd: true",
	"context: |",
	"  This block is a scalar and must not be interpreted.",
	"rules:",
	"  proposal:",
	"    require_problem_statement: true",
	"testing:",
	"  detected: \"2026-07-10\"",
	"apply:",
	"  test_command: \"pnpm test\"",
	"",
].join("\n");

function joined(values: string[]): string {
	return values.join("\n");
}

test("derives project identity and the repository foundation from a manifest", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: config });
	assert.ok(result.map);
	assert.equal(result.map.version, PROJECT_MAP_SCHEMA_V1);
	assert.deepEqual(result.map.project, { id: "example-shop", name: "example-shop" });
	const foundation = result.map.foundations.find((entry) => entry.id === "repository-tooling");
	assert.ok(foundation);
	assert.equal(foundation.state, "done");
	assert.deepEqual(foundation.evidence, ["package.json"]);
});

test("normalizes a scoped package name into an identifier", () => {
	const result = generateProjectMapDraft({ packageJson: manifest({ name: "@gentleman-programming/Gentle_Pi" }) });
	assert.ok(result.map);
	assert.equal(result.map.project.id, "gentle-pi");
	assert.equal(result.map.project.name, "@gentleman-programming/Gentle_Pi");
});

test("returns no map and an omission when the manifest has no usable name", () => {
	for (const packageJson of [undefined, {}, { name: "   " }, { name: "!!!" }, { name: 42 }]) {
		const result = generateProjectMapDraft({ packageJson });
		assert.equal(result.map, null);
		assert.ok(joined(result.omissions).includes("package.json"), `expected a package.json omission for ${JSON.stringify(packageJson)}`);
	}
});

test("marks a foundation done only when its source carries a well-formed declaration", () => {
	const declared = generateProjectMapDraft({ packageJson: manifest() });
	assert.equal(declared.map?.foundations.find((entry) => entry.id === "repository-tooling")?.state, "done");

	for (const scripts of [undefined, {}, "test", []]) {
		const undeclared = generateProjectMapDraft({ packageJson: manifest({ scripts }) });
		const foundation = undeclared.map?.foundations.find((entry) => entry.id === "repository-tooling");
		assert.equal(foundation?.state, "planned", `expected planned for scripts ${JSON.stringify(scripts)}`);
		assert.equal(foundation?.evidence, undefined);
	}
});

test("derives the quality gates foundation from a declared test command", () => {
	const declared = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: config });
	const foundation = declared.map?.foundations.find((entry) => entry.id === "quality-gates");
	assert.ok(foundation);
	assert.equal(foundation.state, "done");
	assert.deepEqual(foundation.evidence, ["openspec/config.yaml"]);

	const absent = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: "schema: spec-driven\n" });
	assert.equal(absent.map?.foundations.find((entry) => entry.id === "quality-gates")?.state, "planned");
});

test("ignores configuration it cannot interpret and records the gap", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: "just a sentence\nwith no keys\n" });
	assert.ok(result.map);
	assert.ok(joined(result.omissions).includes("openspec/config.yaml"));
	assert.equal(result.map.foundations.find((entry) => entry.id === "quality-gates")?.state, "planned");
});

test("never interprets a block scalar as configuration", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: ["apply:", "  test_command: |", "    pnpm test", ""].join("\n"),
	});
	assert.equal(result.map?.foundations.find((entry) => entry.id === "quality-gates")?.state, "planned");
});

test("produces no capabilities and reports the gap", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: config });
	assert.ok(result.map);
	assert.deepEqual(result.map.capabilities, []);
	assert.ok(joined(result.omissions).toLowerCase().includes("capabilit"));
});

test("always produces a draft map that is never approved", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: config });
	assert.deepEqual(result.map?.approval, { state: "draft" });
	assert.ok(joined(result.assumptions).includes("draft"));
});

test("records every absent source as an omission", () => {
	const result = generateProjectMapDraft({});
	assert.equal(result.map, null);
	const omissions = joined(result.omissions);
	assert.ok(omissions.includes("package.json"));
});

test("is deterministic regardless of input key order", () => {
	const first = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: config });
	const second = generateProjectMapDraft({
		packageJson: { scripts: { test: "node --test tests/*.test.ts" }, description: "An example shop.", name: "example-shop" },
		openspecConfig: config,
	});
	assert.ok(first.map);
	assert.ok(second.map);
	assert.equal(serializeProjectMap(first.map), serializeProjectMap(second.map));
	assert.deepEqual(first.assumptions, second.assumptions);
	assert.deepEqual(first.omissions, second.omissions);
});

test("never throws on malformed input", () => {
	for (const sources of [
		{},
		{ packageJson: null },
		{ packageJson: [] },
		{ packageJson: "text" },
		{ packageJson: manifest(), openspecConfig: 42 as unknown as string },
		{ packageJson: manifest(), openspecConfig: "\u0000\n\t" },
	]) {
		assert.doesNotThrow(() => generateProjectMapDraft(sources));
	}
});

test("produces a draft that the schema validates with no diagnostics", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), openspecConfig: config });
	assert.ok(result.map);
	const validated = validateProjectMap(result.map);
	assert.deepEqual(validated.diagnostics, []);
	assert.deepEqual(validated.map, result.map);
});

test("documents the artifact path it is meant to fill", () => {
	assert.equal(PROJECT_MAP_ARTIFACT_PATH, "openspec/project-map.json");
});

const roadmap = [
	"# Project Map Orchestration",
	"",
	"## Outcome",
	"Make the whole product visible from the shell.",
	"",
	"## Work units",
	"",
	"- [x] **PM-1 — Define and validate the versioned Project Map**",
	"  - Specify capability identifiers and outcomes.",
	"- [ ] **PM-2 — Add draft generation and human plan approval**",
	"  - Persist explicit draft and approved transitions.",
	"",
].join("\n");

const unitDocument = [
	"# PM-3 — Render the real map",
	"",
	"## Tasks",
	"",
	"- [ ] **PM3-1 — Replace static demo data**",
	"- [x] **PM3-2 — Preserve the card order**",
	"",
].join("\n");

test("extracts work units with their declared completion state", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: roadmap }] });
	assert.ok(result.map);
	const byId = new Map(result.map.capabilities.map((capability) => [capability.id, capability]));
	assert.equal(byId.get("define-and-validate-the-versioned-project-map")?.state, "done");
	assert.equal(byId.get("add-draft-generation-and-human-plan-approval")?.state, "planned");
});

test("points every capability at the document that declared it", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: roadmap }] });
	assert.ok(result.map);
	for (const capability of result.map.capabilities) {
		assert.deepEqual(capability.featureDocs, ["odd/tasks/roadmap.md"]);
	}
});

test("keeps the declared outcome text and leaves surfaces undetermined", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: roadmap }] });
	const capability = result.map?.capabilities.find((entry) => entry.id === "add-draft-generation-and-human-plan-approval");
	assert.equal(capability?.outcome, "Add draft generation and human plan approval");
	assert.deepEqual(capability?.surfaces, []);
	assert.deepEqual(capability?.foundationRefs, []);
});

test("reads work units from several documents in a stable order", () => {
	const first = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [
			{ path: "odd/tasks/zulu.md", text: unitDocument },
			{ path: "odd/tasks/roadmap.md", text: roadmap },
		],
	});
	const second = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [
			{ path: "odd/tasks/roadmap.md", text: roadmap },
			{ path: "odd/tasks/zulu.md", text: unitDocument },
		],
	});
	assert.ok(first.map);
	assert.ok(second.map);
	assert.equal(serializeProjectMap(first.map), serializeProjectMap(second.map));
	assert.ok(first.map.capabilities.some((capability) => capability.id === "replace-static-demo-data"));
	assert.ok(first.map.capabilities.some((capability) => capability.id === "preserve-the-card-order"));
});

test("deduplicates colliding capability identifiers and reports the collision", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [
			{ path: "odd/tasks/a.md", text: "- [ ] **PM-9 — Shared title**\n" },
			{ path: "odd/tasks/b.md", text: "- [ ] **PM-8 — Shared title**\n" },
		],
	});
	assert.ok(result.map);
	assert.equal(result.map.capabilities.filter((capability) => capability.id === "shared-title").length, 1);
	assert.equal(result.map.capabilities[0].featureDocs[0], "odd/tasks/a.md");
	assert.ok(joined(result.omissions).includes("shared-title"));
});

test("reports a document that yields no work units as an omission", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/prose.md", text: "# Just prose\n\nNo units here.\n" }] });
	assert.ok(result.map);
	assert.deepEqual(result.map.capabilities, []);
	assert.ok(joined(result.omissions).includes("odd/tasks/prose.md"));
});

test("ignores prose and checklists that are not work units", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [{ path: "odd/tasks/mixed.md", text: "- [ ] a plain checklist item\n- [x] another one\n- [ ] **PM-1 — Real unit**\n" }],
	});
	assert.ok(result.map);
	assert.deepEqual(result.map.capabilities.map((capability) => capability.id), ["real-unit"]);
});

test("reports a work-unit title that cannot become an identifier", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/odd.md", text: "- [ ] **PM-1 — !!!**\n" }] });
	assert.ok(result.map);
	assert.deepEqual(result.map.capabilities, []);
	assert.ok(joined(result.omissions).includes("odd/tasks/odd.md"));
});

test("never throws on malformed document entries", () => {
	for (const oddTaskDocuments of [
		[{ path: "odd/tasks/a.md", text: null as unknown as string }],
		[{ path: 42 as unknown as string, text: roadmap }],
		[{ path: "", text: roadmap }],
		[null as unknown as { path: string; text: string }],
		"not an array" as unknown as { path: string; text: string }[],
	]) {
		assert.doesNotThrow(() => generateProjectMapDraft({ oddTaskDocuments }));
	}
});

test("produces extracted capabilities that the schema accepts as a draft", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: config,
		oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: roadmap }],
	});
	assert.ok(result.map);
	assert.ok(result.map.capabilities.length > 0);
	const validated = validateProjectMap(result.map);
	assert.deepEqual(validated.diagnostics, []);
	assert.deepEqual(validated.map, result.map);
});

test("does not read a block scalar body as configuration", () => {
	// A block scalar body that WOULD be read as a nested entry if the skip were missing. The
	// omission about an uninterpretable configuration is the observable proof: without the
	// indentation skip the body yields an entry, so the omission never fires.
	const onlyScalar = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: ["section:", "  notes: |", "    fake: value", ""].join("\n"),
	});
	assert.ok(onlyScalar.map);
	assert.ok(joined(onlyScalar.omissions).includes("carries no simple key/value entry"));

	// The same skip must not swallow real configuration that follows the scalar.
	const afterScalar = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: ["context: |", "  apply: not a section", "  test_command: not a command", "apply:", "  test_command: \"pnpm test\"", ""].join("\n"),
	});
	assert.equal(afterScalar.map?.foundations.find((entry) => entry.id === "quality-gates")?.state, "done");
});

test("requires a usable script command, not merely a key", () => {
	for (const scripts of [{ test: 42 }, { test: null }, { test: "   " }, { test: {} }]) {
		const result = generateProjectMapDraft({ packageJson: manifest({ scripts }) });
		assert.equal(
			result.map?.foundations.find((entry) => entry.id === "repository-tooling")?.state,
			"planned",
			`expected planned for scripts ${JSON.stringify(scripts)}`,
		);
	}
	const usable = generateProjectMapDraft({ packageJson: manifest({ scripts: { test: "pnpm test", lint: 42 } }) });
	assert.equal(usable.map?.foundations.find((entry) => entry.id === "repository-tooling")?.state, "done");
});

test("skips a document whose path is not repository-relative", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [
			{ path: "/etc/absolute.md", text: "- [ ] **PM-1 — Absolute**\n" },
			{ path: "../outside.md", text: "- [ ] **PM-2 — Outside**\n" },
			{ path: "C:drive.md", text: "- [ ] **PM-3 — Drive**\n" },
			{ path: "odd/tasks/inside.md", text: "- [ ] **PM-4 — Inside**\n" },
		],
	});
	assert.ok(result.map);
	assert.deepEqual(result.map.capabilities.map((capability) => capability.id), ["inside"]);
	const omissions = joined(result.omissions);
	assert.ok(omissions.includes("/etc/absolute.md"));
	assert.ok(omissions.includes("../outside.md"));
	assert.ok(omissions.includes("C:drive.md"));
});

test("produces a draft that the schema accepts even when a document is skipped", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [{ path: "odd/tasks/inside.md", text: "- [ ] **PM-4 — Inside**\n" }],
	});
	assert.ok(result.map);
	assert.deepEqual(validateProjectMap(result.map).diagnostics, []);
});
