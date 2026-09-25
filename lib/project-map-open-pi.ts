import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readProjectMapCoordinationState } from "./project-map-coordination-state.ts";
import { resolveProjectMapStoreRoot } from "./project-map-store-root.ts";
import { planProjectMapWorktree, type ProjectMapWorktreePlan } from "./project-map-worktrees.ts";
import { worktreeGitEnvironment } from "./session-worktree-registry.ts";
import { PROJECT_MAP_ARTIFACT_PATH, type ProjectMapCapabilityV1 } from "./shell-project-map-schema.ts";

export interface ProjectMapOpenPiHost {
	available: boolean;
	version: string | null;
}

export interface ProjectMapOpenPiDiagnostic {
	code: string;
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface ProjectMapOpenPiReadiness {
	permitted: boolean;
	capability: ProjectMapCapabilityV1 | null;
	claim: { capabilityId: string; sessionId: string; status: "live" | "stale"; heartbeat: "fresh" | "stale" | "missing" | "corrupted" } | null;
	worktree: ProjectMapWorktreePlan;
	host: ProjectMapOpenPiHost;
	diagnostics: ProjectMapOpenPiDiagnostic[];
}

function diagnostic(code: string, message: string): ProjectMapOpenPiDiagnostic {
	return { code, path: "$", message, severity: "error" };
}

function appendUnique(into: ProjectMapOpenPiDiagnostic[], entries: ProjectMapOpenPiDiagnostic[]): void {
	for (const entry of entries) if (!into.some((current) => current.code === entry.code && current.path === entry.path && current.message === entry.message && current.severity === entry.severity)) into.push(entry);
}

/** The only PM7-1 subprocess: a bounded, sanitized availability probe. */
export function probeProjectMapOpenPiHost({ env, timeoutMs, run = execFileSync }: { env: NodeJS.ProcessEnv; timeoutMs: number; run?: typeof execFileSync }): ProjectMapOpenPiHost {
	try {
		const version = String(run("tmux", ["-V"], {
			encoding: "utf8",
			timeout: timeoutMs,
			maxBuffer: 4096,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
			env: worktreeGitEnvironment(env),
		})).trim();
		return { available: true, version };
	} catch {
		return { available: false, version: null };
	}
}

export function projectMapOpenPiReadiness({ cwd, capabilityId, sessionId, now, host }: { cwd: string; capabilityId: string; sessionId: string; now: string; host: ProjectMapOpenPiHost }): ProjectMapOpenPiReadiness {
	const store = resolveProjectMapStoreRoot(cwd);
	const state = store.root === null ? null : readProjectMapCoordinationState({ root: store.root, mapPath: join(cwd, PROJECT_MAP_ARTIFACT_PATH), now });
	const worktree = planProjectMapWorktree({ cwd, capabilityId, sessionId, now });
	const capability = state?.map?.capabilities.find((entry) => entry.id === capabilityId) ?? null;
	const capabilityState = state?.capabilities.find((entry) => entry.capabilityId === capabilityId);
	const claim = state?.satellites.find((entry) => entry.capabilityId === capabilityId) ?? null;
	const storeDiagnostics = [...store.diagnostics, ...(state?.diagnostics ?? [])];
	const diagnostics: ProjectMapOpenPiDiagnostic[] = [];
	appendUnique(diagnostics, storeDiagnostics);
	appendUnique(diagnostics, worktree.diagnostics);

	if (capability === null) diagnostics.push(diagnostic("project-map-open-pi/capability-not-found", `Capability "${capabilityId}" is not declared in the approved Project Map.`));
	else {
		if (state?.map?.approval.state !== "approved") diagnostics.push(diagnostic("project-map-open-pi/capability-not-approved", `Capability "${capabilityId}" requires an approved Project Map.`));
		if (capability.state !== "ready") diagnostics.push(diagnostic("project-map-open-pi/capability-not-ready", `Capability "${capabilityId}" is declared "${capability.state}", not ready.`));
		if (capabilityState?.dependencyReady !== true) diagnostics.push(diagnostic("project-map-open-pi/dependencies-not-ready", `Dependencies for capability "${capabilityId}" are not ready.`));
		if ((capabilityState?.openBlockers ?? 0) > 0) diagnostics.push(diagnostic("project-map-open-pi/open-blocker", `Capability "${capabilityId}" has an open blocker.`));
		if ((capabilityState?.proposedContracts ?? 0) > 0) diagnostics.push(diagnostic("project-map-open-pi/proposed-contract", `Capability "${capabilityId}" has a proposed contract awaiting a decision.`));
	}
	if (!host.available) diagnostics.push(diagnostic("project-map-open-pi/host-unavailable", "tmux is unavailable."));
	return { permitted: diagnostics.every((entry) => entry.severity !== "error"), capability, claim, worktree, host, diagnostics };
}
