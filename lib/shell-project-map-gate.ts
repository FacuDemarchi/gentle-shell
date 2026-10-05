/**
 * The opt-in gate for the Project Map's executable half.
 *
 * The feature is one command with two halves. The plan half — reading, drafting, declaring and
 * approving the artifact, and the card that renders it — is reachable whenever a repository has
 * an artifact, and creating that artifact is how a project opts in. The executable half acts
 * outside the artifact: it provisions worktrees and branches, it starts Pi sessions, and it
 * writes the shared coordination store. Those actions stay off until the user says otherwise in
 * so many words, because a scheme that mutates a repository and a cross-worktree store is worth
 * a switch of its own until its schemas and its recovery behavior have been exercised.
 *
 * The switch is an environment predicate rather than a persisted setting, following the
 * repository's own idiom (`GENTLE_PI_AGENTS`, `GENTLE_PI_TODO`): a shell surface that has no
 * settings file cannot grow one for a single feature, and an environment variable is visible in
 * the process that honors it. It is deliberately fail-closed: only an explicit on-value enables
 * the half, and an unrecognized value leaves it off while naming the value it did not understand.
 */
export const PROJECT_MAP_EXECUTABLE_ENV = "GENTLE_PI_PROJECT_MAP";

const ENABLING_VALUES = ["1", "true", "on"] as const;

/** True only for an explicit on-value; anything else, including an attempt, is off. */
export function projectMapExecutableEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env[PROJECT_MAP_EXECUTABLE_ENV]?.trim().toLowerCase();
	return value !== undefined && (ENABLING_VALUES as readonly string[]).includes(value);
}

/**
 * The refusal for a gated route, or `undefined` when the gate is open.
 *
 * The message names the switch and every value that opens it, and — when the value was set but
 * not understood — names that value too, so a typo is reported instead of looking like a feature
 * that ignores an explicit request.
 */
export function projectMapExecutableRefusal(env: NodeJS.ProcessEnv = process.env): string | undefined {
	if (projectMapExecutableEnabled(env)) return undefined;
	const observed = env[PROJECT_MAP_EXECUTABLE_ENV]?.trim();
	const enabling = ENABLING_VALUES.join(", ");
	return [
		"The Project Map executable surfaces are disabled: provisioning a worktree, opening Pi, and",
		"writing the coordination store stay off until they are explicitly enabled.",
		observed === undefined || observed.length === 0
			? `Set ${PROJECT_MAP_EXECUTABLE_ENV}=1 to enable them (accepted values: ${enabling}).`
			: `${PROJECT_MAP_EXECUTABLE_ENV}="${observed}" is not one of ${enabling}; set it to one of those to enable them.`,
	].join(" ");
}
