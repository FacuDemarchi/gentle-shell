import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCard } from "../lib/shell-card.ts";
import {
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	projectMapCardDescriptor,
	projectMapCardState,
} from "../lib/shell-project-map-view.ts";
import {
	PROJECT_MAP_RAIL_KEY,
	projectMapCardBottom,
	projectMapCardRail,
	renderProjectMapCard,
} from "../lib/shell-project-map-card.ts";

const theme = { fg: (_color: string, text: string) => text };

function map(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: "gentle-shell.project-map/v1",
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "draft" },
		foundations: [{ id: "repository-tooling", outcome: "Tooling is declared.", state: "done" }],
		capabilities: [{ id: "capability-with-an-unbreakable-identifier", outcome: "A deliberately long diagnostic-capable outcome.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "done" }],
		...overrides,
	};
}

function withArtifact(text: string | null, run: (path: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), "project-map-card-"));
	try {
		const path = join(directory, "project-map.json");
		if (text !== null) writeFileSync(path, text, "utf8");
		run(path);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("composes the ready descriptor through renderCard", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const state = projectMapCardState(path, PROJECT_MAP_OVERLAY_UNAVAILABLE);
		const descriptor = projectMapCardDescriptor(state);
		const actual = renderProjectMapCard(path, theme, 48, true);
		assert.deepEqual(actual, renderCard(descriptor, theme, 48, { expanded: true }));
		assert.ok(actual.join("\n").includes(descriptor.title));
		assert.ok(actual.join("\n").includes(descriptor.subtitle));
		assert.equal(descriptor.tone, "warning");
		assert.ok(actual.join("\n").includes("capability-with-an-unbreakable-identifier"));
	});
});

test("renders empty and invalid artifacts distinctly without throwing", () => {
	withArtifact(null, (empty) => {
		withArtifact(JSON.stringify({ version: "gentle-shell.project-map/v1", project: { id: "example-shop", name: "" }, capabilities: [] }), (invalid) => {
			const emptyLines = renderProjectMapCard(empty, theme, 48, true);
			const invalidLines = renderProjectMapCard(invalid, theme, 48, true);
			assert.doesNotThrow(() => emptyLines);
			assert.doesNotThrow(() => invalidLines);
			assert.notDeepEqual(emptyLines, invalidLines);
			assert.match(emptyLines.join("\n"), /no map/);
			assert.match(invalidLines.join("\n"), /invalid/);
		});
	});
});

test("clips every card line to the requested boundary width", () => {
	const longIdentifier = `capability-${"x".repeat(280)}`;
	withArtifact(JSON.stringify(map({
		project: { id: "example-shop", name: "p".repeat(300) },
		capabilities: [{ id: longIdentifier, outcome: "A deliberately long outcome.", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "done" }],
	})), (path) => {
		for (const width of [1, 12]) {
			for (const expanded of [true, false]) {
				// renderCard enforces clipping here; shell-card.test.ts verifies its boundary behavior.
				for (const line of renderProjectMapCard(path, theme, width, expanded)) {
					assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} exceeds ${width}: ${line}`);
				}
			}
		}
	});
});

test("rail digest follows rendered diagnostics but ignores unrendered map fields", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const rail = projectMapCardRail(path, theme);
		const before = rail.digest!();
		writeFileSync(path, JSON.stringify(map({ project: { id: "changed-id", name: "Example Shop" } })), "utf8");
		assert.equal(rail.digest!(), before);
		writeFileSync(path, JSON.stringify({ version: "unsupported-one" }), "utf8");
		const firstInvalid = rail.digest!();
		const firstMessage = projectMapCardDescriptor(projectMapCardState(path)).body.join("\n");
		writeFileSync(path, JSON.stringify({ version: "unsupported-two" }), "utf8");
		const secondMessage = projectMapCardDescriptor(projectMapCardState(path)).body.join("\n");
		assert.notEqual(secondMessage, firstMessage, "the invalid diagnostics differ in their rendered message");
		assert.notEqual(rail.digest!(), firstInvalid);
	});
});

test("the rail is expanded while the bottom card is one collapsed body line", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const rail = projectMapCardRail(path, theme);
		const bottom = projectMapCardBottom(path, theme);
		assert.equal(PROJECT_MAP_RAIL_KEY, "project-map");
		assert.ok(rail.render(48).length > 3);
		assert.equal(bottom.render(48).length, 3);
	});
});

test("the unavailable overlay contributes no rendered rows", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const lines = renderProjectMapCard(path, theme, 48, true).join("\n").toLowerCase();
		for (const term of ["claim", "lease", "heartbeat", "worktree", "session"]) assert.equal(lines.includes(term), false);
	});
});
