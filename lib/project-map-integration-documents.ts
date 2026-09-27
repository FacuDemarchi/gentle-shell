import { readSimpleConfigEntries } from "./shell-project-map-draft.ts";
import type { ProjectMapIntegrationCheck } from "./project-map-integration.ts";
import type { ProjectMapState } from "./shell-project-map-schema.ts";

/**
 * The document-facing half of integration readiness: what the feature documents say, and
 * what the project's own config declares.
 *
 * Everything here is a pure function over text a caller already read, so the module
 * performs no I/O. Drift between the map and a feature document is **reported and never
 * corrected**, in either direction: the map declares intent and the document declares
 * progress, and this module is not entitled to decide which one is right.
 */

/** Counts the ODD task checkboxes in a document, including nested ones. */
export function parseProjectMapTaskDocument(text: string): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const rawLine of text.split("\n")) {
		const match = /^\s*-\s*\[([ xX])\]/.exec(rawLine.replace(/\r$/, ""));
		if (match === null) continue;
		total += 1;
		if (match[1]!.toLowerCase() === "x") done += 1;
	}
	return { done, total };
}

export interface ProjectMapIntegrationTaskCheck {
	check: ProjectMapIntegrationCheck;
	reason?: string;
}

/**
 * Compares the capability's declared state against its feature document's checkboxes.
 *
 * A capability declared `done` whose document still has open tasks is a mismatch, and so
 * is a document whose every task is done while the map does not declare it done. A
 * capability in flight with some tasks done agrees, because that is exactly what in
 * flight looks like, and a document with no checkboxes never contradicts anything.
 */
export function checkProjectMapIntegrationTasks(options: {
	declaredState: ProjectMapState;
	/** How many feature documents the map declares for this capability. */
	declaredDocumentCount: number;
	/** The document that was read, or null when none could be. */
	document: { path: string; done: number; total: number } | null;
}): ProjectMapIntegrationTaskCheck {
	const document = options.document;
	if (document === null) {
		return options.declaredDocumentCount > 0
			? { check: "mismatched", reason: "the map declares a feature document that could not be read, so map and task state could not be reconciled" }
			: { check: "unverified", reason: "the map declares no feature document to reconcile against" };
	}
	if (document.total === 0) return { check: "verified" };
	if (options.declaredState === "done" && document.done < document.total) {
		return { check: "mismatched", reason: `the map declares done while ${document.path} reports only ${document.done} of ${document.total} tasks done` };
	}
	if (options.declaredState !== "done" && document.done === document.total) {
		return { check: "mismatched", reason: `${document.path} reports every task done while the map declares ${options.declaredState}` };
	}
	return { check: "verified" };
}

/**
 * The project's own verification requirement, taken from `openspec/config.yaml` rather
 * than added to the map, so the two cannot disagree. An absent, unreadable or blank
 * command declares nothing, and nothing is never read as a requirement.
 */
export function readProjectMapTestCommand(text: string | null): string | null {
	if (text === null) return null;
	const command = readSimpleConfigEntries(text).get("apply.test_command");
	return command === undefined || command.trim().length === 0 ? null : command;
}
