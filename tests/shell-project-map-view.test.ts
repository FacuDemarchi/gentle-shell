import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	PROJECT_MAP_SCHEMA_V1,
	type ProjectMapV1,
} from "../lib/shell-project-map-schema.ts";
import {
	PROJECT_MAP_EXPANDED,
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	PROJECT_MAP_STATE_GLYPH,
	projectMapCardBody,
	projectMapCardDescriptor,
	projectMapCardDigest,
	projectMapCardState,
	projectMapCoverage,
	projectMapGroupFromHeader,
	projectMapSummaryLine,
	toggleProjectMapGroup,
	type ProjectMapCardState,
} from "../lib/shell-project-map-view.ts";

function map(overrides: Partial<ProjectMapV1> = {}): ProjectMapV1 {
	return {
		version: PROJECT_MAP_SCHEMA_V1,
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "draft" },
		foundations: [{ id: "repository-tooling", outcome: "Tooling is declared.", state: "done", evidence: ["package.json"] }],
		capabilities: [
			{ id: "merchant-catalog", outcome: "Merchants manage a catalog.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web", "api"], state: "done" },
			{ id: "shopping-cart", outcome: "Shoppers build a cart.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: [], state: "planned" },
			{ id: "checkout", outcome: "Shoppers check out.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "blocked" },
		],
		...overrides,
	};
}

function ready(state: ProjectMapV1) {
	return {
		kind: "ready",
		path: PROJECT_MAP_ARTIFACT_PATH,
		map: state,
		coverage: projectMapCoverage(state),
		overlay: PROJECT_MAP_OVERLAY_UNAVAILABLE,
	} as const;
}

function withArtifact(text: string | null, run: (path: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "project-map-view-"));
	try {
		const path = join(directory, "project-map.json");
		if (text !== null) writeFileSync(path, text, "utf8");
		run(path);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("publishes a glyph for every frozen state", () => {
	assert.deepEqual(Object.keys(PROJECT_MAP_STATE_GLYPH).sort(), ["active", "blocked", "done", "planned", "ready", "review"]);
	assert.equal(PROJECT_MAP_STATE_GLYPH.done, "✓");
	assert.equal(PROJECT_MAP_STATE_GLYPH.blocked, "✕");
});

test("classifies a missing artifact as empty", () => {
	withArtifact(null, (path) => {
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		assert.equal(state.kind, "empty");
		const descriptor = projectMapCardDescriptor(state);
		assert.equal(descriptor.tone, "info");
		assert.ok(descriptor.body.join("\n").includes(PROJECT_MAP_ARTIFACT_PATH));
		assert.ok(descriptor.body.join("\n").includes("/gentle:project-map draft"));
	});
});

test("classifies an invalid artifact as invalid and shows the diagnostic path", () => {
	withArtifact(JSON.stringify({ version: PROJECT_MAP_SCHEMA_V1, project: { id: "example-shop", name: "" }, capabilities: [] }), (path) => {
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		assert.equal(state.kind, "invalid");
		const descriptor = projectMapCardDescriptor(state);
		assert.equal(descriptor.tone, "error");
		assert.ok(descriptor.body.join("\n").includes("$.project.name"), "expected the diagnostic path in the card");
	});
});

test("classifies malformed JSON as invalid and renders its diagnostic", () => {
	withArtifact("{", (path) => {
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		assert.equal(state.kind, "invalid");
		const diagnostics = (state as { diagnostics?: Array<{ code: string; message: string }> }).diagnostics;
		assert.ok(diagnostics?.some((diagnostic) => diagnostic.code === "project-map/invalid-json"));
		const descriptor = projectMapCardDescriptor(state);
		assert.equal(descriptor.tone, "error");
		assert.ok(descriptor.body.join("\n").includes(diagnostics?.[0]?.message ?? ""));
	});
});

test("caps invalid diagnostics at three and points to the full report", () => {
	withArtifact(JSON.stringify({ version: PROJECT_MAP_SCHEMA_V1, claim: "session-42", x: true, project: { name: "" }, foundations: [], capabilities: [] }), (path) => {
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		assert.equal(state.kind, "invalid");
		if (state.kind !== "invalid") return;
		assert.ok(state.diagnostics.length > 3, "the artifact produces more diagnostics than the card may render");
		const rendered = state.diagnostics.slice(0, 3).map((diagnostic) => `  ${diagnostic.path}: ${diagnostic.message}`);
		const fourth = `  ${state.diagnostics[3]!.path}: ${state.diagnostics[3]!.message}`;
		const descriptor = projectMapCardDescriptor(state);
		assert.deepEqual(descriptor.body.slice(1, -1), rendered);
		assert.equal(descriptor.body.includes(fourth), false);
		assert.equal(descriptor.body.at(-1), "Run /gentle:project-map status for the full report.");
	});
});

test("classifies a valid artifact as ready and carries the map", () => {
	withArtifact(`${JSON.stringify(map(), null, 2)}\n`, (path) => {
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		assert.equal(state.kind, "ready");
		if (state.kind === "ready") assert.equal(state.map.project.id, "example-shop");
	});
});

test("renders the approval state in the subtitle so a draft never reads as approved", () => {
	const draft = projectMapCardDescriptor(ready(map()));
	assert.ok(draft.subtitle.includes("Example Shop"));
	assert.ok(draft.subtitle.includes("draft"));
	assert.equal(draft.tone, "warning");

	const approved = projectMapCardDescriptor(
		ready(map({ approval: { state: "approved", approvedAt: "2026-09-23T12:00:00Z", approvedBy: "facundo" } })),
	);
	assert.ok(approved.subtitle.includes("approved"));
	assert.equal(approved.tone, "success");
});

test("renders grouped rows with done indicators and lifecycle glyphs", () => {
	const descriptor = projectMapCardDescriptor(ready(map()));
	const body = descriptor.body.join("\n");
	assert.ok(body.includes("▾ Foundations 1/1"));
	assert.ok(body.includes("▾ Product capabilities 1/3"));
	assert.ok(body.includes(`✓ repository-tooling`));
	assert.ok(body.includes(`✓ merchant-catalog · Web · API`));
	assert.ok(body.includes(`✕ checkout · Web`));
});

test("structured card body records group headers and the selected capability row", () => {
	const body = projectMapCardBody(ready(map()), PROJECT_MAP_EXPANDED, "checkout");
	assert.deepEqual(body.headers, [{ line: 0, group: "foundations" }, { line: 2, group: "capabilities" }]);
	assert.equal(body.selected, 5);
	assert.match(body.lines[body.selected!], /^▸ ✕ checkout/, "selection replaces the indent while retaining the lifecycle glyph");
});

test("a pre-bounded capability row reports its whole body span", () => {
	const longId = `capability-${"x".repeat(53)}`;
	const body = projectMapCardBody(ready(map({ capabilities: [{ ...map().capabilities[0]!, id: longId }] })), PROJECT_MAP_EXPANDED);
	const target = body.capabilities[0]!;
	assert.ok(target.height > 1, "the row spans several body lines");
	assert.ok(body.lines[target.line]!.includes("✓"), "the span starts on the glyph line");
	assert.ok(body.lines[target.line + target.height - 1]!.includes("Web"), "the span ends on the surfaces line");
});

test("inspector renders every field, empty lists, and static blockers without runtime data", () => {
	const inspected = map({
		foundations: [{ id: "tooling", outcome: "Tooling", state: "planned", evidence: [] }],
		capabilities: [
			{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "done" },
			{ id: "checkout", outcome: "Complete a purchase.", foundationRefs: ["tooling"], dependsOn: ["catalog"], contracts: ["checkout-api"], featureDocs: ["odd/tasks/checkout.md"], surfaces: ["web"], state: "blocked" },
		],
	});
	const body = projectMapCardDescriptor(ready(inspected), PROJECT_MAP_EXPANDED, "checkout").body.join("\n");
	for (const text of ["Inspector", "✕ checkout", "Outcome: Complete a purchase.", "Surfaces: Web", "Foundations: tooling ○", "Dependencies: catalog ✓", "Contracts: checkout-api", "Feature documents: odd/tasks/checkout.md", "Static blockers: state is blocked, foundation tooling ○", "Runtime overlay: not wired yet."]) assert.ok(body.includes(text), `expected ${text}`);
	assert.equal(body.includes("lease"), false, "runtime blockers are not invented");
	const empty = projectMapCardDescriptor(ready(map()), PROJECT_MAP_EXPANDED, "shopping-cart").body.join("\n");
	for (const field of ["Surfaces: none", "Foundations: none", "Dependencies: none", "Contracts: none", "Feature documents: none", "Static blockers: none"]) assert.ok(empty.includes(field), `expected ${field}`);
});

test("inspector content and selection move the digest within the body budget", () => {
	const base = ready(map());
	const selected = projectMapCardDigest(base, PROJECT_MAP_EXPANDED, "checkout");
	assert.notEqual(selected, projectMapCardDigest(base), "selection adds the inspector to the descriptor");
	const changed = map({ capabilities: [map().capabilities[0], map().capabilities[1], { ...map().capabilities[2], outcome: "A changed selected outcome." }] });
	assert.notEqual(projectMapCardDigest(ready(changed), PROJECT_MAP_EXPANDED, "checkout"), selected, "selected inspector content moves the digest");
	const long = map({ capabilities: [{ ...map().capabilities[0], outcome: "x".repeat(180), contracts: ["contract-" + "x".repeat(100)], featureDocs: ["odd/tasks/" + "y".repeat(100) + ".md"] }] });
	for (const line of projectMapCardDescriptor(ready(long), PROJECT_MAP_EXPANDED, long.capabilities[0]!.id).body) assert.ok(line.length <= 60, `inspector line exceeds 60 columns: ${line}`);
});

test("collapsing one group preserves the other group and its header", () => {
	const state = ready(map());
	const collapsed = toggleProjectMapGroup(PROJECT_MAP_EXPANDED, "foundations");
	assert.deepEqual(collapsed, { foundations: true, capabilities: false });
	const body = projectMapCardDescriptor(state, collapsed).body.join("\n");
	assert.ok(body.includes("▸ Foundations 1/1"));
	assert.equal(body.includes("repository-tooling"), false);
	assert.ok(body.includes("▾ Product capabilities 1/3"));
	assert.ok(body.includes("merchant-catalog"));
	assert.deepEqual(toggleProjectMapGroup(collapsed, "capabilities"), { foundations: true, capabilities: true });
});

test("omits the foundations group when no foundation is declared", () => {
	const body = projectMapCardDescriptor(ready(map({ foundations: [] }))).body.join("\n");
	assert.equal(body.includes("Foundations"), false);
	assert.ok(body.includes("▾ Product capabilities 1/3"));
});

test("reads a rendered group header back to its group and rejects content rows", () => {
	assert.equal(projectMapGroupFromHeader("│ ▾ Foundations 1/1            │"), "foundations");
	assert.equal(projectMapGroupFromHeader("│ ▸ Product capabilities 2/3  │"), "capabilities");
	assert.equal(projectMapGroupFromHeader("  ✓ repository-tooling"), undefined);
	assert.equal(projectMapGroupFromHeader("│ ✿ Project Map Example Shop · draft │"), undefined);
	assert.equal(projectMapGroupFromHeader("│ ▾ Foundations"), undefined);
});

test("says a capability declares no surface instead of rendering an empty list", () => {
	const body = projectMapCardDescriptor(ready(map())).body.join("\n");
	assert.ok(body.includes("shopping-cart · no surface declared"));
});

test("computes coverage from declared capabilities and counts only done ones", () => {
	const coverage = projectMapCoverage(map());
	const web = coverage.find((entry) => entry.surface === "web");
	assert.deepEqual(web, { surface: "web", declared: 2, done: 1 });
	const api = coverage.find((entry) => entry.surface === "api");
	assert.deepEqual(api, { surface: "api", declared: 1, done: 1 });
	const security = coverage.find((entry) => entry.surface === "security");
	assert.deepEqual(security, { surface: "security", declared: 0, done: 0 });
});

test("renders an undeclared surface as unknown and never as zero percent", () => {
	const body = projectMapCardDescriptor(ready(map())).body.join("\n");
	const coverageLine = body.split("\n").find((line) => line.includes("Security"));
	assert.ok(coverageLine, "expected a coverage line naming Security");
	assert.ok(coverageLine.includes("Security —"), `expected an unknown marker, got ${coverageLine}`);
	assert.equal(coverageLine.includes("Security 0%"), false);
});

test("renders a declared surface with its share, counts, and declaring capabilities", () => {
	const body = projectMapCardDescriptor(ready(map())).body.join("\n");
	assert.ok(body.includes("Web 50% (1/2):"), `expected the Web explanation, got ${body}`);
	assert.ok(body.includes("merchant-catalog ✓"), `expected the done declaring capability, got ${body}`);
	assert.ok(body.includes("checkout ✕"), `expected the blocked declaring capability, got ${body}`);
	assert.ok(body.includes("API 100% (1/1): merchant-catalog ✓"), `expected the API explanation, got ${body}`);
});

test("reports every surface of the frozen vocabulary exactly once", () => {
	const coverage = projectMapCoverage(map());
	assert.deepEqual(
		coverage.map((entry) => entry.surface),
		["productUx", "web", "api", "data", "security", "operations", "tests"],
	);
});

test("keeps the digest stable when the card does not change and moves when it does", () => {
	const base = projectMapCardDigest(ready(map()));
	assert.equal(projectMapCardDigest(ready(map())), base);
	assert.notEqual(projectMapCardDigest(ready(map()), { foundations: true, capabilities: false }), base, "a collapsed group changes the visible descriptor");
	assert.equal(projectMapCardDigest(ready(map()), PROJECT_MAP_EXPANDED), base);

	const restated = map({ capabilities: [...map().capabilities].reverse() });
	// The reader canonicalizes artifacts, so reordered rows are only reachable through a
	// hand-constructed state; the digest follows the render for every input.
	assert.notEqual(projectMapCardDigest(ready(restated)), base, "rendered row order must move the digest");

	const changed = map({ capabilities: [{ ...map().capabilities[0], state: "blocked" }, map().capabilities[1], map().capabilities[2]] });
	assert.notEqual(projectMapCardDigest(ready(changed)), base);
});

test("distinguishes the three card states in the digest", () => {
	const empty = projectMapCardState("/nonexistent", PROJECT_MAP_OVERLAY_UNAVAILABLE);
	withArtifact(JSON.stringify({ version: PROJECT_MAP_SCHEMA_V1, project: { id: "x", name: "" }, capabilities: [] }), (path) => {
		const invalid = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		const digests = new Set([projectMapCardDigest(empty), projectMapCardDigest(invalid), projectMapCardDigest(ready(map()))]);
		assert.equal(digests.size, 3);
	});
});

test("renders no overlay rows while the overlay is unavailable", () => {
	const descriptor = projectMapCardDescriptor(ready(map()));
	const body = descriptor.body.join("\n").toLowerCase();
	for (const word of ["claim", "lease", "heartbeat", "worktree", "session-42"]) {
		assert.equal(body.includes(word), false, `expected no ${word} in the card while the overlay is unavailable`);
	}
});

test("keeps every descriptor body line within 60 columns, even with long identifiers", () => {
	const long = map({
		foundations: [{ id: `foundation-${"x".repeat(80)}`, outcome: "Tooling is declared.", state: "done", evidence: [] }],
		capabilities: [{ ...map().capabilities[0], id: `capability-${"y".repeat(80)}`, surfaces: ["web"] }],
	});
	const descriptor = projectMapCardDescriptor(ready(long));
	// The title and subtitle are not pre-wrapped: the subtitle carries the project name and
	// renderCard clips it at render time, which the card suite covers at boundary widths.
	for (const line of descriptor.body) {
		assert.ok(line.length <= 60, `expected a body line under 60 columns, got ${line.length}: ${line}`);
	}
});

test("summarizes completed foundations and capabilities", () => {
	assert.equal(projectMapSummaryLine(map()), "1/1 foundations · 1/3 capabilities");
});

test("bounds long diagnostic messages like the ready body", () => {
	const state: ProjectMapCardState = {
		kind: "invalid",
		path: PROJECT_MAP_ARTIFACT_PATH,
		diagnostics: [{ code: "project-map/invalid-field", path: "$.project.name", message: "z".repeat(200), severity: "error" }],
		overlay: PROJECT_MAP_OVERLAY_UNAVAILABLE,
	};
	const descriptor = projectMapCardDescriptor(state);
	assert.ok(descriptor.body.length > 3, "a long message wraps into continuation lines");
	for (const line of descriptor.body) assert.ok(line.length <= 60, `expected a body line under 60 columns, got ${line.length}: ${line}`);
});

test("classifies an unreadable artifact as empty rather than throwing", () => {
	const directory = mkdtempSync(join(tmpdir(), "project-map-view-"));
	try {
		const path = join(directory, "project-map.json");
		mkdirSync(path);
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		assert.equal(state.kind, "empty");
		assert.doesNotThrow(() => projectMapCardDescriptor(state));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("digest follows the rendered descriptor rather than invalid codes or unrendered fields", () => {
	const invalid = (message: string): ProjectMapCardState => ({
		kind: "invalid",
		path: PROJECT_MAP_ARTIFACT_PATH,
		diagnostics: [{ code: "project-map/invalid-field", path: "$.project.name", message, severity: "error" }],
		overlay: PROJECT_MAP_OVERLAY_UNAVAILABLE,
	});
	assert.notEqual(projectMapCardDigest(invalid("Expected a project name.")), projectMapCardDigest(invalid("Project name cannot be blank.")));

	const base = projectMapCardDigest(ready(map()));
	assert.equal(projectMapCardDigest(ready(map({ project: { id: "another-id", name: "Example Shop" } }))), base);
});
