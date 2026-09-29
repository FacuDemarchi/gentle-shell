import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	PROJECT_MAP_SCHEMA_V1,
	serializeProjectMap,
	validateProjectMap,
} from "../lib/shell-project-map-schema.ts";
import {
	collectProjectMapSteps,
	generateProjectMapDraft,
	normalizeIdentifier,
	readConfigTestCommand,
	readProjectMapDelegablePrefix,
	readProjectMapRoadmapPath,
	readProjectMapSurfaceMap,
	readSimpleConfigDeclarations,
	readSimpleConfigEntries,
} from "../lib/shell-project-map-draft.ts";
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

test("reads nested and dotted declared roadmap paths from simple config entries", () => {
	assert.equal(readProjectMapRoadmapPath("project_map:\n  roadmap: roadmaps/launch.md\n"), "roadmaps/launch.md");
	assert.equal(readProjectMapRoadmapPath("project_map.roadmap: odd/tasks/a.md\n"), "odd/tasks/a.md");
	assert.equal(readProjectMapRoadmapPath("project_map.roadmap: odd/tasks/first.md\nproject_map:\n  roadmap: odd/tasks/later.md\n"), "odd/tasks/later.md");
	assert.equal(readProjectMapRoadmapPath("project_map:\n  roadmap: odd/tasks/first.md\nproject_map.roadmap: odd/tasks/later.md\n"), "odd/tasks/later.md");
	assert.equal(readProjectMapRoadmapPath("project_map.roadmap: odd/tasks/first.md\nproject_map.roadmap: \"\"\n"), "odd/tasks/first.md");
	assert.equal(readConfigTestCommand(readSimpleConfigEntries("apply.test_command: pnpm test\n")), "pnpm test");
	assert.equal(readProjectMapRoadmapPath("project_map:\n  other: value\n"), null);
	assert.equal(readProjectMapRoadmapPath("project_map:\n  roadmap:    \n"), null);
	assert.equal(readProjectMapRoadmapPath(42 as unknown as string), null);
});

test("documents that blank repetitions leave the earlier usable roadmap declaration standing", () => {
	const documentation = readFileSync(join(import.meta.dirname, "..", "docs", "project-map.md"), "utf8");
	assert.ok(documentation.includes("the last usable declaration wins, and a blank value leaves an earlier declaration standing"));
});

test("normalizes declared roadmap aliases without correcting unsafe parent paths", () => {
	assert.equal(readProjectMapRoadmapPath("project_map:\n  roadmap: odd//./tasks/a.md\n"), "odd/tasks/a.md");
	assert.equal(readProjectMapRoadmapPath("project_map:\n  roadmap: ../odd/./tasks/a.md\n"), "../odd/tasks/a.md");
});

test("uses a dotted roadmap declaration as the sole capability source", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map.roadmap: odd/tasks/declared.md\n",
		oddTaskDocuments: [
			{ path: "odd/tasks/declared.md", text: "- [ ] **Declared — Shipped capability**\n" },
			{ path: "odd/tasks/reference.md", text: "- [ ] **Reference — Must not contribute**\n" },
		],
	});
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.id), ["shipped-capability"]);
});

test("uses only the declared roadmap as a capability source", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  roadmap: odd/tasks/declared.md\n",
		oddTaskDocuments: [
			{ path: "odd/tasks/declared.md", text: "- [ ] **Declared — Shipped capability**\n" },
			{ path: "odd/tasks/reference.md", text: "# Reference only\n" },
		],
	});
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.id), ["shipped-capability"]);
	assert.ok(joined(result.assumptions).includes("odd/tasks/declared.md"));
	assert.equal(joined(result.omissions).includes("odd/tasks/reference.md declares no work unit"), false);
});

test("keeps every supplied document as a source when no roadmap is declared", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [
			{ path: "odd/tasks/one.md", text: "- [ ] **One — First capability**\n" },
			{ path: "odd/tasks/two.md", text: "- [ ] **Two — Second capability**\n" },
		],
	});
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.id), ["first-capability", "second-capability"]);
	assert.ok(joined(result.assumptions).toLowerCase().includes("no project_map.roadmap is declared"));
});

test("reports a declared roadmap whose document could not be read", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  roadmap: roadmaps/missing.md\n",
		oddTaskDocuments: [{ path: "odd/tasks/other.md", text: "- [ ] **Other — Not selected**\n" }],
	});
	assert.deepEqual(result.map?.capabilities, []);
	assert.deepEqual(
		result.omissions.filter((omission) => omission.includes("roadmaps/missing.md")),
		["openspec/config.yaml declares the roadmap \"roadmaps/missing.md\", but no document with that path could be read, so no capability could be extracted from it."],
	);
});

test("reports an unsafe declared roadmap without reading it", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  roadmap: ../outside.md\n",
		oddTaskDocuments: [{ path: "odd/tasks/other.md", text: "- [ ] **Other — Not selected**\n" }],
	});
	assert.deepEqual(result.map?.capabilities, []);
	assert.ok(joined(result.omissions).includes("../outside.md"));
	assert.ok(joined(result.omissions).includes("not a safe repository-relative path"));
});

test("treats a blank roadmap declaration as no declaration", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  roadmap:    \n",
		oddTaskDocuments: [
			{ path: "odd/tasks/one.md", text: "- [ ] **One — First capability**\n" },
			{ path: "odd/tasks/two.md", text: "- [ ] **Two — Second capability**\n" },
		],
	});
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.id), ["first-capability", "second-capability"]);
	assert.ok(joined(result.assumptions).toLowerCase().includes("no project_map.roadmap is declared"));
});

test("reads declared surface prefixes and reports only blank and unsupported declarations", () => {
	const parsed = readProjectMapSurfaceMap([
		"project_map:",
		"  surfaces:",
		"    web: apps/web/, packages/web/",
		"    api: apps/api/",
		"    data: , ,",
		"    mobile: apps/mobile/",
		"",
	].join("\n"));
	assert.deepEqual([...parsed.surfaces], [
		["web", ["apps/web/", "packages/web/"]],
		["api", ["apps/api/"]],
	]);
	assert.deepEqual(parsed.blankSurfaces, ["data"]);
	assert.deepEqual(parsed.unusableKeys, ["project_map.surfaces.mobile"]);
	assert.deepEqual(readProjectMapSurfaceMap(undefined), { surfaces: new Map(), unusableKeys: [], blankSurfaces: [] });
});

test("derives surfaces from only backticked declared paths using the longest matching prefix", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: [
			"project_map:",
			"  surfaces:",
			"    api: packages/",
			"    data: packages/database/",
			"    web: apps/web/",
			"",
		].join("\n"),
		oddTaskDocuments: [{
			path: "odd/tasks/roadmap.md",
			text: [
				"- [ ] **FP-1 — Catalog**",
				"  **Allowed edit surfaces:** prose packages/ignored and `packages/database/query.ts` plus `apps/web/page.ts`.",
				"",
			].join("\n"),
		}],
	});
	assert.deepEqual(result.map?.capabilities[0]?.surfaces, ["web", "data"]);
	assert.equal(result.omissions.some((omission) => omission.includes("packages/ignored")), false);
});

test("reports all unmatched declared paths in one omission per capability", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  surfaces:\n    web: apps/web/\n",
		oddTaskDocuments: [{
			path: "odd/tasks/roadmap.md",
			text: [
				"- [ ] **FP-1 — Catalog**",
				"  **Allowed edit surfaces:** `packages/catalog/` and `docs/catalog.md`.",
				"",
			].join("\n"),
		}],
	});
	const unmatched = result.omissions.filter((omission) => omission.includes("matched no project_map.surfaces prefix"));
	assert.deepEqual(unmatched, [
		"The capability \"catalog\" declared by odd/tasks/roadmap.md has paths that matched no project_map.surfaces prefix: packages/catalog/, docs/catalog.md.",
	]);
});

test("keeps surfaces empty when a capability or its document declares no allowed-edit-surfaces line", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  surfaces:\n    web: apps/web/\n",
		oddTaskDocuments: [
			{ path: "odd/tasks/one.md", text: "- [ ] **FP-1 — No line**\n  Body only.\n" },
			{ path: "odd/tasks/two.md", text: "- [ ] **FP-2 — Another no line**\n" },
		],
	});
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.surfaces), [[], []]);
	assert.equal(result.omissions.some((omission) => omission.includes("matched no project_map.surfaces prefix")), false);
});

test("switches the surface assumption and reports unusable surface declarations when a mapping is declared", () => {
	const mapped = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  surfaces:\n    web: apps/web/\n    api: ,\n    mobile: apps/mobile/\n",
		oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: "- [ ] **FP-1 — Catalog**\n  **Allowed edit surfaces:** `apps/web/page.ts`\n" }],
	});
	assert.deepEqual(mapped.map?.capabilities[0]?.surfaces, ["web"]);
	assert.ok(joined(mapped.assumptions).includes("capability's own declared edit surfaces through project_map.surfaces"));
	assert.equal(joined(mapped.assumptions).includes("leaves its surface list empty"), false);
	assert.ok(joined(mapped.omissions).includes("project_map.surfaces.api"));
	assert.ok(joined(mapped.omissions).includes("project_map.surfaces.mobile"));

	const unmapped = generateProjectMapDraft(sources("- [ ] **FP-1 — Catalog**\n  **Allowed edit surfaces:** `apps/web/page.ts`\n"));
	assert.deepEqual(unmapped.map?.capabilities[0]?.surfaces, []);
	assert.ok(joined(unmapped.assumptions).includes("leaves its surface list empty"));
	assert.equal(joined(unmapped.omissions).includes("matched no project_map.surfaces prefix"), false);
});

test("reads camel-cased productUx surface declarations in nested and dotted forms", () => {
	for (const configText of [
		"project_map:\n  surfaces:\n    productUx: apps/web/ux/\n",
		"project_map.surfaces.productUx: apps/web/ux/\n",
	]) {
		assert.deepEqual(readProjectMapSurfaceMap(configText), {
			surfaces: new Map([["productUx", ["apps/web/ux/"]]]),
			unusableKeys: [],
			blankSurfaces: [],
		});
		const result = generateProjectMapDraft({
			packageJson: manifest(),
			openspecConfig: configText,
			oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: "- [ ] **FP-1 — Catalog**\n  **Allowed edit surfaces:** `apps/web/ux/menu.ts`\n" }],
		});
		assert.deepEqual(result.map?.capabilities[0]?.surfaces, ["productUx"]);
		assert.equal(result.omissions.some((omission) => omission.includes("project_map.surfaces")), false);
	}
});

test("reports blank and unsupported surface declarations with or without values", () => {
	const nested = "project_map:\n  surfaces:\n    web:\n    api: \"\"\n    alien:\n    mobile: apps/mobile/\n";
	assert.deepEqual(readProjectMapSurfaceMap(nested), {
		surfaces: new Map(),
		unusableKeys: ["project_map.surfaces.alien", "project_map.surfaces.mobile"],
		blankSurfaces: ["web", "api"],
	});

	const shadowedBlank = readProjectMapSurfaceMap("project_map:\n  surfaces:\n    api: apps/api/\n    web:\n");
	assert.deepEqual([...shadowedBlank.surfaces], [["api", ["apps/api/"]]]);
	assert.deepEqual(shadowedBlank.blankSurfaces, ["web"]);
	assert.equal(readSimpleConfigDeclarations("project_map:\n  surfaces:\n    web:\n").get("project_map.surfaces.web"), null);

	const generated = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  surfaces:\n    api: apps/api/\n    web:\n    alien:\n",
		oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: "- [ ] **FP-1 — Catalog**\n  **Allowed edit surfaces:** `apps/api/catalog.ts`\n" }],
	});
	assert.deepEqual(generated.map?.capabilities[0]?.surfaces, ["api"]);
	assert.ok(joined(generated.omissions).includes("project_map.surfaces.web"));
	assert.ok(joined(generated.omissions).includes("project_map.surfaces.alien"));
	assert.equal(generated.omissions.some((omission) => omission.includes("matched no project_map.surfaces prefix")), false);
});

test("requires a value for a camel-cased surface name but still reports its empty value", () => {
	// A bare `productUx` is a parent to the shared configuration reader, not a surface declaration.
	assert.deepEqual(readProjectMapSurfaceMap("project_map:\n  surfaces:\n    productUx:\n"), {
		surfaces: new Map(),
		unusableKeys: [],
		blankSurfaces: [],
	});
	assert.deepEqual(readProjectMapSurfaceMap("project_map:\n  surfaces:\n    productUx: \"\"\n"), {
		surfaces: new Map(),
		unusableKeys: [],
		blankSurfaces: ["productUx"],
	});
	assert.deepEqual(readProjectMapSurfaceMap("project_map:\n  surfaces:\n    web: \"\"\n"), {
		surfaces: new Map(),
		unusableKeys: [],
		blankSurfaces: ["web"],
	});
	assert.deepEqual(readProjectMapSurfaceMap("project_map:\n  surfaces:\n    alien:\n"), {
		surfaces: new Map(),
		unusableKeys: ["project_map.surfaces.alien"],
		blankSurfaces: [],
	});
	assert.deepEqual(readProjectMapSurfaceMap("project_map:\n  surfaces:\n    alien: x\n"), {
		surfaces: new Map(),
		unusableKeys: ["project_map.surfaces.alien"],
		blankSurfaces: [],
	});
});

test("keeps uppercase bare parents from reparenting a shared test command", () => {
	const configText = "rules:\n  apply:\n    Upper:\n      test_command: npm test\n";
	// HEAD output: [["rules.apply.test_command", "npm test"]].
	assert.deepEqual([...readSimpleConfigEntries(configText)], [["rules.apply.test_command", "npm test"]]);
	assert.equal(readConfigTestCommand(readSimpleConfigEntries(configText)), "npm test");
});

test("keeps dotted bare parents from becoming a shared test-command path", () => {
	const configText = "rules.apply:\n  test_command: npm test\n";
	// HEAD output: [["test_command", "npm test"]].
	assert.deepEqual([...readSimpleConfigEntries(configText)], [["test_command", "npm test"]]);
	assert.equal(readConfigTestCommand(readSimpleConfigEntries(configText)), null);
});

test("uses the last usable surface value without also reporting it blank", () => {
	for (const configText of [
		"project_map.surfaces.web: apps/web/\nproject_map.surfaces.web:\n",
		"project_map:\n  surfaces:\n    web: apps/web/\n    web:\n",
		"project_map:\n  surfaces:\n    web:\n    web: apps/web/\n",
	]) {
		assert.deepEqual(readProjectMapSurfaceMap(configText), {
			surfaces: new Map([["web", ["apps/web/"]]]),
			unusableKeys: [],
			blankSurfaces: [],
		});
	}
	assert.deepEqual(readProjectMapSurfaceMap("project_map:\n  surfaces:\n    web:\n    web: \"\"\n"), {
		surfaces: new Map(),
		unusableKeys: [],
		blankSurfaces: ["web"],
	});
});

const delegableUnits = [
	"- [ ] **FP-0 — Foundation**",
	"- [ ] **FP-1b — Provisioning**",
	"- [ ] **FP-2 — Catalogue**",
	"- [ ] **FP-1b.0 — Provisioning preparation**",
	"- [ ] **FP-1b.8 — Provisioning close**",
	"- [ ] **DEL-1 — Delivery step**",
	"- [ ] **OF-2 — Operations step**",
	"- [ ] **ODD-3 — ODD step**",
	"- [ ] **T1 — Test step**",
	"- [ ] **A plain label with no code**",
	"",
].join("\n");

function delegableSources(openspecConfig: string) {
	return {
		packageJson: manifest(),
		openspecConfig,
		oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: delegableUnits }],
	};
}

test("reads a delegable prefix from nested and dotted declarations", () => {
	assert.equal(readProjectMapDelegablePrefix("project_map:\n  delegable: FP-\n"), "FP-");
	assert.equal(readProjectMapDelegablePrefix("project_map.delegable: FP-\n"), "FP-");
	for (const configText of [undefined, "project_map:\n  other: value\n", "project_map:\n  delegable: \"\"\n"]) {
		assert.equal(readProjectMapDelegablePrefix(configText), null);
	}
	assert.equal(readProjectMapDelegablePrefix(42 as unknown as string), null);
});

test("keeps only undotted convention codes as capability sources with or without a roadmap", () => {
	const noRoadmap = generateProjectMapDraft(delegableSources("project_map:\n  delegable: FP-\n"));
	const withRoadmap = generateProjectMapDraft(delegableSources("project_map:\n  roadmap: odd/tasks/roadmap.md\n  delegable: FP-\n"));
	for (const result of [noRoadmap, withRoadmap]) {
		assert.deepEqual(result.map?.capabilities.map((capability) => capability.outcome), [
			"FP-2 — Catalogue",
			"FP-0 — Foundation",
			"FP-1b — Provisioning",
		]);
		assert.equal(result.omissions.some((omission) => omission.includes("FP-1b.0") || omission.includes("FP-1b.8") || omission.includes("DEL-1") || omission.includes("OF-2") || omission.includes("ODD-3") || omission.includes("T1") || omission.includes("plain label")), false);
		assert.equal(result.assumptions.filter((assumption) => assumption.includes("read as steps instead of capabilities")).length, 1);
		assert.ok(joined(result.assumptions).includes("7 work units were read as steps instead of capabilities"));
	}
});

test("switches the no-roadmap assumption only when a delegable convention is declared", () => {
	const declared = generateProjectMapDraft(delegableSources("project_map:\n  delegable: FP-\n"));
	assert.ok(joined(declared.assumptions).includes("codes do not match the declared \"FP-\" convention were read as steps"));
	assert.equal(joined(declared.assumptions).includes("granularity may be mixed"), false);

	const fallback = generateProjectMapDraft(delegableSources("project_map:\n  other: value\n"));
	assert.ok(joined(fallback.assumptions).includes("every top-level work unit of every supplied ODD task document became a capability source and their granularity may be mixed"));
	assert.equal(joined(fallback.assumptions).includes("read as steps instead of capabilities"), false);
});

test("keeps the generated map, omissions, and assumptions unchanged without a delegable declaration", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  other: value\n",
		oddTaskDocuments: [{ path: "odd/tasks/roadmap.md", text: "- [ ] **FP-1 — Catalog**\n" }],
	});
	assert.equal(serializeProjectMap(result.map!), [
		"{",
		'  "version": "gentle-shell.project-map/v1",',
		'  "project": {',
		'    "id": "example-shop",',
		'    "name": "example-shop"',
		"  },",
		'  "approval": {',
		'    "state": "draft"',
		"  },",
		'  "foundations": [',
		"    {",
		'      "id": "quality-gates",',
		'      "outcome": "The project declares the automated gates that guard a change.",',
		'      "state": "planned"',
		"    },",
		"    {",
		'      "id": "repository-tooling",',
		'      "outcome": "The repository and its declared tooling are present and consistent.",',
		'      "state": "done",',
		'      "evidence": [',
		'        "package.json"',
		"      ]",
		"    }",
		"  ],",
		'  "capabilities": [',
		"    {",
		'      "id": "catalog",',
		'      "outcome": "FP-1 — Catalog",',
		'      "foundationRefs": [],',
		'      "dependsOn": [],',
		'      "contracts": [],',
		'      "featureDocs": [',
		'        "odd/tasks/roadmap.md"',
		"      ],",
		'      "surfaces": [],',
		'      "state": "planned"',
		"    }",
		"  ]",
		"}",
		"",
	].join("\n"));
	assert.deepEqual(result.assumptions, [
		"No project_map.roadmap is declared, so every top-level work unit of every supplied ODD task document became a capability source and their granularity may be mixed.",
		"Every generated map is a draft: this generator never marks a map approved, and approval requires a human actor and an explicit transition.",
		"A generated foundation is done only when its named structured source carries a well-formed declaration of it; done therefore means declared, not verified.",
		"Foundation identifiers are generic proposals derived from repository tooling, and the human is expected to replace or extend them with the project's real foundations.",
		"Project identity is derived from the package manifest name, with the scope removed and the remainder normalized to lowercase kebab-case.",
		"An ODD work unit becomes a capability named after its title, a checked box becomes done and an unchecked box becomes planned, and the declaring document becomes its feature document. The checkbox is a declaration of completion, not verified progress.",
		"A generated capability leaves its surface list empty, because no structured source states which product surfaces it touches.",
	]);
	assert.deepEqual(result.omissions, [
		"openspec/config.yaml declares no apply.test_command, so the quality gates foundation stays planned.",
		"No structured source in this step names product capabilities; they must come from the ODD work-unit extraction or from the human.",
	]);
});

test("keeps HEAD's no-capability omission unless a convention read the unit as a step", () => {
	const document = "- [ ] **!!!**\n";
	const withoutConvention = generateProjectMapDraft({
		packageJson: manifest(),
		oddTaskDocuments: [{ path: "odd/tasks/invalid.md", text: document }],
	});
	assert.ok(joined(withoutConvention.omissions).includes("cannot be normalized into a capability identifier"));
	assert.ok(joined(withoutConvention.omissions).includes("odd/tasks/invalid.md declares no work unit this generator can read"));

	const withConvention = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  delegable: FP-\n",
		oddTaskDocuments: [{ path: "odd/tasks/invalid.md", text: document }],
	});
	assert.ok(joined(withConvention.omissions).includes("cannot be normalized into a capability identifier"));
	assert.equal(joined(withConvention.omissions).includes("odd/tasks/invalid.md declares no work unit this generator can read"), false);
	assert.ok(joined(withConvention.assumptions).includes("1 work unit was read as steps instead of capabilities"));
});

test("uses the whole separator-free label as the code under a delegable convention", () => {
	const result = generateProjectMapDraft({
		packageJson: manifest(),
		openspecConfig: "project_map:\n  delegable: FP-\n",
		oddTaskDocuments: [{
			path: "odd/tasks/codes.md",
			text: ["- [ ] **FP-1**", "- [ ] **FP-1b.0**", "- [ ] **F5-1**", "- [ ] **Do the thing**", ""].join("\n"),
		}],
	});
	assert.deepEqual(result.map?.capabilities.map((capability) => capability.outcome), ["FP-1"]);
	assert.ok(joined(result.assumptions).includes("3 work units were read as steps instead of capabilities"));
	assert.equal(result.omissions.some((omission) => omission.includes("FP-1b.0") || omission.includes("F5-1") || omission.includes("Do the thing")), false);
});

function expectedHeadCapability(path: string, id: string, outcome: string) {
	return {
		id,
		outcome,
		foundationRefs: [],
		dependsOn: [],
		contracts: [],
		featureDocs: [path],
		surfaces: [],
		state: "planned" as const,
	};
}

const headFallbackAssumptions = [
	"No project_map.roadmap is declared, so every top-level work unit of every supplied ODD task document became a capability source and their granularity may be mixed.",
	"Every generated map is a draft: this generator never marks a map approved, and approval requires a human actor and an explicit transition.",
	"A generated foundation is done only when its named structured source carries a well-formed declaration of it; done therefore means declared, not verified.",
	"Foundation identifiers are generic proposals derived from repository tooling, and the human is expected to replace or extend them with the project's real foundations.",
	"Project identity is derived from the package manifest name, with the scope removed and the remainder normalized to lowercase kebab-case.",
	"An ODD work unit becomes a capability named after its title, a checked box becomes done and an unchecked box becomes planned, and the declaring document becomes its feature document. The checkbox is a declaration of completion, not verified progress.",
	"A generated capability leaves its surface list empty, because no structured source states which product surfaces it touches.",
];

function expectedHeadSerialization(capabilities: ReturnType<typeof expectedHeadCapability>[]) {
	return serializeProjectMap({
		version: PROJECT_MAP_SCHEMA_V1,
		project: { id: "example-shop", name: "example-shop" },
		approval: { state: "draft" },
		foundations: [
			{ id: "quality-gates", outcome: "The project declares the automated gates that guard a change.", state: "planned" },
			{ id: "repository-tooling", outcome: "The repository and its declared tooling are present and consistent.", state: "done", evidence: ["package.json"] },
		],
		capabilities,
	});
}

test("collects all thirteen coded sub-elements from every document in deterministic order", () => {
	const documents = [
		{
			path: "odd/tasks/zulu.md",
			text: [
				"- [x] **FP-1b.0 — Later duplicate**",
				"- [x] **FP-1b.8 — Final top-level step**",
				"",
			].join("\n"),
		},
		{
			path: "odd/tasks/alpha.md",
			text: [
				"- [ ] **FP-1b — Provisioning**",
				"  - [x] **FP-1b.0 — First nested step**",
				"  - [ ] **FP-1b.1 — Planned nested step**",
				"- [~] **FP-1b.1a — Active top-level step**",
				"- [x] **FP-1b.2 — Done step**",
				"- [ ] **FP-1b.3 — Planned step**",
				"- [x] **FP-1b.3a — Done lettered step**",
				"- [x] **FP-1b.3a-b — Done hyphenated step**",
				"- [x] **FP-1b.3b — Done lettered sibling**",
				"- [x] **FP-1b.4 — Done fourth step**",
				"- [ ] **FP-1b.5 — Planned fifth step**",
				"- [x] **FP-1b.6 — Done sixth step**",
				"- [~] **FP-1b.7 — Active seventh step**",
				"- [x] **FP-1b — The functional point itself**",
				"- [x] **FP-1b-extra.2 — Shares a prefix without the dot**",
				"- [x] **FP-1.b.3 — Carries the dot elsewhere**",
				"- [x] **FP-4a1 — Continues with a letter rather than a dot**",
				"- [x] **An uncoded unit**",
				"",
			].join("\n"),
		},
	];
	const steps = collectProjectMapSteps(documents, "FP-1b");

	assert.deepEqual(steps, [
		{ code: "FP-1b.0", title: "First nested step", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.1", title: "Planned nested step", state: "planned", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.1a", title: "Active top-level step", state: "active", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.2", title: "Done step", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.3", title: "Planned step", state: "planned", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.3a", title: "Done lettered step", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.3a-b", title: "Done hyphenated step", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.3b", title: "Done lettered sibling", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.4", title: "Done fourth step", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.5", title: "Planned fifth step", state: "planned", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.6", title: "Done sixth step", state: "done", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.7", title: "Active seventh step", state: "active", path: "odd/tasks/alpha.md" },
		{ code: "FP-1b.8", title: "Final top-level step", state: "done", path: "odd/tasks/zulu.md" },
	]);
	assert.deepEqual(collectProjectMapSteps(documents, "FP-4"), []);
	assert.deepEqual(collectProjectMapSteps([{ path: "odd/tasks/alpha.md", text: "- [ ] **FP-1b.0 — Setup**\n" }], "FP-9"), []);
});

test("matches HEAD's complete output for synthetic no-convention corpora", () => {
	const commonOmissions = [
		"openspec/config.yaml declares no apply.test_command, so the quality gates foundation stays planned.",
		"No structured source in this step names product capabilities; they must come from the ODD work-unit extraction or from the human.",
	];
	const cases = [
		{
			name: "an invalid title",
			documents: [{ path: "odd/tasks/invalid.md", text: "- [ ] **!!!**\n" }],
			capabilities: [],
			omissions: [
				...commonOmissions,
				'The work unit line "- [ ] **!!!**" in odd/tasks/invalid.md cannot be normalized into a capability identifier.',
				"odd/tasks/invalid.md declares no work unit this generator can read, so it contributed no capability.",
				"No supplied source names a product capability, so the draft carries none; capabilities must come from the ODD work-unit extraction or from the human.",
			],
		},
		{
			name: "a document containing only steps",
			documents: [{ path: "odd/tasks/steps.md", text: "- [ ] **DEL-1 — Delivery step**\n" }],
			capabilities: [expectedHeadCapability("odd/tasks/steps.md", "delivery-step", "DEL-1 — Delivery step")],
			omissions: commonOmissions,
		},
		{
			name: "a collision",
			documents: [
				{ path: "odd/tasks/a.md", text: "- [ ] **FP-1 — Shared**\n" },
				{ path: "odd/tasks/b.md", text: "- [ ] **FP-2 — Shared**\n" },
			],
			capabilities: [expectedHeadCapability("odd/tasks/a.md", "shared", "FP-1 — Shared")],
			omissions: [
				...commonOmissions,
				'The capability "shared" is declared by both odd/tasks/a.md, line "- [ ] **FP-1 — Shared**", and odd/tasks/b.md, line "- [ ] **FP-2 — Shared**"; the first document in sorted order wins.',
			],
		},
		{
			name: "only delegable units",
			documents: [{ path: "odd/tasks/delegable.md", text: "- [ ] **FP-1**\n- [ ] **FP-2 — Two**\n" }],
			capabilities: [
				expectedHeadCapability("odd/tasks/delegable.md", "fp-1", "FP-1"),
				expectedHeadCapability("odd/tasks/delegable.md", "two", "FP-2 — Two"),
			],
			omissions: commonOmissions,
		},
	];
	for (const fixture of cases) {
		const result = generateProjectMapDraft({
			packageJson: manifest(),
			openspecConfig: "project_map:\n  other: value\n",
			oddTaskDocuments: fixture.documents,
		});
		assert.deepEqual(result.map?.capabilities, fixture.capabilities, fixture.name);
		assert.equal(serializeProjectMap(result.map!), expectedHeadSerialization(fixture.capabilities), fixture.name);
		assert.deepEqual(result.omissions, fixture.omissions, fixture.name);
		assert.deepEqual(result.assumptions, headFallbackAssumptions, fixture.name);
	}
});
