import type { ProjectMapState } from "./shell-project-map-schema.ts";

/**
 * Integration readiness: which capability can be integrated next, and what is the
 * evidence?
 *
 * This module is a pure projection over already-read values — it performs no I/O of
 * its own, and every reader stays injected at the composition site, the same rule the
 * session-tab layer follows. It never writes, never merges and never resolves anything:
 * readiness is informational, exactly as a readiness receipt's `authority: "none"` says.
 */

export type ProjectMapIntegrationCheck = "verified" | "mismatched" | "unverified";

export interface ProjectMapIntegrationDiagnostic {
	code: string;
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface ProjectMapIntegrationChecks {
	dependencies: ProjectMapIntegrationCheck;
	contracts: ProjectMapIntegrationCheck;
	blockers: ProjectMapIntegrationCheck;
	coverage: ProjectMapIntegrationCheck;
	freshness: ProjectMapIntegrationCheck;
	conflicts: ProjectMapIntegrationCheck;
	verification: ProjectMapIntegrationCheck;
	tasks: ProjectMapIntegrationCheck;
	review: ProjectMapIntegrationCheck;
}

export interface ProjectMapIntegrationCandidate {
	capabilityId: string;
	outcome: string;
	state: ProjectMapState;
	branch: string | null;
	worktreeRoot: string | null;
	baseCommit: string | null;
	dependencyReady: boolean;
	complete: boolean;
	openBlockers: number;
	proposedContracts: number;
	nextSafeAction: string | null;
	verification: { command: string | null; source: "openspec-config" | "not-declared" };
	review: { lineages: number };
	tasks: { path: string; done: number; total: number } | null;
	checks: ProjectMapIntegrationChecks;
	ready: boolean;
}

export interface ProjectMapIntegrationReadiness {
	available: boolean;
	target: string | null;
	candidates: ProjectMapIntegrationCandidate[];
	diagnostics: ProjectMapIntegrationDiagnostic[];
}

export interface ProjectMapIntegrationCapability {
	id: string;
	outcome: string;
	state: ProjectMapState;
	dependsOn: readonly string[];
	contracts: readonly string[];
	featureDocs: readonly string[];
}

/** The checks a candidate must pass to be ready. Review is deliberately absent. */
export const PROJECT_MAP_INTEGRATION_GATING_CHECKS = ["dependencies", "contracts", "blockers", "coverage", "verification", "freshness", "conflicts", "tasks"] as const;

export interface ProjectMapIntegrationInput {
	map: { capabilities: readonly ProjectMapIntegrationCapability[] } | null;
	coordination: {
		satellites: readonly { capabilityId: string; sessionId: string }[];
		capabilities: readonly { capabilityId: string; dependencyReady: boolean; complete: boolean; openBlockers: number; proposedContracts: number; nextSafeAction: string }[];
		conflicts: readonly { code: string; capabilityId?: string; sessionId?: string; message: string }[];
	};
	worktreeBindings: readonly { capabilityId: string; sessionId: string; branch: string; worktreeRoot: string; baseCommit: string }[];
	/** The project's own test command, read from `openspec/config.yaml`; null when undeclared. */
	verification: { testCommand: string | null };
	/** The branch integration would land on, or null when it could not be resolved. */
	target: string | null;
	/** Review evidence per capability. Evidence only: it never gates a candidate. */
	review: ReadonlyMap<string, { lineages: number }>;
	tasks: ReadonlyMap<string, { path: string; done: number; total: number }>;
	/** Verification results supplied by the repository-facing slice; anything absent stays unverified. */
	checks: ReadonlyMap<string, Partial<ProjectMapIntegrationChecks>>;
	diagnostics?: readonly ProjectMapIntegrationDiagnostic[];
}

const CYCLE_CODE = "project-map-integration/dependency-cycle";

/**
 * Orders the candidates so a dependency always precedes the capability that depends
 * on it, breaking ties by id so the report is deterministic. A cycle cannot reach here
 * through the map's own validation, but if one does it is reported and the remaining
 * candidates are appended in id order rather than dropped.
 */
function orderCandidates(capabilities: readonly ProjectMapIntegrationCapability[], diagnostics: ProjectMapIntegrationDiagnostic[]): ProjectMapIntegrationCapability[] {
	const inScope = new Set(capabilities.map((capability) => capability.id));
	const remaining = new Map(capabilities.map((capability) => [capability.id, new Set(capability.dependsOn.filter((dependency) => inScope.has(dependency)))]));
	const ordered: ProjectMapIntegrationCapability[] = [];
	const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
	while (remaining.size > 0) {
		const ready = [...remaining.entries()].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
		if (ready.length === 0) {
			const stuck = [...remaining.keys()].sort();
			diagnostics.push({
				code: CYCLE_CODE,
				path: `$.capabilities.${stuck[0]}`,
				message: `A dependency cycle among ${stuck.join(", ")} prevents ordering; they are reported in id order instead.`,
				severity: "warning",
			});
			for (const id of stuck) {
				ordered.push(byId.get(id)!);
				remaining.delete(id);
			}
			break;
		}
		for (const id of ready) {
			ordered.push(byId.get(id)!);
			remaining.delete(id);
			for (const dependencies of remaining.values()) dependencies.delete(id);
		}
	}
	return ordered;
}

function check(value: boolean, whenFalse: ProjectMapIntegrationCheck = "mismatched"): ProjectMapIntegrationCheck {
	return value ? "verified" : whenFalse;
}

export function deriveProjectMapIntegrationReadiness(input: ProjectMapIntegrationInput): ProjectMapIntegrationReadiness {
	const diagnostics: ProjectMapIntegrationDiagnostic[] = [...(input.diagnostics ?? [])];
	if (input.map === null) return { available: false, target: input.target, candidates: [], diagnostics };

	const projected = new Map(input.coordination.capabilities.map((capability) => [capability.capabilityId, capability]));
	const verification = input.verification.testCommand === null
		? { command: null, source: "not-declared" as const }
		: { command: input.verification.testCommand, source: "openspec-config" as const };

	const candidates = orderCandidates(input.map.capabilities.filter((capability) => capability.state !== "done"), diagnostics).map((capability) => {
		const coverage = projected.get(capability.id);
		// The store keeps one worktree binding per capability, so the first match is the one.
		const binding = input.worktreeBindings.find((candidate) => candidate.capabilityId === capability.id);
		const supplied = input.checks.get(capability.id) ?? {};
		const checks: ProjectMapIntegrationChecks = {
			dependencies: check(coverage?.dependencyReady === true),
			contracts: check((coverage?.proposedContracts ?? 0) === 0),
			blockers: check((coverage?.openBlockers ?? 0) === 0),
			coverage: check(coverage?.complete === true),
			verification: check(verification.command !== null, "unverified"),
			freshness: supplied.freshness ?? "unverified",
			conflicts: supplied.conflicts ?? "unverified",
			tasks: supplied.tasks ?? "unverified",
			review: supplied.review ?? "unverified",
		};
		return {
			capabilityId: capability.id,
			outcome: capability.outcome,
			state: capability.state,
			branch: binding?.branch ?? null,
			worktreeRoot: binding?.worktreeRoot ?? null,
			baseCommit: binding?.baseCommit ?? null,
			dependencyReady: coverage?.dependencyReady === true,
			complete: coverage?.complete === true,
			openBlockers: coverage?.openBlockers ?? 0,
			proposedContracts: coverage?.proposedContracts ?? 0,
			nextSafeAction: coverage?.nextSafeAction ?? null,
			verification,
			review: { lineages: input.review.get(capability.id)?.lineages ?? 0 },
			tasks: input.tasks.get(capability.id) ?? null,
			checks,
			ready: capability.state !== "blocked" && PROJECT_MAP_INTEGRATION_GATING_CHECKS.every((name) => checks[name] === "verified"),
		};
	});

	return { available: true, target: input.target, candidates, diagnostics };
}
