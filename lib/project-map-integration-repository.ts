import { execFileSync } from "node:child_process";
import { reviewGitEnvironment } from "./review-repository.ts";
import type { ProjectMapIntegrationCheck, ProjectMapIntegrationDiagnostic } from "./project-map-integration.ts";

/**
 * The repository-facing half of integration readiness.
 *
 * Every Git call is a query: nothing is staged, committed, merged or resolved, and the
 * changed-path overlap this module reports is a *likely* conflict signal, never a proof.
 * The executor is injected so the unit is testable without a real repository, and the
 * default one reuses the review tool's environment sanitisation rather than inventing a
 * second copy of a security-relevant function.
 */

/**
 * A flat result rather than a discriminated union: this repository runs with
 * `strict: false`, and TypeScript does not narrow a union by its discriminant under
 * that setting, so `if (!result.ok) result.reason` would not type-check.
 * `output` is present when `ok` is true and `reason` when it is false.
 */
export interface ProjectMapIntegrationGitOutcome {
	ok: boolean;
	output?: string;
	/**
	 * The process exit code, present only when the command actually ran and exited non-zero.
	 * It is absent when the command could not be run at all, so a caller can tell a Git
	 * answer ("this is not an ancestor") from a failure to ask ("the query broke").
	 */
	exitCode?: number;
	reason?: string;
}
export type ProjectMapIntegrationGitExecutor = (arguments_: readonly string[], cwd: string) => ProjectMapIntegrationGitOutcome;

/** Runs a read-only Git query and reports failure as a value instead of throwing. */
export function projectMapIntegrationGitExecutor(): ProjectMapIntegrationGitExecutor {
	return (arguments_, cwd) => {
		try {
			const environment = reviewGitEnvironment();
			const output = execFileSync("git", ["-C", cwd, ...arguments_], { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
			return { ok: true, output: String(output) };
		} catch (error) {
			const status = (error as { status?: unknown } | null)?.status;
			const exitCode = typeof status === "number" ? status : undefined;
			const reason = error instanceof Error ? error.message : String(error);
			return exitCode === undefined ? { ok: false, reason } : { ok: false, exitCode, reason };
		}
	};
}

function diagnostic(code: string, path: string, message: string): ProjectMapIntegrationDiagnostic {
	return { code, path, message, severity: "warning" };
}

/**
 * The integration target is the branch the **main** worktree is on — the first entry of
 * `git worktree list`, which is the primary checkout. Nothing else is assumed: a detached
 * main worktree, or a list that cannot be read, leaves the target unknown, and every
 * freshness and overlap answer that depends on it then stays unverified.
 */
export function resolveProjectMapIntegrationTarget(options: { cwd: string; run: ProjectMapIntegrationGitExecutor }): { target: string | null; diagnostics: ProjectMapIntegrationDiagnostic[] } {
	const listed = options.run(["worktree", "list", "--porcelain"], options.cwd);
	if (!listed.ok) return { target: null, diagnostics: [diagnostic("project-map-integration/target-unresolved", "$.target", `The worktree list could not be read, so the integration target is unknown: ${listed.reason ?? "unknown failure"}`)] };
	const lines = (listed.output ?? "").split("\n");
	const first = lines.findIndex((line) => line.startsWith("worktree "));
	if (first === -1) return { target: null, diagnostics: [diagnostic("project-map-integration/target-unresolved", "$.target", "The worktree list named no worktree, so the integration target is unknown.")] };
	for (let index = first + 1; index < lines.length; index++) {
		const line = lines[index]!;
		if (line.startsWith("worktree ")) break;
		if (line.startsWith("branch refs/heads/")) return { target: line.slice("branch refs/heads/".length).trim(), diagnostics: [] };
	}
	return { target: null, diagnostics: [diagnostic("project-map-integration/target-detached", "$.target", "The main worktree has a detached HEAD, so there is no branch to integrate into.")] };
}

export interface ProjectMapIntegrationFreshness {
	check: ProjectMapIntegrationCheck;
	/** How many commits the target has that the branch base does not, when it could be measured. */
	behindBy: number | null;
	reason?: string;
}

/**
 * Freshness asks whether the branch's base is still contained in the integration target.
 * A base the target does not contain means the branch has diverged, which is a mismatch
 * rather than a distance; a base that is merely old is verified and its distance is
 * reported, because being behind is information, not a defect.
 *
 * `git merge-base --is-ancestor` exits 1 for a genuine non-ancestor, but it also fails
 * when the query itself cannot run (a broken revision, an unreadable object). Only the
 * first is a divergence; the second stays unverified, because reporting it as divergence
 * would claim something Git never said.
 */
export function checkProjectMapIntegrationFreshness(options: { cwd: string; run: ProjectMapIntegrationGitExecutor; target: string | null; baseCommit: string | null }): ProjectMapIntegrationFreshness {
	if (options.target === null || options.baseCommit === null) return { check: "unverified", behindBy: null, reason: "the integration target or the branch base is unknown" };
	const contained = options.run(["merge-base", "--is-ancestor", options.baseCommit, options.target], options.cwd);
	if (!contained.ok) {
		if (contained.exitCode === 1) return { check: "mismatched", behindBy: null, reason: `the branch base is not contained in ${options.target}, so the branch has diverged` };
		return { check: "unverified", behindBy: null, reason: `it could not be checked whether the branch base is contained in ${options.target}: ${contained.reason ?? "unknown failure"}` };
	}
	const counted = options.run(["rev-list", "--count", `${options.baseCommit}..${options.target}`], options.cwd);
	if (!counted.ok) return { check: "unverified", behindBy: null, reason: `the distance to ${options.target} could not be measured: ${counted.reason ?? "unknown failure"}` };
	const behindBy = Number.parseInt((counted.output ?? "").trim(), 10);
	if (!Number.isFinite(behindBy)) return { check: "unverified", behindBy: null, reason: `the distance to ${options.target} was not a number` };
	return { check: "verified", behindBy };
}

export interface ProjectMapIntegrationOverlap {
	check: ProjectMapIntegrationCheck;
	/** The paths this candidate shares with another candidate, sorted. Empty when none are shared. */
	overlaps: string[];
	reason?: string;
}

/**
 * Likely conflicts are changed-path overlap between candidates, measured against the
 * integration target's merge base. `mismatched` here means *a likely conflict was
 * detected* and never *a conflict was proven*: nothing is merged, and a shared path is a
 * reason for a human to look, not a verdict.
 */
export function checkProjectMapIntegrationOverlap(options: {
	cwd: string;
	run: ProjectMapIntegrationGitExecutor;
	target: string | null;
	candidates: readonly { capabilityId: string; branch: string | null }[];
}): Map<string, ProjectMapIntegrationOverlap> {
	const results = new Map<string, ProjectMapIntegrationOverlap>();
	if (options.target === null) {
		for (const candidate of options.candidates) results.set(candidate.capabilityId, { check: "unverified", overlaps: [], reason: "the integration target is unknown" });
		return results;
	}
	const touched = new Map<string, string[]>();
	for (const candidate of options.candidates) {
		if (candidate.branch === null) {
			results.set(candidate.capabilityId, { check: "unverified", overlaps: [], reason: "the capability has no branch to compare" });
			continue;
		}
		const diffed = options.run(["diff", "--name-only", `${options.target}...${candidate.branch}`], options.cwd);
		if (!diffed.ok) {
			results.set(candidate.capabilityId, { check: "unverified", overlaps: [], reason: `the changed paths could not be read: ${diffed.reason ?? "unknown failure"}` });
			continue;
		}
		touched.set(candidate.capabilityId, (diffed.output ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== ""));
	}
	const owners = new Map<string, string[]>();
	for (const [capabilityId, paths] of touched) for (const path of paths) owners.set(path, [...(owners.get(path) ?? []), capabilityId]);
	const shared = [...owners.entries()].filter(([, holders]) => holders.length > 1).map(([path]) => path).sort();
	for (const [capabilityId] of touched) {
		const overlaps = shared.filter((path) => owners.get(path)!.includes(capabilityId));
		results.set(capabilityId, overlaps.length === 0
			? { check: "verified", overlaps: [] }
			: { check: "mismatched", overlaps, reason: `likely conflict with ${shared.length === 1 ? "another candidate" : "other candidates"} on ${overlaps.length} shared path(s)` });
	}
	return results;
}
