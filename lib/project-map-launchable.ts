import type { ProjectMapState } from "./shell-project-map-schema.ts";

// Which capabilities the card may offer to open right now.
//
// This is the cheap projection of `projectMapOpenPiReadiness`: the same evidence, read once for
// the whole card instead of once per capability, and without the git re-verification the real
// plan performs. It can therefore over-report by one provisioning detail — a binding exists but
// the worktree behind it is gone — and that is deliberate: the click always re-runs the real
// predicate and refuses with its own reasons, so the marker is a hint and never an authority.
//
// The one thing it never does is invent a capability the store cannot back: every condition is
// read from the map or from the coordination projection, and a capability the projection does
// not cover is not launchable.

export interface ProjectMapLaunchableInput {
	/** The map as read, or null when it could not be read. */
	map: { approval: { state: string }; capabilities: readonly { id: string; state: ProjectMapState }[] } | null;
	/** One entry per declared capability, from the coordination projection. */
	coordination: readonly { capabilityId: string; dependencyReady: boolean; openBlockers: number; proposedContracts: number }[];
	/** Capabilities the store holds a worktree binding for. */
	bound: ReadonlySet<string>;
	/** The executable half's opt-in, read from the environment. */
	executable: boolean;
	/** Whether the host that would run the session is available. */
	hostAvailable: boolean;
}

export function projectMapLaunchableSet(input: ProjectMapLaunchableInput): ReadonlySet<string> {
	const launchable = new Set<string>();
	if (!input.executable || !input.hostAvailable) return launchable;
	const map = input.map;
	if (map === null || map.approval.state !== "approved") return launchable;
	const coordination = new Map(input.coordination.map((entry) => [entry.capabilityId, entry]));
	for (const capability of map.capabilities) {
		// The two declarations that mean "do not start" are the only ones the state still decides.
		if (capability.state === "done" || capability.state === "blocked") continue;
		const state = coordination.get(capability.id);
		if (state === undefined) continue;
		if (!state.dependencyReady || state.openBlockers > 0 || state.proposedContracts > 0) continue;
		if (!input.bound.has(capability.id)) continue;
		launchable.add(capability.id);
	}
	return launchable;
}
