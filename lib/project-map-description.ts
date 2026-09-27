import { normalizeIdentifier } from "./shell-project-map-draft.ts";

// What a capability IS, in the project's own words.
//
// The map cannot answer that: `extractWorkUnits` copies the work unit's title into `outcome`,
// so a capability's `id` and its `outcome` are two renderings of one string and the Inspector
// has nothing to add. The description exists anyway — in the ODD document the work unit came
// from, as the indented body under its checkbox line — and the generator reads only that line
// and discards the body. This module reads the body back.
//
// It is deliberately more tolerant than the generator's own pattern. That pattern requires the
// line to end at the closing `**`, so a work unit carrying a parenthetical after it is
// invisible in the map with no omission at all; a reader that inherited the same blind spot
// could never explain the capabilities that did survive it.

/**
 * A work unit line: an indentation, a checkbox, a bolded label, and anything after it.
 * `(.+?)` stops at the first closing emphasis, so a label with emphasis inside it keeps its
 * head and the rest stays in the trailing group.
 */
const WORK_UNIT = /^(\s*)-\s\[([ xX])\]\s\*\*(.+?)\*\*(.*)$/;
/** The separator this project's documents use between a work-unit prefix and its title. */
const SEPARATOR = "—";
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
		const separator = label.indexOf(SEPARATOR);
		const title = (separator === -1 ? label : label.slice(separator + SEPARATOR.length)).trim();
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
