import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { readProjectMapClaim } from "./project-map-store-claims.ts";
import { projectMapStoreBindingProvesDead, readProjectMapStoreHeartbeat } from "./project-map-store-heartbeats.ts";
import { resolveProjectMapStoreRoot } from "./project-map-store-root.ts";
import { parseProjectMapStoreValue, PROJECT_MAP_STORE_DIAGNOSTIC_CODES, serializeProjectMapStoreValue, type ProjectMapStoreDiagnostic, type ProjectMapStoreSessionBindingV1 } from "./project-map-store-schema.ts";
import { readProjectMapStoreDescriptor } from "./project-map-store.ts";
import { assertManagedStorePathV1 } from "./review-repository.ts";
import { resolveSessionWorktreeWithGit, worktreeGitEnvironment } from "./session-worktree-registry.ts";

export interface ProjectMapWorktreeIdentity {
	branch: string;
	path: string;
}

export interface InspectProjectMapWorktreeTargetOptions {
	cwd: string;
	capabilityId: string;
	sessionId: string;
	now: string;
}

export interface ProjectMapWorktreeInspection {
	identity: ProjectMapWorktreeIdentity;
	repository: { root: string; commonDir: string; sameClone: boolean };
	branch: { name: string; exists: boolean; isCurrent: boolean };
	directory: {
		path: string;
		exists: boolean;
		empty: boolean;
		insideAnotherRepository: boolean;
		/** `true` means the target is inside the Git common directory, or containment could not be ruled out. */
		insideCommonDir: boolean;
	};
	session: { occupiedBy: string | null; heartbeat: "fresh" | "stale" | "missing" };
	claim: { status: "free" | "live" | "stale" | "held-by-other" | "corrupted"; sessionId: string | null };
	diagnostics: ProjectMapStoreDiagnostic[];
}

export function deriveProjectMapWorktreeIdentity({ repositoryRoot, capabilityId }: { repositoryRoot: string; capabilityId: string }): ProjectMapWorktreeIdentity {
	return {
		branch: `feat/${capabilityId}`,
		path: join(dirname(repositoryRoot), `${basename(repositoryRoot)}-worktrees`, capabilityId),
	};
}

function directoryState(path: string): { exists: boolean; empty: boolean } {
	try {
		return { exists: true, empty: readdirSync(path).length === 0 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, empty: true };
		return { exists: true, empty: false };
	}
}

function gitResult(cwd: string, args: string[]): { status: number; output: string } {
	try {
		return {
			status: 0,
			output: String(execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
				windowsHide: true,
				env: worktreeGitEnvironment(),
			})),
		};
	} catch (error) {
		const result = error as NodeJS.ErrnoException & { status?: number; stdout?: string | Buffer };
		return { status: result.status ?? -1, output: String(result.stdout ?? "") };
	}
}

function branchState(root: string, branch: string): { exists: boolean; isCurrent: boolean } {
	const exists = gitResult(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
	if (exists.status !== 0 && exists.status !== 1) throw new Error("Git could not read branch references.");
	const current = gitResult(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	if (current.status !== 0 && current.status !== 1) throw new Error("Git could not read the current branch.");
	return { exists: exists.status === 0, isCurrent: current.status === 0 && current.output.trim() === branch };
}

function stableRealpath(path: string): string {
	const unresolved: string[] = [];
	let current = resolve(path);
	while (true) {
		try {
			return join(realpathSync(current), ...unresolved.reverse());
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			unresolved.push(basename(current));
			current = parent;
		}
	}
}

function isInsideDirectory(directory: string, path: string): boolean {
	const pathFromDirectory = relative(directory, path);
	return pathFromDirectory !== ".." && !pathFromDirectory.startsWith(`..${sep}`);
}

function targetIsInsideCommonDir(commonDir: string, target: string, diagnostics: ProjectMapStoreDiagnostic[]): boolean {
	try {
		assertManagedStorePathV1(commonDir, target);
		return true;
	} catch {
		try {
			return isInsideDirectory(realpathSync(commonDir), stableRealpath(target));
		} catch {
			diagnostics.push({
				code: PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE,
				path: "$",
				message: "Worktree target path could not be inspected for common-directory containment.",
				severity: "error",
			});
			return true;
		}
	}
}

function addDiagnostics(into: ProjectMapStoreDiagnostic[], entries: ProjectMapStoreDiagnostic[]): void {
	into.push(...entries);
}

function corruptedSessionBindingDiagnostic(entry: string, message: string): ProjectMapStoreDiagnostic {
	return { code: PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED, path: `$.sessions.${entry}`, message, severity: "error" };
}

function inspectOccupancy(root: string, target: string, now: string, diagnostics: ProjectMapStoreDiagnostic[]): { sessionId: string; heartbeat: "fresh" | "stale" | "missing" } | null {
	let entries: string[];
	try {
		entries = readdirSync(join(root, "sessions")).sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		diagnostics.push({ code: "project-map-store/unreadable-store", path: "$", message: "Session binding directory could not be read.", severity: "error" });
		return null;
	}
	let occupant: { sessionId: string; heartbeat: "fresh" | "stale" | "missing" } | null = null;
	for (const entry of entries) {
		let bytes: string;
		try {
			bytes = readFileSync(join(root, "sessions", entry), "utf8");
		} catch {
			diagnostics.push(corruptedSessionBindingDiagnostic(entry, "Session binding record could not be read."));
			continue;
		}
		const parsed = parseProjectMapStoreValue("session-binding", bytes);
		if (parsed.record === null) {
			diagnostics.push(corruptedSessionBindingDiagnostic(entry, "Session binding record is corrupted."), ...parsed.diagnostics);
			continue;
		}
		const binding = parsed.record as ProjectMapStoreSessionBindingV1;
		const canonical = serializeProjectMapStoreValue("session-binding", binding);
		if (canonical.record === null || canonical.record !== bytes || entry !== `${createHash("sha256").update(binding.session_id).digest("hex")}.json`) {
			diagnostics.push(corruptedSessionBindingDiagnostic(entry, "Session binding record is not in canonical form."));
			continue;
		}
		if (resolve(binding.workspace_root) !== resolve(target)) continue;
		if (projectMapStoreBindingProvesDead(binding)) continue;
		const heartbeat = readProjectMapStoreHeartbeat({ root, sessionId: binding.session_id, now });
		addDiagnostics(diagnostics, heartbeat.diagnostics);
		const status = heartbeat.status === "fresh" || heartbeat.status === "stale" ? heartbeat.status : "missing";
		if (occupant === null) occupant = { sessionId: binding.session_id, heartbeat: status };
	}
	return occupant;
}

export function inspectProjectMapWorktreeTarget({ cwd, capabilityId, sessionId, now }: InspectProjectMapWorktreeTargetOptions): ProjectMapWorktreeInspection {
	const repositoryIdentity = resolveSessionWorktreeWithGit(cwd, cwd);
	if (!repositoryIdentity) throw new Error("Git repository identity could not be resolved.");
	const identity = deriveProjectMapWorktreeIdentity({ repositoryRoot: repositoryIdentity.root, capabilityId });
	const directory = directoryState(identity.path);
	const targetIdentity = directory.exists ? resolveSessionWorktreeWithGit(identity.path, cwd) : undefined;
	const repository = {
		root: repositoryIdentity.root,
		commonDir: repositoryIdentity.commonDir,
		sameClone: targetIdentity === undefined || targetIdentity.commonDir === repositoryIdentity.commonDir,
	};
	const diagnostics: ProjectMapStoreDiagnostic[] = [];
	const store = resolveProjectMapStoreRoot(cwd);
	addDiagnostics(diagnostics, store.diagnostics);
	const descriptor = store.root === null ? null : readProjectMapStoreDescriptor(store.root);
	if (descriptor !== null) addDiagnostics(diagnostics, descriptor.diagnostics);

	let claim: ProjectMapWorktreeInspection["claim"] = { status: "corrupted", sessionId: null };
	let heartbeat: ProjectMapWorktreeInspection["session"]["heartbeat"] = "missing";
	let occupiedBy: string | null = null;
	if (store.root !== null) {
		const readClaim = readProjectMapClaim({ root: store.root, capabilityId, now });
		addDiagnostics(diagnostics, readClaim.diagnostics);
		claim = {
			status: readClaim.status === "unreadable" || readClaim.status === "corrupted" ? "corrupted" : readClaim.status === "live" && readClaim.claim?.session_id !== sessionId ? "held-by-other" : readClaim.status,
			sessionId: readClaim.claim?.session_id ?? null,
		};
		const readHeartbeat = readProjectMapStoreHeartbeat({ root: store.root, sessionId, now });
		addDiagnostics(diagnostics, readHeartbeat.diagnostics);
		const occupancy = inspectOccupancy(store.root, identity.path, now, diagnostics);
		occupiedBy = occupancy?.sessionId ?? null;
		heartbeat = occupancy?.heartbeat ?? "missing";
	}

	return {
		identity,
		repository,
		branch: { name: identity.branch, ...branchState(repositoryIdentity.root, identity.branch) },
		directory: {
			path: identity.path,
			...directory,
			// Comparing the resolved top level against the target path made a repository
			// rooted at the target look safe; compare clone common directories instead.
			insideAnotherRepository: targetIdentity !== undefined && targetIdentity.commonDir !== repositoryIdentity.commonDir,
			insideCommonDir: targetIsInsideCommonDir(repositoryIdentity.commonDir, identity.path, diagnostics),
		},
		session: { occupiedBy, heartbeat },
		claim,
		diagnostics,
	};
}
