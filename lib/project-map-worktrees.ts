import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { readProjectMapCoordinationState } from "./project-map-coordination-state.ts";
import { readProjectMapClaim } from "./project-map-store-claims.ts";
import { projectMapStoreBindingProvesDead, readProjectMapStoreHeartbeat } from "./project-map-store-heartbeats.ts";
import { resolveProjectMapStoreRoot } from "./project-map-store-root.ts";
import { parseProjectMapStoreValue, PROJECT_MAP_STORE_DIAGNOSTIC_CODES, serializeProjectMapStoreValue, type ProjectMapStoreDiagnostic, type ProjectMapStoreSessionBindingV1 } from "./project-map-store-schema.ts";
import { readProjectMapStoreDescriptor } from "./project-map-store.ts";
import { assertManagedStorePathV1 } from "./review-repository.ts";
import { resolveSessionWorktreeWithGit, worktreeGitEnvironment } from "./session-worktree-registry.ts";
import { isIsoInstant, PROJECT_MAP_ARTIFACT_PATH } from "./shell-project-map-schema.ts";

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

export interface ProjectMapWorktreePlan {
	inspection: ProjectMapWorktreeInspection;
	decision: "create" | "reuse" | "refuse";
	command: string[] | null;
	baseCommit: string | null;
	dirty: boolean;
	diagnostics: ProjectMapStoreDiagnostic[];
}

export interface ProjectMapWorktreeInspection {
	identity: ProjectMapWorktreeIdentity;
	repository: {
		root: string;
		commonDir: string;
		/** A foreign clone rooted at the target is `false`; a linked worktree of this clone is `true`. */
		sameClone: boolean;
	};
	branch: { name: string; exists: boolean; isCurrent: boolean };
	directory: {
		path: string;
		exists: boolean;
		empty: boolean;
		/** `true` when the target sits inside a Git working tree; a foreign clone rooted at the target is reported by `sameClone`, while a linked worktree of this clone is neither. */
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

function gitResult(cwd: string, args: string[], run: typeof execFileSync = execFileSync): { status: number; output: string } {
	try {
		return {
			status: 0,
			output: String(run("git", ["--no-optional-locks", "-C", cwd, ...args], {
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

function worktreeRepositoryFacts(repository: { root: string; commonDir: string }, target: string, exists: boolean): { target: ReturnType<typeof resolveSessionWorktreeWithGit> | undefined; sameClone: boolean; insideAnotherRepository: boolean } {
	const targetIdentity = exists ? resolveSessionWorktreeWithGit(target, repository.root) : undefined;
	return {
		target: targetIdentity,
		sameClone: targetIdentity === undefined || targetIdentity.commonDir === repository.commonDir,
		insideAnotherRepository: targetIdentity !== undefined && targetIdentity.root !== stableRealpath(target),
	};
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
	const facts = worktreeRepositoryFacts(repositoryIdentity, identity.path, directory.exists);
	const repository = { root: repositoryIdentity.root, commonDir: repositoryIdentity.commonDir, sameClone: facts.sameClone };
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
			// A foreign clone rooted at the target is reported by `sameClone`; a linked
			// worktree of this clone is neither condition. Only a target below its own
			// resolved Git top level is inside another repository. Both sides are
			// canonicalized, because a symlinked worktree base would otherwise make a
			// legitimate same-clone worktree look nested.
			insideAnotherRepository: facts.insideAnotherRepository,
			insideCommonDir: targetIsInsideCommonDir(repositoryIdentity.commonDir, identity.path, diagnostics),
		},
		session: { occupiedBy, heartbeat },
		claim,
		diagnostics,
	};
}

function worktreeDiagnostic(code: ProjectMapStoreDiagnostic["code"], message: string, path = "$"): ProjectMapStoreDiagnostic {
	return { code, path, message, severity: "error" };
}

function readyWorktreeStoreDiagnostics(root: string): ProjectMapStoreDiagnostic[] {
	const descriptor = readProjectMapStoreDescriptor(root);
	if (descriptor.status === "ready") return [];
	if (descriptor.status === "missing") return [worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Project-map store has to be initialized first.")];
	return [worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Project-map store is not ready for worktree provisioning."), ...descriptor.diagnostics];
}

function appendUniqueDiagnostics(into: ProjectMapStoreDiagnostic[], entries: ProjectMapStoreDiagnostic[]): void {
	for (const entry of entries) if (!into.some((current) => current.code === entry.code && current.path === entry.path && current.message === entry.message && current.severity === entry.severity)) into.push(entry);
}

function planWorktree(options: InspectProjectMapWorktreeTargetOptions, run: typeof execFileSync = execFileSync): ProjectMapWorktreePlan {
	const inspection = inspectProjectMapWorktreeTarget(options);
	const diagnostics = [...inspection.diagnostics];
	if (!isIsoInstant(options.now)) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD, "Expected an ISO-8601 instant.", "$.now"));
	const store = resolveProjectMapStoreRoot(options.cwd);
	const ready = store.root === null ? [worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Project-map store root could not be resolved.")] : readyWorktreeStoreDiagnostics(store.root);
	appendUniqueDiagnostics(diagnostics, store.root === null ? [...store.diagnostics, ...ready] : ready);
	const head = gitResult(inspection.repository.root, ["rev-parse", "HEAD"]);
	const baseCommit = head.status === 0 ? head.output.trim() : null;
	if (baseCommit === null) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD, "Git HEAD could not be resolved, so no base commit is available."));
	if (store.root !== null && ready.length === 0 && isIsoInstant(options.now)) {
		const claim = readProjectMapClaim({ root: store.root, capabilityId: options.capabilityId, now: options.now });
		if (claim.status === "free" || claim.status === "stale") diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_CLAIM_REQUIRED, "A live capability claim is required before provisioning a worktree."));
		else if (claim.status === "corrupted" || claim.status === "unreadable") appendUniqueDiagnostics(diagnostics, claim.diagnostics);
		else if (claim.claim !== null && claim.claim.session_id !== options.sessionId) {
			const state = readProjectMapCoordinationState({ root: store.root, mapPath: join(options.cwd, PROJECT_MAP_ARTIFACT_PATH), now: options.now });
			if (state.lead.status !== "live" || state.lead.sessionId !== options.sessionId) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.CLAIM_HELD, "Capability claim is held by a live session."));
		}
	}
	const facts = worktreeRepositoryFacts(inspection.repository, inspection.identity.path, inspection.directory.exists);
	if (inspection.directory.insideCommonDir) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_PATH_ESCAPES, `Worktree target "${inspection.identity.path}" is inside Git common directory "${inspection.repository.commonDir}".`));
	if (inspection.directory.insideAnotherRepository) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_NESTED_REPOSITORY, `Worktree target "${inspection.identity.path}" is inside another repository.`));
	if (!inspection.repository.sameClone) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_FOREIGN_CLONE, `Worktree target "${inspection.identity.path}" belongs to a foreign clone.`));
	if (inspection.session.occupiedBy !== null) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_OCCUPIED, `Worktree target is occupied by session "${inspection.session.occupiedBy}".`));
	const targetBranch = facts.target === undefined ? { exists: false, isCurrent: false } : branchState(inspection.identity.path, inspection.identity.branch);
	const reusable = inspection.directory.exists && !inspection.directory.empty && facts.target !== undefined && facts.sameClone && facts.target.root === stableRealpath(inspection.identity.path) && targetBranch.exists && targetBranch.isCurrent && inspection.branch.exists;
	if (inspection.branch.exists && (!inspection.directory.exists || inspection.directory.empty)) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD, `Branch "${inspection.identity.branch}" exists without a worktree; attach it with "git worktree add ${inspection.identity.path} ${inspection.identity.branch}" or delete it with "git branch -D ${inspection.identity.branch}".`));
	if (!reusable && inspection.directory.exists && !inspection.directory.empty) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_TARGET_NOT_EMPTY, `Worktree target "${inspection.identity.path}" is not an empty directory or a reusable worktree.`));
	const status = reusable ? gitResult(inspection.identity.path, ["status", "--porcelain"], run) : null;
	const dirty = status !== null && status.status === 0 && status.output.trim() !== "";
	if (status !== null && status.status !== 0) diagnostics.push(worktreeDiagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD, "Git worktree status could not be read, so reuse cannot be verified."));
	if (diagnostics.some((entry) => entry.severity === "error")) return { inspection, decision: "refuse", command: null, baseCommit, dirty, diagnostics };
	if (reusable) return { inspection, decision: "reuse", command: null, baseCommit, dirty, diagnostics };
	return { inspection, decision: "create", command: ["git", "worktree", "add", "-b", inspection.identity.branch, inspection.identity.path, baseCommit as string], baseCommit, dirty: false, diagnostics };
}

export function planProjectMapWorktree(options: InspectProjectMapWorktreeTargetOptions & { run?: typeof execFileSync }): ProjectMapWorktreePlan {
	return planWorktree(options, options.run);
}
