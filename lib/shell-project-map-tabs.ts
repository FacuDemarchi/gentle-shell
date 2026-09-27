import { createHash } from "node:crypto";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CardTheme } from "./shell-card.ts";
import { PROJECT_MAP_SURFACES, type ProjectMapState, type ProjectMapSurface } from "./shell-project-map-schema.ts";
import { PROJECT_MAP_STATE_GLYPH } from "./shell-project-map-view.ts";

/**
 * The read-only projection behind the orchestrator session tabs.
 *
 * A tab exists because the coordination store ties a session to a capability of
 * this repository; the approved map supplies the objective, the declared surfaces
 * and the declared state. Nothing here writes to the store, and the projection
 * takes already-read values, so it performs no I/O of its own and its readers stay
 * injected at the composition site, exactly like the Project Map card.
 */

export type OrchestratorSessionTabLiveness = "live" | "stale";
export type OrchestratorSessionTabHeartbeat = "fresh" | "stale" | "missing" | "corrupted";

export interface OrchestratorSessionTabsDiagnostic {
	code: string;
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface OrchestratorSessionTab {
	capabilityId: string;
	outcome: string;
	state: ProjectMapState;
	sessionId: string;
	/** Presence decides liveness when it is available; the store's lease status decides it otherwise. */
	liveness: OrchestratorSessionTabLiveness;
	heartbeat: OrchestratorSessionTabHeartbeat;
	/** Null when the store holds no worktree binding for this capability: unknown, never guessed. */
	worktreeRoot: string | null;
	branch: string | null;
	openBlockers: number;
	/** Null when the coordination projection does not cover this capability. */
	nextSafeAction: string | null;
	/** The session's last heartbeat instant, or null when the store has none. */
	lastActivity: string | null;
}

export interface OrchestratorSessionTabSection {
	surface: ProjectMapSurface;
	tabs: OrchestratorSessionTab[];
}

export interface OrchestratorSessionTabs {
	/** False when the map could not be read: the row then renders nothing rather than inventing state. */
	available: boolean;
	sections: OrchestratorSessionTabSection[];
	diagnostics: OrchestratorSessionTabsDiagnostic[];
}

export interface OrchestratorSessionTabsCapability {
	id: string;
	outcome: string;
	surfaces: readonly ProjectMapSurface[];
	state: ProjectMapState;
}

export interface OrchestratorSessionTabsInput {
	/** The approved map, or null when it could not be read or is not approved. */
	map: { capabilities: readonly OrchestratorSessionTabsCapability[] } | null;
	satellites: readonly {
		capabilityId: string;
		sessionId: string;
		status: OrchestratorSessionTabLiveness;
		heartbeat: OrchestratorSessionTabHeartbeat;
	}[];
	capabilities: readonly { capabilityId: string; openBlockers: number; nextSafeAction: string }[];
	worktreeBindings: readonly { capabilityId: string; sessionId: string; branch: string; worktreeRoot: string }[];
	/**
	 * Session ids known to be present on this machine, or null when presence is
	 * unavailable. Presence never creates a tab; it only settles liveness.
	 */
	presenceAlive: ReadonlySet<string> | null;
	/** Last heartbeat instant per session id, empty when the store has none. */
	lastActivity: ReadonlyMap<string, string>;
	diagnostics?: readonly OrchestratorSessionTabsDiagnostic[];
}

const UNKNOWN_CAPABILITY_CODE = "orchestrator-session-tabs/unknown-capability";

function livenessOf(satellite: OrchestratorSessionTabsInput["satellites"][number], presenceAlive: ReadonlySet<string> | null): OrchestratorSessionTabLiveness {
	if (presenceAlive === null) return satellite.status;
	return presenceAlive.has(satellite.sessionId) ? "live" : "stale";
}

/**
 * The store keeps one binding per capability, so a binding written by a different
 * session still names this capability's worktree. When two exist, the one whose
 * session matches wins, so a re-provisioned worktree cannot be shadowed by a stale
 * binding left behind by an earlier session.
 */
function bindingFor(capabilityId: string, sessionId: string, bindings: OrchestratorSessionTabsInput["worktreeBindings"]): OrchestratorSessionTabsInput["worktreeBindings"][number] | undefined {
	const candidates = bindings.filter((binding) => binding.capabilityId === capabilityId);
	return candidates.find((binding) => binding.sessionId === sessionId) ?? candidates[0];
}

export function deriveOrchestratorSessionTabs(input: OrchestratorSessionTabsInput): OrchestratorSessionTabs {
	const diagnostics: OrchestratorSessionTabsDiagnostic[] = [...(input.diagnostics ?? [])];
	if (input.map === null) return { available: false, sections: [], diagnostics };

	const declared = new Map(input.map.capabilities.map((capability) => [capability.id, capability]));
	const coordination = new Map(input.capabilities.map((capability) => [capability.capabilityId, capability]));

	const tabs: OrchestratorSessionTab[] = [];
	for (const satellite of input.satellites) {
		const capability = declared.get(satellite.capabilityId);
		if (capability === undefined) {
			diagnostics.push({
				code: UNKNOWN_CAPABILITY_CODE,
				path: `$.capabilities.${satellite.capabilityId}`,
				message: `Session "${satellite.sessionId}" holds capability "${satellite.capabilityId}", which the approved map does not declare.`,
				severity: "warning",
			});
			continue;
		}
		const binding = bindingFor(satellite.capabilityId, satellite.sessionId, input.worktreeBindings);
		const projected = coordination.get(satellite.capabilityId);
		tabs.push({
			capabilityId: satellite.capabilityId,
			outcome: capability.outcome,
			state: capability.state,
			sessionId: satellite.sessionId,
			liveness: livenessOf(satellite, input.presenceAlive),
			heartbeat: satellite.heartbeat,
			worktreeRoot: binding?.worktreeRoot ?? null,
			branch: binding?.branch ?? null,
			openBlockers: projected?.openBlockers ?? 0,
			nextSafeAction: projected?.nextSafeAction ?? null,
			lastActivity: input.lastActivity.get(satellite.sessionId) ?? null,
		});
	}

	tabs.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId) || left.sessionId.localeCompare(right.sessionId));

	// A surface earns a section while at least one live session works a capability
	// that declares it. Inside a section every session on that surface stays visible,
	// so a session that died while a peer keeps working is still distinguishable
	// instead of silently disappearing.
	const sections: OrchestratorSessionTabSection[] = [];
	for (const surface of PROJECT_MAP_SURFACES) {
		const onSurface = tabs.filter((tab) => declared.get(tab.capabilityId)?.surfaces.includes(surface) === true);
		if (!onSurface.some((tab) => tab.liveness === "live")) continue;
		sections.push({ surface, tabs: onSurface });
	}

	return { available: true, sections, diagnostics };
}

/**
 * The row and the read-only detail for the orchestrator session tabs.
 *
 * The row is a single full-width line by placement, so option C is what keeps it
 * honest: only surfaces with a live session are on it, and it is measured before it
 * is painted (`truncateToWidth` understands ANSI), so a narrow terminal drops the
 * tail with an ellipsis instead of wrapping and pushing the rail down.
 */

export const ORCHESTRATOR_SESSION_SURFACE_LABEL: Record<ProjectMapSurface, string> = {
	productUx: "Product/UX",
	web: "Web",
	api: "API",
	data: "Data",
	security: "Security",
	operations: "Ops",
	tests: "Tests",
};

const SECTION_GAP = "   ";
const ITEM_GAP = ", ";
const SELECTED_MARKER = "▸ ";

interface TabRowItem {
	capabilityId: string;
	count: number;
}

/** Sections are ordered by capability id, so equal ids are adjacent and can be counted in one pass. */
function rowItems(tabs: readonly OrchestratorSessionTab[]): TabRowItem[] {
	const items: TabRowItem[] = [];
	for (const tab of tabs) {
		const last = items[items.length - 1];
		if (last !== undefined && last.capabilityId === tab.capabilityId) {
			last.count += 1;
			continue;
		}
		items.push({ capabilityId: tab.capabilityId, count: 1 });
	}
	return items;
}

function blockersPhrase(count: number): string {
	return count === 1 ? "1 open blocker" : `${count} open blockers`;
}

export function renderOrchestratorSessionTabRow(options: { tabs: OrchestratorSessionTabs; selection?: string; width: number; theme: CardTheme }): string[] {
	const { tabs: model, selection, width, theme } = options;
	if (!model.available || model.sections.length === 0) return [];
	const sections = model.sections.map((section) => {
		const items = rowItems(section.tabs).map((item) => {
			const label = item.count > 1 ? `${item.capabilityId} ×${item.count}` : item.capabilityId;
			return item.capabilityId === selection ? theme.fg("accent", `${SELECTED_MARKER}${label}`) : label;
		});
		return `${theme.fg("muted", ORCHESTRATOR_SESSION_SURFACE_LABEL[section.surface])} · ${items.join(ITEM_GAP)}`;
	});
	return [truncateToWidth(sections.join(SECTION_GAP), Math.max(0, width), "…")];
}

export function renderOrchestratorSessionTabDetail(options: { tabs: OrchestratorSessionTabs; selection?: string; width: number; theme: CardTheme }): string[] {
	const { tabs: model, selection, width, theme } = options;
	if (selection === undefined) return [];
	const fit = (role: string, text: string) => theme.fg(role, truncateToWidth(text, Math.max(0, width), "…"));
	// A capability that declares several surfaces appears once per section, so the
	// sessions are folded back together before they are listed.
	const sessions = [...new Map(model.sections.flatMap((section) => section.tabs).filter((tab) => tab.capabilityId === selection).map((tab) => [tab.sessionId, tab])).values()];
	if (sessions.length === 0) return [fit("muted", `No session is bound to ${selection}.`)];
	const capability = sessions[0];
	const lines = [
		fit("accent", `${SELECTED_MARKER}${selection}`),
		fit("text", capability.outcome),
		fit("muted", `${PROJECT_MAP_STATE_GLYPH[capability.state]} ${capability.state} · ${blockersPhrase(capability.openBlockers)} · next ${capability.nextSafeAction ?? "unknown"}`),
	];
	for (const session of sessions) {
		lines.push(fit("text", `${session.sessionId} · ${session.liveness} · heartbeat ${session.heartbeat} · ${session.lastActivity ?? "no activity recorded"}`));
		lines.push(fit("muted", session.worktreeRoot === null ? "  worktree unknown" : `  worktree ${session.worktreeRoot}`));
		lines.push(fit("muted", session.branch === null ? "  branch unknown" : `  branch ${session.branch}`));
	}
	return lines;
}

/**
 * The rail memo re-renders a part only when its digest changes, so the digest
 * covers exactly what is painted — including the state and liveness the detail
 * shows — and deliberately ignores diagnostics, which paint nothing.
 */
export function orchestratorSessionTabsDigest(tabs: OrchestratorSessionTabs, selection?: string): string {
	const painted = {
		available: tabs.available,
		selection: selection ?? null,
		sections: tabs.sections.map((section) => ({
			surface: section.surface,
			tabs: section.tabs.map((tab) => [tab.capabilityId, tab.sessionId, tab.outcome, tab.state, tab.liveness, tab.heartbeat, tab.worktreeRoot, tab.branch, tab.openBlockers, tab.nextSafeAction, tab.lastActivity]),
		})),
	};
	return createHash("sha256").update(JSON.stringify(painted)).digest("hex");
}
