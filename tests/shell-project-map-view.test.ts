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
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	PROJECT_MAP_STATE_GLYPH,
	projectMapCardDescriptor,
	projectMapCardDigest,
	projectMapCardState,
	projectMapCoverage,
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

test("renders one row per foundation and per capability with its glyph", () => {
	const descriptor = projectMapCardDescriptor(ready(map()));
	const body = descriptor.body.join("\n");
	assert.ok(body.includes("Foundations"));
	assert.ok(body.includes("Product capabilities"));
	assert.ok(body.includes(`✓ repository-tooling`));
	assert.ok(body.includes(`✓ merchant-catalog · Web · API`));
	assert.ok(body.includes(`✕ checkout · Web`));
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

test("renders a declared surface with its share and its counts", () => {
	const body = projectMapCardDescriptor(ready(map())).body.join("\n");
	assert.ok(body.includes("Web 50% (1/2)"), `expected Web 50% (1/2), got ${body}`);
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

	const restated = map({ capabilities: [...map().capabilities].reverse() });
	assert.equal(projectMapCardDigest(ready(restated)), base, "canonical order must not move the digest");

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

test("never renders a line longer than the narrowest card width", () => {
	const descriptor = projectMapCardDescriptor(ready(map()));
	for (const line of [descriptor.title, descriptor.subtitle, ...descriptor.body]) {
		assert.ok(line.length <= 60, `expected a line under 60 columns, got ${line.length}: ${line}`);
	}
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
