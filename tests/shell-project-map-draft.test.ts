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
