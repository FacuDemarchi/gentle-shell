import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildProjectMapHelpContent, ProjectMapHelpModal } from "../lib/project-map-help-modal.ts";

const theme = { fg: (_role: string, text: string) => text };
const capability = {
	id: "close-the-gate",
	outcome: "Close the gate",
	foundationRefs: [],
	dependsOn: [],
	contracts: [],
	featureDocs: ["odd/tasks/fp-1b-provisioning.md"],
	surfaces: [],
	state: "planned" as const,
};

function modal(description: string[] | null, rows = 40) {
	const results: string[] = [];
	const instance = new ProjectMapHelpModal(
		buildProjectMapHelpContent(capability, description === null ? null : { title: "Close the gate", lines: description }),
		(result) => results.push(result.type),
		theme,
		() => rows,
	);
	return { instance, results };
}

test("frames the answer and names the capability", () => {
	const { instance } = modal(["One line."]);
	const lines = instance.render(60);
	assert.ok(lines[0]!.startsWith("╭"), "the first line opens the frame");
	assert.ok(lines[lines.length - 1]!.startsWith("╰"), "the last line closes it");
	const body = lines.join("\n");
	assert.ok(lines[0]!.includes("close-the-gate"), "the frame carries the capability id");
	assert.ok(lines[0]!.includes("planned"), "the frame carries its state");
	assert.ok(body.includes("odd/tasks/fp-1b-provisioning.md"), "the document it came from is shown");
	assert.ok(body.includes("One line."), "the description is shown");
});

// The generator copies the work unit's title into `outcome`, so printing it would repeat the id
// in different words — exactly the noise this overlay exists to replace.
test("leaves out an outcome that only repeats the id, and keeps one that does not", () => {
	const repeated = new ProjectMapHelpModal(buildProjectMapHelpContent(capability, null), () => {}, theme).render(60).join("\n");
	assert.ok(!repeated.includes("Outcome:"), "a repeated outcome is left out");
	const distinct = new ProjectMapHelpModal(buildProjectMapHelpContent({ ...capability, outcome: "Whatever closes the pilot" }, null), () => {}, theme).render(60).join("\n");
	assert.ok(distinct.includes("Outcome: Whatever closes the pilot"), "an outcome that says something is kept");
});

test("wraps a long description line instead of truncating it", () => {
	const long = `Start ${"word ".repeat(40)}end`;
	const { instance } = modal([long]);
	const body = instance.render(60).join("\n");
	assert.ok(body.includes("end"), "the tail of a long line survives");
	assert.ok(!body.includes("…"), "a wrapped line is not truncated");
});

test("says plainly when the document declares no such work unit", () => {
	const { instance } = modal(null);
	assert.ok(instance.render(60).join("\n").includes("declares no work unit"));
});

test("says plainly when the work unit carries no body", () => {
	const { instance } = modal([]);
	assert.ok(instance.render(60).join("\n").includes("carries no body"));
});

test("closes on escape, enter and ctrl+c, and never twice", () => {
	for (const key of ["\u001b", "\r", "\u0003"]) {
		const { instance, results } = modal(["One line."]);
		instance.handleInput(key);
		instance.handleInput(key);
		assert.deepEqual(results, ["close"], `${JSON.stringify(key)} closes exactly once`);
	}
});

test("scrolls with the arrow and page keys", () => {
	const long = Array.from({ length: 40 }, (_, index) => `line ${index}`);
	const { instance } = modal(long, 12);
	const first = instance.render(60).join("\n");
	assert.ok(first.includes("line 0"), "the first render starts at the top");
	assert.ok(first.includes("↓ "), "and says how much is below it");
	assert.ok(!first.includes("↑ "), "with nothing above it");
	instance.handleInput("\u001b[B");
	assert.ok(instance.render(60).join("\n").includes("↑ 1 above"), "a down arrow moves the window by one line");
	instance.handleInput("\u001b[A");
	assert.ok(!instance.render(60).join("\n").includes("↑ "), "an up arrow moves it back to the top");
	instance.handleInput("\u001b[6~");
	const paged = instance.render(60).join("\n");
	assert.ok(paged.includes("line 1"), "a page down lands further in");
	assert.ok(!paged.includes("line 0"), "and past the first line");
});

test("never exceeds the terminal's row budget", () => {
	const long = Array.from({ length: 200 }, (_, index) => `line ${index}`);
	for (const rows of [12, 20, 40]) {
		const { instance } = modal(long, rows);
		assert.ok(instance.render(60).length <= Math.max(12, Math.floor(rows * 0.85)), `rows=${rows} stayed inside its budget`);
	}
});

test("every rendered line fits the requested width", () => {
	for (const width of [40, 60, 100]) {
		const { instance } = modal([`A description that is longer than any of these widths ${"x".repeat(300)}`]);
		for (const line of instance.render(width)) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} exceeds ${width}`);
	}
});

test("an empty capability renders its facts and no invented description", () => {
	const content = buildProjectMapHelpContent({ ...capability, featureDocs: [] }, null);
	const instance = new ProjectMapHelpModal(content, () => {}, theme);
	const body = instance.render(60).join("\n");
	assert.ok(body.includes("Documents: none"), "an empty list is stated, never omitted");
	assert.ok(body.includes("declares no document"), "no document is named as such");
});
