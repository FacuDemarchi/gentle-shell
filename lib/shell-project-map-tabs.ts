import { PROJECT_MAP_SURFACES, type ProjectMapState, type ProjectMapSurface } from "./shell-project-map-schema.ts";

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
