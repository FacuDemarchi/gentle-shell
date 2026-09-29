import { normalizeIdentifier } from "./shell-project-map-draft.ts";

// What a capability IS, in the project's own words.
//
// The map cannot answer that: `extractWorkUnits` preserves the work unit's bold label in
// `outcome` — up to the first closing `**`, which is the boundary this module's own pattern
// shares — while the description lives in the indented body under that checkbox line. The
// generator reads only the line and discards the body; this module reads the body back.
//
// The reader deliberately remains more tolerant than the generator about indentation. It can
// explain any work unit in a document, including a nested one, while the generator keeps nested
// checkboxes out of the map's top-level capability set.

/**
 * A work unit line: an indentation, a checkbox, a bolded label, and anything after it.
 * `(.+?)` stops at the first closing emphasis, so a label with emphasis inside it keeps its
 * head and the rest stays in the trailing group.
 */
const WORK_UNIT = /^(\s*)-\s+\[([ xX~])\]\s*\*\*(.+?)\*\*(.*)$/;
/** The separator this project's documents use between a work-unit prefix and its title. */
const SEPARATOR = "—";

/** The prefix and title the document wrote inside a bold work-unit label. */
export interface ProjectMapWorkUnitLabel {
	head: string;
	title: string;
}

/**
 * Splits a bold work-unit label at its first separator. The head retains the separator and any
 * following whitespace so a translated title can preserve the functional-point code exactly.
 */
export function splitWorkUnitLabel(label: string): ProjectMapWorkUnitLabel {
	const separator = label.indexOf(SEPARATOR);
	if (separator === -1) return { head: "", title: label.trim() };
	let headEnd = separator + SEPARATOR.length;
	while (/\s/.test(label[headEnd] ?? "")) headEnd += 1;
	return { head: label.slice(0, headEnd), title: label.slice(headEnd).trim() };
}
/** A list marker at the start of a body line, which the reader drops. */
const BULLET = /^(?:[-*+]|\d+[.)])\s+/;

export interface ProjectMapDescription {
	/** The work unit's title, exactly as the document wrote it after the separator. */
	title: string;
	/** The body under the work unit, one entry per line, with its marker removed. */
	lines: string[];
}

/**
 * The body of the work unit whose title normalizes to `capabilityId`, or `null` when the
 * document declares no such work unit. A work unit with no body answers with an empty list
 * rather than `null`, because "this document says nothing more" and "this document does not
 * declare it" are different answers.
 */
export function readCapabilityDescription(documentText: string, capabilityId: string): ProjectMapDescription | null {
	if (capabilityId.trim().length === 0) return null;
	const lines = documentText.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const match = WORK_UNIT.exec(lines[index]!.replace(/\r$/, ""));
		if (match === null) continue;
		const label = match[3]!.trim();
		const { title } = splitWorkUnitLabel(label);
		if (normalizeIdentifier(title) !== capabilityId) continue;
		return { title, lines: readBody(lines, index + 1, match[1]!.length) };
	}
	return null;
}

/**
 * The body of a work unit: every following line indented further than the work unit itself.
 * A blank line inside the body is skipped rather than treated as an end, so a body split into
 * paragraphs stays one description; the first line that is not indented ends it, which is what
 * makes the next work unit, a heading and the prose after the list all stop it.
 */
function readBody(lines: string[], start: number, indentation: number): string[] {
	const body: string[] = [];
	for (let index = start; index < lines.length; index += 1) {
		const raw = lines[index]!.replace(/\r$/, "");
		if (raw.trim().length === 0) continue;
		if (raw.length - raw.trimStart().length <= indentation) break;
		const text = raw.trim().replace(BULLET, "").replace(/\s+/g, " ").trim();
		if (text.length > 0) body.push(text);
	}
	return body;
}
