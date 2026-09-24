import {
	PROJECT_MAP_ARTIFACT_PATH,
	PROJECT_MAP_SURFACES,
	readProjectMapFile,
	type ProjectMapDiagnostic,
	type ProjectMapState,
	type ProjectMapSurface,
	type ProjectMapV1,
} from "./shell-project-map-schema.ts";

// The Project Map card, as pure data. Nothing here imports the TUI runtime, so the
// classification, the coverage arithmetic, and the rendered lines stay verifiable without
// the SDK. `lib/shell-project-map-card.ts` composes this descriptor through `renderCard`,
// and that composition is the only part that needs the runtime.

export const PROJECT_MAP_STATE_GLYPH: Record<ProjectMapState, string> = {
	done: "✓",
	active: "◉",
	review: "◉",
	ready: "○",
	blocked: "✕",
	planned: "○",
};

const SURFACE_LABEL: Record<ProjectMapSurface, string> = {
	productUx: "Product/UX",
	web: "Web",
	api: "API",
	data: "Data",
	security: "Security",
	operations: "Ops",
	tests: "Tests",
};

const MAX_DIAGNOSTICS = 3;
const COVERAGE_BUDGET = 44;

/**
 * Runtime coordination state: active claims, leases, heartbeats, session bindings, and
 * worktrees. It belongs to the shared cross-worktree store, which does not exist yet, so
 * the only honest value is "unavailable" and the card renders no overlay rows from it.
 */
export interface ProjectMapOverlay {
	readonly unavailable: true;
}

export const PROJECT_MAP_OVERLAY_UNAVAILABLE: ProjectMapOverlay = { unavailable: true };

export interface ProjectMapCoverageEntry {
	surface: ProjectMapSurface;
	declared: number;
	done: number;
}

export type ProjectMapCardState =
	| { kind: "empty"; path: string; overlay: ProjectMapOverlay }
	| { kind: "invalid"; path: string; diagnostics: ProjectMapDiagnostic[]; overlay: ProjectMapOverlay }
	| { kind: "ready"; path: string; map: ProjectMapV1; coverage: ProjectMapCoverageEntry[]; overlay: ProjectMapOverlay };

export interface ProjectMapCardDescriptor {
	title: string;
	subtitle: string;
	body: string[];
	tone: "info" | "success" | "warning" | "error";
}

/**
 * Per-surface coverage. `declared` counts the capabilities that state the surface and
 * `done` those that also reached `done`. A surface nothing declares stays at zero of zero,
 * which the card renders as unknown: an undeclared surface is an absence of evidence, not
 * evidence of absence.
 */
export function projectMapCoverage(map: ProjectMapV1): ProjectMapCoverageEntry[] {
	return PROJECT_MAP_SURFACES.map((surface) => {
		const declaring = map.capabilities.filter((capability) => capability.surfaces.includes(surface));
		return { surface, declared: declaring.length, done: declaring.filter((capability) => capability.state === "done").length };
	});
}

export function projectMapCardState(path: string, overlay: ProjectMapOverlay = PROJECT_MAP_OVERLAY_UNAVAILABLE): ProjectMapCardState {
	const read = readProjectMapFile(path);
	if (read.map === null) {
		// A missing or unreadable artifact leaves the card empty. An artifact that was read but
		// rejected, including malformed JSON, remains invalid so its diagnostic stays visible.
		const unreadable = read.diagnostics.length > 0 && read.diagnostics.every((diagnostic) => diagnostic.code === "project-map/unreadable-artifact");
		if (unreadable) return { kind: "empty", path, overlay };
		return { kind: "invalid", path, diagnostics: read.diagnostics, overlay };
	}
	return { kind: "ready", path, map: read.map, coverage: projectMapCoverage(read.map), overlay };
}

/**
 * Wraps the coverage parts into lines that already fit a narrow card. The card renderer
 * would wrap them anyway, but a pre-wrapped line keeps the descriptor honest about its own
 * width and makes the bound testable without the runtime.
 */
function coverageLines(coverage: ProjectMapCoverageEntry[]): string[] {
	const parts = coverage.map((entry) => {
		const label = SURFACE_LABEL[entry.surface];
		if (entry.declared === 0) return `${label} —`;
		const share = Math.round((entry.done / entry.declared) * 100);
		return `${label} ${share}% (${entry.done}/${entry.declared})`;
	});
	const lines: string[] = [];
	let current = "";
	for (const part of parts) {
		const candidate = current.length === 0 ? part : `${current} · ${part}`;
		if (candidate.length > COVERAGE_BUDGET && current.length > 0) {
			lines.push(`  ${current}`);
			current = part;
			continue;
		}
		current = candidate;
	}
	if (current.length > 0) lines.push(`  ${current}`);
	return lines;
}

export function projectMapCardDescriptor(state: ProjectMapCardState): ProjectMapCardDescriptor {
	if (state.kind === "empty") {
		return {
			title: "Project Map",
			subtitle: "no map",
			tone: "info",
			body: [`No Project Map at ${PROJECT_MAP_ARTIFACT_PATH}.`, "Run /gentle:project-map draft to generate one."],
		};
	}
	if (state.kind === "invalid") {
		return {
			title: "Project Map",
			subtitle: "invalid",
			tone: "error",
			body: [
				"The Project Map artifact is not valid:",
				...state.diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => `  ${diagnostic.path}: ${diagnostic.message}`),
				"Run /gentle:project-map status for the full report.",
			],
		};
	}
	const { map } = state;
	const body: string[] = [];
	if (map.foundations.length > 0) {
		body.push("Foundations", ...map.foundations.map((foundation) => `  ${PROJECT_MAP_STATE_GLYPH[foundation.state]} ${foundation.id}`));
	}
	body.push(
		"Product capabilities",
		...map.capabilities.map((capability) => {
			const surfaces = capability.surfaces.length === 0 ? "no surface declared" : capability.surfaces.map((surface) => SURFACE_LABEL[surface]).join(" · ");
			return `  ${PROJECT_MAP_STATE_GLYPH[capability.state]} ${capability.id} · ${surfaces}`;
		}),
		"Coverage",
		...coverageLines(state.coverage),
	);
	return {
		title: "Project Map",
		subtitle: `${map.project.name} · ${map.approval.state}`,
		tone: map.approval.state === "approved" ? "success" : "warning",
		body,
	};
}

/**
 * A stable digest of the descriptor the card renders. Width and theme are already part of the
 * layout's section cache key, so this follows descriptor changes without reinterpreting state.
 */
export function projectMapCardDigest(state: ProjectMapCardState): string {
	const descriptor = projectMapCardDescriptor(state);
	return `project-map/${state.kind}:${JSON.stringify({ title: descriptor.title, subtitle: descriptor.subtitle, tone: descriptor.tone, body: descriptor.body })}`;
}
