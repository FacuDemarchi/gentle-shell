import {
	PROJECT_MAP_ARTIFACT_PATH,
	PROJECT_MAP_SURFACES,
	readProjectMapFile,
	type ProjectMapCapabilityV1,
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

export const PROJECT_MAP_GROUPS = ["foundations", "capabilities"] as const;
export type ProjectMapGroup = (typeof PROJECT_MAP_GROUPS)[number];

/** Also the click target text: the card reads a rendered header back with the same label. */
export const PROJECT_MAP_GROUP_LABEL: Record<ProjectMapGroup, string> = {
	foundations: "Foundations",
	capabilities: "Product capabilities",
};

const GROUP_HEADER = /[▾▸] (Foundations|Product capabilities) \d+\/\d+/;

/**
 * Reads a rendered group header back to the group it names. The header format lives here, next
 * to the code that writes it, so a click target cannot drift from the rendered text; content
 * rows cannot match because capability and foundation identifiers are lowercase kebab-case.
 */
export function projectMapGroupFromHeader(line: string): ProjectMapGroup | undefined {
	const match = GROUP_HEADER.exec(line);
	if (match === null) return undefined;
	return PROJECT_MAP_GROUPS.find((group) => PROJECT_MAP_GROUP_LABEL[group] === match[1]);
}

/** `true` hides the rows while retaining the group header. */
export interface ProjectMapCollapseState {
	foundations: boolean;
	capabilities: boolean;
}

export const PROJECT_MAP_EXPANDED: ProjectMapCollapseState = { foundations: false, capabilities: false };

/** Return a new state so session owners can retain or replace it safely. */
export function toggleProjectMapGroup(collapse: ProjectMapCollapseState, group: ProjectMapGroup): ProjectMapCollapseState {
	return { ...collapse, [group]: !collapse[group] };
}

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

export type ProjectMapSelection = string | undefined;

export interface ProjectMapCardBody {
	lines: string[];
	headers: Array<{ line: number; group: ProjectMapGroup }>;
	selected?: number;
	/** Capability targets share the same body indices as the rendered descriptor. */
	capabilities: Array<{ line: number; id: string; height: number }>;
}

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
function boundedLines(text: string, budget = CARD_BODY_BUDGET): string[] {
	if (text.length <= budget) return [text];
	// A continuation keeps the indent of the line it continues. Without it a wrapped body
	// line lands at column 0 and reads as a new row of its own, which is what made a wrapped
	// coverage line look like three unrelated lines.
	const indent = /^\s*/.exec(text)?.[0] ?? "";
	const room = Math.max(8, budget - indent.length);
	const lines: string[] = [];
	let current = "";
	const flush = (): void => {
		if (current.length === 0) return;
		lines.push(`${indent}${current}`);
		current = "";
	};
	for (const word of text.trimStart().split(/\s+/)) {
		// A token with no spaces in it — an identifier, a path — is cut hard rather than left to
		// overrun the budget, because every line this returns is drawn as one card line.
		let rest = word;
		while (rest.length > room) {
			flush();
			lines.push(`${indent}${rest.slice(0, room)}`);
			rest = rest.slice(room);
		}
		const candidate = current.length === 0 ? rest : `${current} ${rest}`;
		if (candidate.length > room) {
			flush();
			current = rest;
			continue;
		}
		current = candidate;
	}
	flush();
	return lines;
}

function coverageLines(map: ProjectMapV1, coverage: ProjectMapCoverageEntry[], innerWidth: number): string[] {
	const parts = coverage.map((entry) => {
		const label = SURFACE_LABEL[entry.surface];
		if (entry.declared === 0) return `${label} —`;
		const share = Math.round((entry.done / entry.declared) * 100);
		const capabilities = map.capabilities
			.filter((capability) => capability.surfaces.includes(entry.surface))
			.map((capability) => `${capability.id} ${PROJECT_MAP_STATE_GLYPH[capability.state]}`)
			.join(", ");
		return `${label} ${share}% (${entry.done}/${entry.declared}): ${capabilities}`;
	});
	// Packed to the width the card actually has, never to a fixed guess: a line built past the
	// inner width is clipped mid-content, which loses the tail instead of moving it down.
	const budget = Math.max(16, innerWidth - 2);
	const lines: string[] = [];
	let current = "";
	for (const part of parts) {
		const candidate = current.length === 0 ? part : `${current} · ${part}`;
		if (candidate.length > budget && current.length > 0) {
			lines.push(...boundedLines(`  ${current}`, innerWidth));
			current = part;
			continue;
		}
		current = candidate;
	}
	if (current.length > 0) lines.push(...boundedLines(`  ${current}`, innerWidth));
	return lines;
}

function completed(items: { state: ProjectMapState }[]): number {
	return items.filter((item) => item.state === "done").length;
}

export function projectMapSummaryLine(map: ProjectMapV1): string {
	return `${completed(map.foundations)}/${map.foundations.length} foundations · ${completed(map.capabilities)}/${map.capabilities.length} capabilities`;
}

interface ProjectMapOpenPiReadinessView {
	permitted: boolean;
	diagnostics: Array<{ code: string }>;
}

function inspectorLines(map: ProjectMapV1, selection: string, openPiReadiness?: ProjectMapOpenPiReadinessView): string[] {
	const capability = map.capabilities.find((entry) => entry.id === selection);
	if (capability === undefined) return [];
	const foundations = new Map(map.foundations.map((entry) => [entry.id, entry]));
	const capabilities = new Map(map.capabilities.map((entry) => [entry.id, entry]));
	const listed = <T>(items: T[], render: (item: T) => string): string => items.length === 0 ? "none" : items.map(render).join(", ");
	const staticBlockers: string[] = [];
	if (capability.state === "blocked") staticBlockers.push("state is blocked");
	for (const id of capability.foundationRefs) {
		const foundation = foundations.get(id)!;
		if (foundation.state !== "done") staticBlockers.push(`foundation ${id} ${PROJECT_MAP_STATE_GLYPH[foundation.state]}`);
	}
	for (const id of capability.dependsOn) {
		const dependency = capabilities.get(id)!;
		if (dependency.state !== "done") staticBlockers.push(`dependency ${id} ${PROJECT_MAP_STATE_GLYPH[dependency.state]}`);
	}
	return [
		"Inspector",
		`${PROJECT_MAP_STATE_GLYPH[capability.state]} ${capability.id}`,
		`Outcome: ${capability.outcome}`,
		`Surfaces: ${listed(capability.surfaces, (surface) => SURFACE_LABEL[surface])}`,
		`Foundations: ${listed(capability.foundationRefs, (id) => `${id} ${PROJECT_MAP_STATE_GLYPH[foundations.get(id)!.state]}`)}`,
		`Dependencies: ${listed(capability.dependsOn, (id) => `${id} ${PROJECT_MAP_STATE_GLYPH[capabilities.get(id)!.state]}`)}`,
		`Contracts: ${listed(capability.contracts, (entry) => entry)}`,
		`Feature documents: ${listed(capability.featureDocs, (entry) => entry)}`,
		`Static blockers: ${listed(staticBlockers, (entry) => entry)}`,
		"Runtime overlay: not wired yet.",
		...(openPiReadiness?.permitted === true ? ["[Open Pi]"] : []),
	];
}

/**
 * The width a body line is built to fit, when the caller does not know it yet.
 *
 * A capability row is truncated to this budget rather than wrapped: a card that lists
 * capabilities is a list, and a row that spills onto a second line loses its glyph and its
 * indent, so it reads as two unrelated lines. `renderCard` wraps anything longer than the real
 * inner width, which is why the real width is threaded down from the render path.
 */
const CARD_BODY_BUDGET = 60;

/**
 * Keeps both ends of an identifier visible: a capability id is read from either end, and an
 * end-truncated one keeps only the half nobody recognises. The Inspector carries it in full.
 */
function middleTruncate(text: string, room: number): string {
	if (room <= 0) return "";
	if (text.length <= room) return text;
	const head = Math.ceil((room - 1) / 2);
	const tail = room - 1 - head;
	return `${text.slice(0, head)}…${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

/**
 * One capability row, built to fit the inner width exactly.
 *
 * An undeclared surface renders `—`, the same vocabulary Coverage uses: undeclared is an
 * absence of evidence, never a zero.
 */
function capabilityRow(capability: ProjectMapCapabilityV1, selected: boolean, innerWidth: number): string {
	const surfaces = capability.surfaces.length === 0 ? "—" : capability.surfaces.map((surface) => SURFACE_LABEL[surface]).join(" · ");
	const head = `${selected ? "▸ " : "  "}${PROJECT_MAP_STATE_GLYPH[capability.state]} `;
	const tail = ` · ${surfaces}`;
	return `${head}${middleTruncate(capability.id, innerWidth - head.length - tail.length)}${tail}`;
}

export function projectMapCardBody(state: ProjectMapCardState, collapse: ProjectMapCollapseState = PROJECT_MAP_EXPANDED, selection?: ProjectMapSelection, openPiReadiness?: ProjectMapOpenPiReadinessView, innerWidth = CARD_BODY_BUDGET): ProjectMapCardBody {
	const body: ProjectMapCardBody = { lines: [], headers: [], capabilities: [] };
	const add = (line: string): number => {
		const index = body.lines.length;
		body.lines.push(...boundedLines(line, innerWidth));
		return index;
	};
	/** A row that must stay one line: wrapping it would cost it its glyph and its indent. */
	const addRow = (line: string): number => {
		const index = body.lines.length;
		body.lines.push(line);
		return index;
	};
	if (state.kind === "empty") {
		add(`No Project Map at ${PROJECT_MAP_ARTIFACT_PATH}.`);
		add("Run /gentle:project-map to generate one.");
		return body;
	}
	if (state.kind === "invalid") {
		add("The Project Map artifact is not valid:");
		for (const diagnostic of state.diagnostics.slice(0, MAX_DIAGNOSTICS)) add(`  ${diagnostic.path}: ${diagnostic.message}`);
		add("Run /gentle:project-map status for the full report.");
		return body;
	}
	const { map } = state;
	if (map.foundations.length > 0) {
		const line = add(`${collapse.foundations ? "▸" : "▾"} ${PROJECT_MAP_GROUP_LABEL.foundations} ${completed(map.foundations)}/${map.foundations.length}`);
		body.headers.push({ line, group: "foundations" });
		if (!collapse.foundations) for (const foundation of map.foundations) add(`  ${PROJECT_MAP_STATE_GLYPH[foundation.state]} ${foundation.id}`);
	}
	const capabilityHeader = add(`${collapse.capabilities ? "▸" : "▾"} ${PROJECT_MAP_GROUP_LABEL.capabilities} ${completed(map.capabilities)}/${map.capabilities.length}`);
	body.headers.push({ line: capabilityHeader, group: "capabilities" });
	if (!collapse.capabilities) {
		for (const capability of map.capabilities) {
			const selected = capability.id === selection;
			const line = addRow(capabilityRow(capability, selected, innerWidth));
			// Every capability row is exactly one body line, so the click target is that line.
			body.capabilities.push({ line, id: capability.id, height: 1 });
			if (selected) body.selected = line;
		}
	}
	add("Coverage");
	for (const line of coverageLines(map, state.coverage, innerWidth)) add(line);
	for (const line of inspectorLines(map, selection ?? "", openPiReadiness)) add(line);
	return body;
}

export function projectMapCardDescriptor(state: ProjectMapCardState, collapse: ProjectMapCollapseState = PROJECT_MAP_EXPANDED, selection?: ProjectMapSelection, openPiReadiness?: ProjectMapOpenPiReadinessView, innerWidth = CARD_BODY_BUDGET): ProjectMapCardDescriptor {
	const body = projectMapCardBody(state, collapse, selection, openPiReadiness, innerWidth).lines;
	if (state.kind === "empty") return { title: "Project Map", subtitle: "no map", tone: "info", body };
	if (state.kind === "invalid") return { title: "Project Map", subtitle: "invalid", tone: "error", body };
	return {
		title: "Project Map",
		subtitle: `${state.map.project.name} · ${state.map.approval.state}`,
		tone: state.map.approval.state === "approved" ? "success" : "warning",
		body,
	};
}

/**
 * A stable digest of the descriptor the card renders. Width and theme are already part of the
 * layout's section cache key, so this follows descriptor changes without reinterpreting state.
 */
export function projectMapCardDigest(state: ProjectMapCardState, collapse: ProjectMapCollapseState = PROJECT_MAP_EXPANDED, selection?: ProjectMapSelection, openPiReadiness?: ProjectMapOpenPiReadinessView): string {
	const descriptor = projectMapCardDescriptor(state, collapse, selection, openPiReadiness);
	return `project-map/${state.kind}:${JSON.stringify({ title: descriptor.title, subtitle: descriptor.subtitle, tone: descriptor.tone, body: descriptor.body })}`;
}
