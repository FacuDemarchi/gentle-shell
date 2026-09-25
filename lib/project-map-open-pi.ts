import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectMapCoordinationState } from "./project-map-coordination-state.ts";
import { resolveProjectMapStoreRoot } from "./project-map-store-root.ts";
import { planProjectMapWorktree, type ProjectMapWorktreePlan } from "./project-map-worktrees.ts";
import { worktreeGitEnvironment } from "./session-worktree-registry.ts";
import { PROJECT_MAP_ARTIFACT_PATH, type ProjectMapCapabilityV1 } from "./shell-project-map-schema.ts";

export const PROJECT_MAP_OPEN_PI_ENV = "GENTLE_PI_PROJECT_MAP_OPEN_PI";

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

/** Checks only whether a named tmux session exists; callers keep launch authority. */
export function projectMapOpenPiSessionExists({ name, env, run = execFileSync }: { name: string; env: NodeJS.ProcessEnv; run?: typeof execFileSync }): boolean {
	try {
		run("tmux", ["has-session", "-t", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true, env: worktreeGitEnvironment(env) });
		return true;
	} catch { return false; }
}

export interface ProjectMapOpenPiLauncher {
	command: string;
	path: string;
	source: "package-local" | "path";
}

export interface ProjectMapOpenPiPlan {
	readiness: ProjectMapOpenPiReadiness;
	decision: "open" | "refuse";
	argv: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	handoff: string;
	sessionName: string;
	attachCommand: string[];
	launcher: ProjectMapOpenPiLauncher;
	diagnostics: ProjectMapOpenPiDiagnostic[];
}

export function deriveProjectMapOpenPiSessionName(capabilityId: string): string {
	return `project-map-open-pi-${capabilityId}`;
}

/** Resolves the package launcher first; PATH is a verified fallback for installed copies. */
export function resolveProjectMapOpenPiLauncher({
	packageRoot = dirname(dirname(fileURLToPath(import.meta.url))),
	nodeExecPath = process.execPath,
	env = process.env,
	exists = existsSync,
}: {
	packageRoot?: string;
	nodeExecPath?: string;
	env?: NodeJS.ProcessEnv;
	exists?: (path: string) => boolean;
} = {}): ProjectMapOpenPiLauncher | null {
	const local = join(packageRoot, "bin", "gentle-shell.mjs");
	if (exists(local)) return { command: nodeExecPath, path: local, source: "package-local" };
	for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const path = join(directory, process.platform === "win32" ? "gentle-shell.cmd" : "gentle-shell");
		if (exists(path)) return { command: path, path, source: "path" };
	}
	return null;
}

function handoff(readiness: ProjectMapOpenPiReadiness, sessionId: string, cwd: string, now: string): string {
	const capability = readiness.capability;
	if (capability === null) return "Project Map Open Pi handoff\nCapability: unavailable";
	const state = readProjectMapCoordinationState({ root: resolveProjectMapStoreRoot(cwd).root!, mapPath: join(cwd, PROJECT_MAP_ARTIFACT_PATH), now });
	const dependencies = capability.dependsOn.map((id) => {
		const dependency = state.map?.capabilities.find((entry) => entry.id === id);
		const projected = state.capabilities.find((entry) => entry.capabilityId === id);
		return `${id}: ${dependency?.state ?? "unavailable"}${projected === undefined ? "" : projected.dependencyReady ? " (ready)" : " (not ready)"}`;
	});
	return [
		"Project Map Open Pi handoff",
		`Capability: ${capability.id}`,
		`Objective and outcome: ${capability.outcome}`,
		`Approved surfaces: ${capability.surfaces.length === 0 ? "none" : capability.surfaces.join(", ")}`,
		`Dependencies: ${dependencies.length === 0 ? "none" : dependencies.join(", ")}`,
		`Accepted contracts: ${capability.contracts.length === 0 ? "none" : capability.contracts.join(", ")}`,
		`Feature documents: ${capability.featureDocs.length === 0 ? "none" : capability.featureDocs.join(", ")}`,
		`Parent session: ${sessionId}`,
		"Verification requirements: not declared by the map.",
	].join("\n");
}

/** Builds an inert tmux launch request; callers retain confirmation authority. */
export function planProjectMapOpenPi({
	cwd, capabilityId, sessionId, now, host, launcher = resolveProjectMapOpenPiLauncher(), sessionExists = () => false,
}: {
	cwd: string; capabilityId: string; sessionId: string; now: string; host: ProjectMapOpenPiHost;
	launcher?: ProjectMapOpenPiLauncher | null; sessionExists?: (name: string) => boolean;
}): ProjectMapOpenPiPlan {
	const readiness = projectMapOpenPiReadiness({ cwd, capabilityId, sessionId, now, host });
	const target = readiness.worktree.inspection.identity.path;
	const text = handoff(readiness, sessionId, cwd, now);
	const sessionName = deriveProjectMapOpenPiSessionName(capabilityId);
	const diagnostics = [...readiness.diagnostics];
	if (launcher === null) diagnostics.push(diagnostic("project-map-open-pi/launcher-unavailable", "gentle-shell could not be resolved from this package or PATH."));
	else if (sessionExists(sessionName)) diagnostics.push(diagnostic("project-map-open-pi/session-name-occupied", `tmux session "${sessionName}" already exists; it was not modified.`));
	const executable = launcher ?? { command: "", path: "", source: "path" as const };
	const launcherArgv = executable.source === "package-local" ? [executable.command, executable.path] : [executable.command];
	const argv = ["tmux", "new-session", "-d", "-s", sessionName, "-c", target, ...launcherArgv, text].filter((entry) => entry.length > 0);
	return {
		readiness,
		decision: diagnostics.every((entry) => entry.severity !== "error") ? "open" : "refuse",
		argv,
		cwd: target,
		env: { ...worktreeGitEnvironment(), [PROJECT_MAP_OPEN_PI_ENV]: JSON.stringify({ capabilityId, parentSessionId: sessionId }) },
		handoff: text,
		sessionName,
		attachCommand: ["tmux", "attach-session", "-t", sessionName],
		launcher: executable,
		diagnostics,
	};
}

/** Starts exactly an already-approved plan; a tmux ACK is not work confirmation. */
export function openProjectMapPi(plan: ProjectMapOpenPiPlan, run: typeof execFileSync = execFileSync): { launched: boolean; error: string | null } {
	if (plan.decision === "refuse") return { launched: false, error: null };
	try {
		run(plan.argv[0]!, plan.argv.slice(1), { cwd: plan.cwd, env: plan.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
		return { launched: true, error: null };
	} catch (error) {
		return { launched: false, error: error instanceof Error ? error.message : String(error) };
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
