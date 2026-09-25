import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCard } from "../lib/shell-card.ts";
import {
	PROJECT_MAP_EXPANDED,
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	projectMapCardDescriptor,
	projectMapCardState,
	toggleProjectMapGroup,
	type ProjectMapCollapseState,
	type ProjectMapGroup,
} from "../lib/shell-project-map-view.ts";
import {
	PROJECT_MAP_RAIL_KEY,
	projectMapCardBottom,
	projectMapCardRail,
	projectMapOpenPiHostOnce,
	renderProjectMapCard,
	type ProjectMapCardSession,
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

function session(initial: ProjectMapCollapseState = PROJECT_MAP_EXPANDED): ProjectMapCardSession & { toggled: ProjectMapGroup[]; selected: Array<string | undefined> } {
	let current = initial;
	let selection: string | undefined;
	const toggled: ProjectMapGroup[] = [];
	const selected: Array<string | undefined> = [];
	return {
		collapse: () => current,
		selection: () => selection,
		toggle(group) {
			toggled.push(group);
			current = toggleProjectMapGroup(current, group);
		},
		select(id) {
			selection = id;
			selected.push(id);
		},
		toggled,
		selected,
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
		const rail = projectMapCardRail(path, theme, session());
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

test("memoizes the host probe and shares one readiness decision between body and digest", () => {
	let probes = 0;
	assert.deepEqual(projectMapOpenPiHostOnce(() => { probes += 1; return { available: true, version: "tmux test" }; }), { available: true, version: "tmux test" });
	assert.equal(projectMapOpenPiHostOnce(() => { probes += 1; return { available: false, version: null }; }).available, true);
	assert.equal(probes, 1);
	withArtifact(JSON.stringify(map()), (path) => {
		const current = session();
		current.select("capability-with-an-unbreakable-identifier");
		let decisions = 0;
		const rail = projectMapCardRail(path, theme, current, undefined, undefined, () => ({ permitted: ++decisions === 1, diagnostics: [] }));
		assert.match(rail.render(80).join("\n"), /\[Open Pi\]/);
		assert.match(rail.digest!(), /\[Open Pi\]/);
		assert.equal(decisions, 1, "body and digest reuse the same injected decision");
	});
});

test("the rail is expanded while the bottom card is one collapsed body line", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const rail = projectMapCardRail(path, theme, session());
		const bottom = projectMapCardBottom(path, theme);
		assert.equal(PROJECT_MAP_RAIL_KEY, "project-map");
		assert.ok(rail.render(48).length > 3);
		assert.equal(bottom.render(48).length, 3);
	});
});

test("the rail reads session collapse state and its digest follows a toggle", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const current = session({ foundations: true, capabilities: false });
		const rail = projectMapCardRail(path, theme, current);
		assert.equal(rail.render(80).join("\n").includes("repository-tooling"), false);
		const before = rail.digest!();
		current.toggle("capabilities");
		assert.notEqual(rail.digest!(), before);
	});
});

test("a click on a group header toggles only that group", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const current = session();
		const rail = projectMapCardRail(path, theme, current);
		const lines = rail.render(80);
		const header = lines.findIndex((line) => line.includes("Foundations"));
		const row = lines.findIndex((line) => line.includes("repository-tooling"));
		assert.deepEqual(rail.handleMouse?.({ type: "click", button: "left", x: 2, y: header, screenX: 2, screenY: header, width: 80, height: lines.length, shift: false, alt: false, ctrl: false }), { handled: true, render: true });
		assert.deepEqual(current.toggled, ["foundations"]);
		assert.equal(rail.handleMouse?.({ type: "click", button: "left", x: 2, y: row, screenX: 2, screenY: row, width: 80, height: lines.length, shift: false, alt: false, ctrl: false }), undefined);
		assert.equal(rail.handleMouse?.({ type: "press", button: "left", x: 2, y: header, screenX: 2, screenY: header, width: 80, height: lines.length, shift: false, alt: false, ctrl: false }), undefined);
		assert.equal(rail.handleMouse?.({ type: "click", button: "left", x: 2, y: lines.length + 1, screenX: 2, screenY: lines.length + 1, width: 80, height: lines.length, shift: false, alt: false, ctrl: false }), undefined);
		assert.deepEqual(current.toggled, ["foundations"]);
	});
});

test("capability clicks select, clear, and reveal only the selected row", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const current = session();
		const revealed: number[] = [];
		const rail = projectMapCardRail(path, theme, current, undefined, (line) => revealed.push(line));
		const lines = rail.render(20);
		const row = lines.findIndex((line) => line.includes("capability-with"));
		const click = () => rail.handleMouse?.({ type: "click", button: "left", x: 2, y: row, screenX: 2, screenY: row, width: 20, height: lines.length, shift: false, alt: false, ctrl: false });
		assert.deepEqual(click(), { handled: true, render: true });
		assert.deepEqual(current.selected, ["capability-with-an-unbreakable-identifier"]);
		const selectedRow = rail.render(20).findIndex((line) => line.includes("▸ ✓"));
		assert.deepEqual(revealed, [selectedRow], "reveal receives the rendered selected-row line");
		assert.deepEqual(click(), { handled: true, render: true });
		assert.deepEqual(current.selected, ["capability-with-an-unbreakable-identifier", undefined]);
		assert.deepEqual(revealed, [selectedRow], "clearing selection has no selected row to reveal");
		assert.equal(rail.handleMouse?.({ type: "click", button: "left", x: 2, y: lines.length - 1, screenX: 2, screenY: lines.length - 1, width: 20, height: lines.length, shift: false, alt: false, ctrl: false }), undefined);
	});
});

test("a selection change made outside the rail reveals on the next render", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const current = session();
		const revealed: number[] = [];
		const rail = projectMapCardRail(path, theme, current, undefined, (line) => revealed.push(line));
		rail.render(20);
		assert.deepEqual(revealed, [], "the first render reveals nothing");
		current.select("capability-with-an-unbreakable-identifier");
		const selectedRow = rail.render(20).findIndex((line) => line.includes("▸ ✓"));
		assert.deepEqual(revealed, [selectedRow], "the render after an external selection reveals its row");
		rail.render(20);
		assert.deepEqual(revealed, [selectedRow], "an unchanged selection does not reveal again");
	});
});

test("every rendered line of a pre-bounded capability row selects it", () => {
	const base = map();
	const capability = (base.capabilities as Array<Record<string, unknown>>)[0]!;
	const longId = `capability-${"x".repeat(53)}`;
	assert.equal(longId.length, 64);
	withArtifact(JSON.stringify(map({ capabilities: [{ ...capability, id: longId }] })), (path) => {
		for (const offset of [0, 1, 2, 3]) {
			const probe = session();
			const rail = projectMapCardRail(path, theme, probe);
			const lines = rail.render(46);
			const tail = lines.findIndex((line) => line.includes("· Web"));
			assert.ok(tail > 0, "the capability row renders its surfaces on its last line");
			const y = tail - offset;
			const result = rail.handleMouse?.({ type: "click", button: "left", x: 2, y, screenX: 2, screenY: y, width: 46, height: lines.length, shift: false, alt: false, ctrl: false });
			assert.deepEqual(result, { handled: true, render: true }, `rendered line ${y} of the row is a target`);
			assert.deepEqual(probe.selected, [longId], `rendered line ${y} selects the row's capability`);
		}
	});
});

test("a project named like a group does not make the title clickable", () => {
	withArtifact(JSON.stringify(map({ project: { id: "foundations", name: "▾ Foundations 1/1" } })), (path) => {
		const current = session();
		const rail = projectMapCardRail(path, theme, current);
		const lines = rail.render(80);
		assert.ok(lines[0]?.includes("Foundations"), "the subtitle carries the project name");
		assert.equal(rail.handleMouse?.({ type: "click", button: "left", x: 2, y: 0, screenX: 2, screenY: 0, width: 80, height: lines.length, shift: false, alt: false, ctrl: false }), undefined);
		assert.deepEqual(current.toggled, []);
	});
});

test("an invalid artifact diagnostic never becomes a group click target", () => {
	withArtifact(JSON.stringify({ version: "▾ Foundations 1/1" }), (path) => {
		const current = session();
		const rail = projectMapCardRail(path, theme, current);
		const lines = rail.render(80);
		const row = lines.findIndex((line) => line.includes("▾ Foundations 1/1"));
		assert.ok(row > 0, `the diagnostic renders the injected text: ${lines.join("\\n")}`);
		assert.equal(rail.handleMouse?.({ type: "click", button: "left", x: 2, y: row, screenX: 2, screenY: row, width: 80, height: lines.length, shift: false, alt: false, ctrl: false }), undefined);
		assert.deepEqual(current.toggled, []);
	});
});

test("the bottom uses the summary line and stays non-interactive", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const bottom = projectMapCardBottom(path, theme);
		assert.match(bottom.render(80).join("\n"), /1\/1 foundations · 1\/1 capabilities/);
		assert.equal(bottom.handleMouse, undefined);
	});
});

test("the bottom renders one descriptor line for empty and invalid artifacts", () => {
	withArtifact(null, (empty) => {
		const bottom = projectMapCardBottom(empty, theme);
		const lines = bottom.render(80);
		assert.equal(lines.length, 3);
		assert.ok(lines[1]?.includes("No Project Map at openspec/project-map.json"));
		assert.ok(lines[1]?.includes("…"), "the collapsed body marks omitted descriptor lines");
		assert.equal(bottom.handleMouse, undefined);
	});
	withArtifact(JSON.stringify({ version: "gentle-shell.project-map/v1", project: { id: "example-shop", name: "" }, capabilities: [] }), (invalid) => {
		const bottom = projectMapCardBottom(invalid, theme);
		const lines = bottom.render(80);
		assert.equal(lines.length, 3);
		assert.ok(lines[1]?.includes("The Project Map artifact is not valid:"));
		assert.equal(lines[1]?.includes("$.project.name"), false);
		assert.equal(bottom.handleMouse, undefined);
	});
});

test("the rail shows the collapse hint when it fits", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		assert.match(projectMapCardRail(path, theme, session(), "alt+m").render(80)[0], /alt\+m/);
	});
});

test("the unavailable overlay contributes no rendered rows", () => {
	withArtifact(JSON.stringify(map()), (path) => {
		const lines = renderProjectMapCard(path, theme, 48, true).join("\n").toLowerCase();
		for (const term of ["claim", "lease", "heartbeat", "worktree", "session"]) assert.equal(lines.includes(term), false);
	});
});
