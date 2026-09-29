import assert from "node:assert/strict";
import test from "node:test";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	PROJECT_MAP_SCHEMA_V1,
	serializeProjectMap,
	validateProjectMap,
} from "../lib/shell-project-map-schema.ts";
import { generateProjectMapDraft, normalizeIdentifier } from "../lib/shell-project-map-draft.ts";
import { readCapabilityDescription } from "../lib/project-map-description.ts";

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

function sources(text: string) {
	return {
		packageJson: manifest(),
		oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text }],
	};
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
	for (const packageJson of [undefined, {}, { name: "   " }, { name: "!!!" }, { name: "a".repeat(70) }, { name: 42 }]) {
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

test("keeps the written work-unit label as the outcome and leaves surfaces undetermined", () => {
	const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: roadmap }] });
	const capability = result.map?.capabilities.find((entry) => entry.id === "add-draft-generation-and-human-plan-approval");
	assert.equal(capability?.outcome, "PM-2 — Add draft generation and human plan approval");
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

test("deduplicates cross-document capability identifiers and names both source lines", () => {
	const firstLine = "- [ ] **PM-9 — Shared title**";
	const secondLine = "- [ ] **PM-8 — Shared title**";
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [
			{ path: "odd/tasks/a.md", text: `${firstLine}\n` },
			{ path: "odd/tasks/b.md", text: `${secondLine}\n` },
		],
	});
	assert.ok(result.map);
	assert.equal(result.map.capabilities.filter((capability) => capability.id === "shared-title").length, 1);
	assert.equal(result.map.capabilities[0].featureDocs[0], "odd/tasks/a.md");
	const omissions = joined(result.omissions);
	assert.ok(omissions.includes("shared-title"));
	assert.ok(omissions.includes("odd/tasks/a.md"));
	assert.ok(omissions.includes("odd/tasks/b.md"));
	assert.ok(omissions.includes(firstLine));
	assert.ok(omissions.includes(secondLine));
});

test("deduplicates a capability declared twice in one document and names both source lines", () => {
	const firstLine = "- [ ] **PM-9 — Shared title**";
	const secondLine = "- [ ] **PM-8 — Shared title**";
	const result = generateProjectMapDraft(sources(`${firstLine}\n${secondLine}\n`));
	assert.equal(result.map?.capabilities.filter((capability) => capability.id === "shared-title").length, 1);
	const omissions = joined(result.omissions);
	assert.ok(omissions.includes("declared twice in odd/tasks/roadmap.md"));
	assert.ok(omissions.includes(firstLine));
	assert.ok(omissions.includes(secondLine));
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

test("reports an invalid work-unit title with its source line", () => {
	for (const line of ["- [ ] **PM-1 — !!!**", "- [ ] **FP — !!!** trailing"]) {
		const result = generateProjectMapDraft({ packageJson: manifest(), oddTaskDocuments: [{ path: "odd/tasks/odd.md", text: `${line}\n` }] });
		assert.ok(result.map);
		assert.deepEqual(result.map.capabilities, []);
		assert.ok(joined(result.omissions).includes("odd/tasks/odd.md"));
		assert.ok(joined(result.omissions).includes(line));
	}
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

test("reads the quality gate from the nested OpenSpec rule block the repository writes", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: ["schema: spec-driven", "rules:", "  apply:", '    test_command: "pnpm test"', ""].join("\n"),
	});
	assert.equal(result.map?.foundations.find((entry) => entry.id === "quality-gates")?.state, "done");
	assert.ok(!joined(result.omissions).includes("declares no apply.test_command"));
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

test("reads a work unit that carries text after its closing bold label", () => {
	const result = generateProjectMapDraft(sources("- [ ] **FP-1b — Provisioning** (blocked on accounts): the projects\n"));
	assert.deepEqual(result.map?.capabilities, [
		{
			id: "provisioning",
			outcome: "FP-1b — Provisioning",
			foundationRefs: [],
			dependsOn: [],
			contracts: [],
			featureDocs: ["odd/tasks/roadmap.md"],
			surfaces: [],
			state: "planned",
		},
	]);
	assert.ok(!joined(result.omissions).includes("Provisioning"));
});

test("maps an active work-unit marker to active and keeps it explainable", () => {
	const documentText = "- [~] **FP-6 — Merchant order notification**\n  Notify merchants when an order arrives.\n";
	const result = generateProjectMapDraft(sources(documentText));
	const capability = result.map?.capabilities[0];
	assert.equal(capability?.state, "active");
	assert.deepEqual(readCapabilityDescription(documentText, capability?.id ?? ""), {
		title: "Merchant order notification",
		lines: ["Notify merchants when an order arrives."],
	});
});

test("keeps the whole written label as the outcome while the id uses its title", () => {
	const result = generateProjectMapDraft(sources("- [x] **PM-2 — Add draft generation** — **delivered**: notes\n"));
	assert.deepEqual(result.map?.capabilities[0], {
		id: "add-draft-generation",
		outcome: "PM-2 — Add draft generation",
		foundationRefs: [],
		dependsOn: [],
		contracts: [],
		featureDocs: ["odd/tasks/roadmap.md"],
		surfaces: [],
		state: "done",
	});
});

test("truncates a long work-unit title while its description still resolves", () => {
	const documentText = "- [ ] **FP-0b — Local dev service-worker freshness (small, found by the prototype acceptance)**\n  The browser keeps the service worker current.\n";
	const result = generateProjectMapDraft(sources(documentText));
	const capability = result.map?.capabilities[0];
	assert.ok(capability);
	assert.ok(capability.id.length <= 64);
	assert.deepEqual(validateProjectMap(result.map).diagnostics, []);
	assert.ok(!joined(result.omissions).includes("cannot be normalized"));
	assert.deepEqual(readCapabilityDescription(documentText, capability.id), {
		title: "Local dev service-worker freshness (small, found by the prototype acceptance)",
		lines: ["The browser keeps the service worker current."],
	});
});

test("reports unreadable top-level work units instead of silently dropping them", () => {
	for (const line of ["- [-] **Something unreadable**", "- [] **Empty marker**"]) {
		const result = generateProjectMapDraft(sources(`${line}\n`));
		assert.deepEqual(result.map?.capabilities, []);
		assert.ok(joined(result.omissions).includes("odd/tasks/roadmap.md"));
		assert.ok(joined(result.omissions).includes(line));
	}
});

test("reads runs of whitespace around a work-unit marker", () => {
	const result = generateProjectMapDraft(sources("-  [ ] **X**\n-\t[ ] **Tab**\n- [ ]  **FP-5 — Two spaces**\n"));
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.id), ["tab", "two-spaces", "x"]);
	assert.equal(result.map?.capabilities[1]?.outcome, "FP-5 — Two spaces");
});

test("normalizes long identifiers with the documented fallback boundaries", () => {
	assert.equal(normalizeIdentifier("a".repeat(64)), "a".repeat(64));
	assert.equal(normalizeIdentifier("a".repeat(65)), "a".repeat(64));
	assert.equal(normalizeIdentifier(`a-${"b".repeat(62)}`), `a-${"b".repeat(62)}`);
	const fallback = normalizeIdentifier(`a-${"b".repeat(63)}`);
	assert.ok(fallback);
	assert.ok(fallback.length > 1);
	assert.ok(fallback.length <= 64);
	assert.match(fallback, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("never returns an identifier that a hard cut left ending in a separator", () => {
	// The 64th character of this normalization is the hyphen, so the fallback cut would end in it.
	const boundary = `${"b".repeat(63)} - c`;
	const id = normalizeIdentifier(boundary);
	assert.ok(id);
	assert.ok(id.length <= 64);
	assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
	assert.ok(!id.endsWith("-"));
});

test("does not read an indented work unit", () => {
	const result = generateProjectMapDraft(sources("  - [ ] **Nested unit**\n"));
	assert.deepEqual(result.map?.capabilities, []);
});

test("keeps a plain work unit working", () => {
	const result = generateProjectMapDraft(sources("- [ ] **Do the thing**\n"));
	assert.equal(result.map?.capabilities[0]?.outcome, "Do the thing");
	assert.equal(result.map?.capabilities[0]?.id, "do-the-thing");
});

test("documents that bold text inside a label stops at the first closing emphasis", () => {
	const result = generateProjectMapDraft(sources("- [ ] **Add **dual** support**\n"));
	assert.equal(result.map?.capabilities[0]?.outcome, "Add");
	assert.equal(result.map?.capabilities[0]?.id, "add");
});
