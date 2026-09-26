import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectMapCoordinationState } from "./project-map-coordination-state.ts";
import { resolveProjectMapStoreRoot } from "./project-map-store-root.ts";
import { projectMapStoreBindingProvesDead, readProjectMapStoreHeartbeat } from "./project-map-store-heartbeats.ts";
import { parseProjectMapStoreValue, PROJECT_MAP_STORE_DIAGNOSTIC_CODES, serializeProjectMapStoreValue, type ProjectMapStoreSessionBindingV1 } from "./project-map-store-schema.ts";
import { planProjectMapWorktree, type ProjectMapWorktreePlan } from "./project-map-worktrees.ts";
import { withoutInteractiveHost } from "./rpc-host.ts";
import { worktreeGitEnvironment } from "./session-worktree-registry.ts";
import { childArguments, piCommand, type TaskRequest } from "./agents-runner.ts";
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

export interface ProjectMapOpenPiConfirmation {
	confirmed: boolean;
	sessionId: string | null;
	heartbeat: "fresh" | "stale" | "missing" | "corrupted" | "unreadable" | null;
	observation: string;
	diagnostics: ProjectMapOpenPiDiagnostic[];
}

/** Observes durable child evidence without extending the launch command's lifetime. */
export async function awaitProjectMapOpenPiConfirmation({
	root, worktree, since, timeoutMs = 5000, pollMs = 250, now = () => new Date().toISOString(), sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), readdir = readdirSync, readFile = readFileSync, readHeartbeat = readProjectMapStoreHeartbeat,
}: {
	root: string; worktree: string; since: string; timeoutMs?: number; pollMs?: number;
	now?: () => string; sleep?: (ms: number) => Promise<void>;
	readdir?: (path: string) => string[]; readFile?: (path: string, encoding: "utf8") => string;
	readHeartbeat?: typeof readProjectMapStoreHeartbeat;
}): Promise<ProjectMapOpenPiConfirmation> {
	const diagnostics: ProjectMapOpenPiDiagnostic[] = [];
	const timeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
	const poll = Number.isFinite(pollMs) ? Math.max(1, pollMs) : 1;
	const unconfirmed = (): ProjectMapOpenPiConfirmation => ({ confirmed: false, sessionId: null, heartbeat: null, observation: `no binding for "${worktree}" written after ${since} appeared within ${timeoutMs}ms, so the child never proved it started.`, diagnostics });
	let remaining = timeout;
	for (;;) {
		let entries: string[] = [];
		try { entries = readdir(join(root, "sessions")).sort(); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push(diagnostic("project-map-open-pi/confirmation-unreadable", `Session bindings could not be read: ${error instanceof Error ? error.message : String(error)}`));
		}
		let instant: string;
		try { instant = now(); } catch (error) { diagnostics.push(diagnostic("project-map-open-pi/confirmation-unreadable", `The observation clock failed: ${error instanceof Error ? error.message : String(error)}`)); return unconfirmed(); }
		for (const entry of entries) {
			let text: string, parsed: ReturnType<typeof parseProjectMapStoreValue>;
			try { text = readFile(join(root, "sessions", entry), "utf8"); parsed = parseProjectMapStoreValue("session-binding", text); }
			catch (error) { diagnostics.push(diagnostic("project-map-open-pi/confirmation-unreadable", `Session binding "${entry}" could not be read: ${error instanceof Error ? error.message : String(error)}`)); continue; }
			if (parsed.record === null) { appendUnique(diagnostics, parsed.diagnostics); continue; }
			const binding = parsed.record as ProjectMapStoreSessionBindingV1;
			try {
				// The store's own readers treat a non-canonical record as corrupted, so a
				// hand-edited file must not be able to confirm a launch.
				const canonical = serializeProjectMapStoreValue("session-binding", binding);
				if (canonical.record !== text || entry !== `${createHash("sha256").update(binding.session_id).digest("hex")}.json`) {
					diagnostics.push(diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED, `Session binding "${entry}" is not in canonical form, so it cannot confirm a launch.`));
					continue;
				}
				if (projectMapStoreBindingProvesDead(binding) || resolve(binding.workspace_root) !== resolve(worktree) || binding.bound_at < since) continue;
				const result = readHeartbeat({ root, sessionId: binding.session_id, now: instant });
				appendUnique(diagnostics, result.diagnostics);
				const heartbeat = result.status === "free" ? "missing" : result.status;
				if (heartbeat === "fresh") return { confirmed: true, sessionId: binding.session_id, heartbeat, observation: `session "${binding.session_id}" wrote its own binding for "${worktree}" at ${binding.bound_at} with a fresh heartbeat.`, diagnostics };
			} catch (error) { diagnostics.push(diagnostic("project-map-open-pi/confirmation-unreadable", `Session binding "${entry}" could not be observed: ${error instanceof Error ? error.message : String(error)}`)); }
		}
		if (remaining <= 0) return unconfirmed();
		const delay = Math.min(poll, remaining);
		try { await sleep(delay); } catch (error) { diagnostics.push(diagnostic("project-map-open-pi/confirmation-unreadable", `Confirmation polling failed: ${error instanceof Error ? error.message : String(error)}`)); return unconfirmed(); }
		remaining -= delay;
	}
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

export interface ProjectMapOpenPiFallback {
	decision: "offer" | "refuse";
	argv: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	handoff: string;
	sessionDir: string;
	diagnostics: ProjectMapOpenPiDiagnostic[];
}

type ProjectMapOpenPiChild = {
	pid?: number;
	unref?: () => void;
	once: (event: "spawn" | "error", listener: (error?: unknown) => void) => unknown;
};
type ProjectMapOpenPiSpawn = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: "ignore"; windowsHide: boolean }) => ProjectMapOpenPiChild;
type ProjectMapOpenPiMkdir = (path: string, options: { recursive: true }) => unknown;

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

/** Builds the explicitly selected runner fallback without weakening the readiness gate. */
export function planProjectMapOpenPiFallback(plan: ProjectMapOpenPiPlan, {
	sessionDir, extensionPaths = [], pi = piCommand(), exists = existsSync,
}: {
	sessionDir: string; extensionPaths?: string[]; pi?: ReturnType<typeof piCommand>; exists?: (path: string) => boolean;
}): ProjectMapOpenPiFallback {
	const readinessErrors = plan.readiness.diagnostics.filter((entry) => entry.severity === "error");
	// A background child is a subagent child: it must never inherit the parent's
	// interactive-host signal, which agents-runner also strips from every child.
	const env = withoutInteractiveHost({ ...plan.env });
	const sessionDirectoryDiagnostic = sessionDir.trim().length === 0 ? diagnostic("project-map-open-pi/session-dir-required", "A background subagent requires a session directory.") : null;
	if (sessionDirectoryDiagnostic !== null || readinessErrors.some((entry) => entry.code !== "project-map-open-pi/host-unavailable")) {
		return { decision: "refuse", argv: [], cwd: plan.cwd, env, handoff: plan.handoff, sessionDir, diagnostics: [...readinessErrors, ...(sessionDirectoryDiagnostic === null ? [] : [sessionDirectoryDiagnostic])] };
	}
	let parentSessionId = "";
	try {
		const identity = JSON.parse(plan.env[PROJECT_MAP_OPEN_PI_ENV] ?? "") as { parentSessionId?: unknown };
		if (typeof identity.parentSessionId === "string") parentSessionId = identity.parentSessionId;
	} catch {}
	// The RPC handshake that normally delivers prompt is deliberately not reimplemented.
	// The shared child contract opens rpc mode, and an rpc child is driven: with no driver
	// it reads EOF on stdin and exits without running a turn (resolved against the real
	// binary: `pi --mode rpc --no-tools "<prompt>" < /dev/null` exits 0 with no response,
	// while `pi --print "<prompt>" < /dev/null` answers). A detached background child must
	// run its own turn, so this plan replaces the mode pair with `--print` and appends the
	// handoff as the one-shot message; every other flag still comes from childArguments.
	const request: TaskRequest = {
		prompt: plan.handoff, label: undefined, context: undefined, mode: "task", cwd: plan.cwd, parentSessionId,
		model: undefined, thinking: undefined, sessionDir, resumeSessionPath: undefined, env, extensionPaths,
		agent: { name: "project-map-open-pi", description: "Project Map Open Pi background launch", filePath: extensionPaths.find((path) => exists(path)) ?? "", scope: "project", instructions: plan.handoff, model: undefined, thinking: undefined, mode: undefined, tools: [] },
	};
	return { decision: "offer", argv: [pi.command, ...pi.args, ...oneShotPrintArguments(childArguments(request)), plan.handoff], cwd: plan.cwd, env, handoff: plan.handoff, sessionDir, diagnostics: [] };
}

/** Swaps the runner's driven rpc mode for pi's one-shot print mode; every other flag is untouched. */
function oneShotPrintArguments(args: string[]): string[] {
	return args[0] === "--mode" && args[1] === "rpc" ? ["--print", ...args.slice(2)] : args;
}

/**
 * A spawn that succeeded synchronously can still fail asynchronously (missing
 * executable, invalid cwd); without this wait the failure escapes as an
 * uncaught child-process error after a "launch requested" report.
 */
async function settleProjectMapOpenPiChild(child: ProjectMapOpenPiChild, settleMs: number): Promise<{ spawned: boolean; error: string | null }> {
	return await new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => finish(false, `the background runner did not report a spawn within ${settleMs}ms.`), settleMs);
		function finish(spawned: boolean, error: string | null): void {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ spawned, error });
		}
		child.once("spawn", () => finish(true, null));
		child.once("error", (error) => finish(false, error instanceof Error ? error.message : String(error)));
	});
}

/** Executes an explicitly approved background fallback; a spawn ACK is not work confirmation. */
export async function runProjectMapOpenPiFallback(fallback: ProjectMapOpenPiFallback, { spawn = nodeSpawn as unknown as ProjectMapOpenPiSpawn, mkdir = mkdirSync as unknown as ProjectMapOpenPiMkdir, settleMs = 2000 }: { spawn?: ProjectMapOpenPiSpawn; mkdir?: ProjectMapOpenPiMkdir; settleMs?: number } = {}): Promise<{ launched: boolean; pid: number | null; error: string | null }> {
	if (fallback.decision === "refuse") return { launched: false, pid: null, error: null };
	let child: ProjectMapOpenPiChild;
	try {
		mkdir(fallback.sessionDir, { recursive: true });
		child = spawn(fallback.argv[0]!, fallback.argv.slice(1), { cwd: fallback.cwd, env: fallback.env, detached: true, stdio: "ignore", windowsHide: true });
	} catch (error) {
		return { launched: false, pid: null, error: error instanceof Error ? error.message : String(error) };
	}
	child.unref?.();
	const settled = await settleProjectMapOpenPiChild(child, settleMs);
	if (!settled.spawned) return { launched: false, pid: null, error: settled.error };
	return { launched: true, pid: child.pid ?? null, error: null };
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
	if (worktree.decision === "create") diagnostics.push(diagnostic("project-map-open-pi/worktree-not-provisioned", `Capability worktree "${worktree.inspection.identity.path}" is not provisioned yet; provision it before opening Pi.`));

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
