# Artifact language — a setting, not a fork of the default

Status: **authorized 2026-09-27.** The user's words: *"lo que dicce el documento es lo importante y sigue en ingles, quiero que para todas las sesiones y proyectos este en español"*.

## Objective

Let the language the prompt asks for be configured per project or per machine, so a reader whose documents are the product gets Spanish prose everywhere without forking the package default — and so the Project Map's `?` explanation, which quotes those documents, speaks their language.

## Problem

1. **The explanation's important half was English.** The `?` modal's own labels were translated, but the part the user reads — the description, which is the work item's body from an ODD document — stayed English, because the documents are English.
2. **The documents are English by policy.** The always-on prompt (`assets/orchestrator.md`) states that generated technical artifacts default to English, and `assets/orchestrator-delegation.md` repeats it for subagents. So every session, in every project, authors English documents.
3. **The default is not the user's to change.** Flipping the package default to Spanish would push one reader's preference onto everyone who installs gentle-pi, and the rule the user needs is narrower than "everything": the prose they read should be Spanish, and the code they and their tooling read should not.

## Decisions

**A. The language is a resolved setting, mirroring the background-subagents policy.** `lib/artifact-language.ts` resolves project file > global file > environment > default, with the same strict decode, the same fail-closed behavior on a malformed file, and the same injectable sources so tests never touch the real home. The default stays `en`: the package is unchanged for anyone who installs it.

**B. The prompt carries the value, not the policy.** The core asset keeps one sentence and a placeholder — `Generated artifacts follow the configured artifact language: {{GENTLE_PI_ARTIFACT_LANGUAGE}}.` — and `renderOrchestratorPrompt` substitutes the resolved directive. The directive is a whole sentence because the sentence it replaces was one, and both values are measured against the prompt's 8,192 B budget by the test suite rather than trusted.

**C. The split is by audience, and it is explicit.** With `es`, human-facing prose — ODD/SDD unit and task documents, and the UI copy that quotes them — is Spanish; code, comments, identifiers, commit messages, filenames, tests, fixtures, prompt templates, and machine-facing files stay English. Identifiers, filenames and commit messages are read by tooling and by everyone, so translating them would be damage, not preference.

**D. The delegation asset points instead of repeating.** `assets/orchestrator-delegation.md` is a lazy asset the agent reads raw, so a placeholder there would reach the reader unresolved. Its copy of the rule now states the split and points at the always-on prompt for the value.

## Slices

- **PMLG-1 — the resolver.** `lib/artifact-language.ts` and `tests/artifact-language-setting.test.ts`.
- **PMLG-2 — the prompt.** The placeholder in both assets, the substitution and cache key in `gentle-ai.ts`, and the three test files that pin the old wording.
- **PMLG-3 — the machine.** The global file written to `~/.pi/gentle-ai/artifact-language.json` with `es`, so every session and project of this user gets it.
- **PMLG-4 — the documentation.** `docs/readme-reference.md`, next to the policy it mirrors.

## Acceptance criteria

1. A project file outranks the global file, which outranks the env var, which outranks the `en` default; a malformed file fails closed to `en` and is not skipped for a lower source.
2. The rendered always-on prompt carries the resolved directive for both languages, with no unresolved placeholder, inside the canonical 8,192 B budget.
3. The core asset keeps the rule verbatim around the placeholder, so the disposition map and the persona single-channel guards stay honest.
4. With the global file set to `es`, a session in any project resolves `es` from `global_file`.
5. Focused suites, the full unit suite and the type baseline stay green.

## Non-goals

- Translating the documents that already exist. The setting governs what is authored from now on; the Project Map keeps quoting English until those documents are rewritten, and rewriting them changes the capability identifiers the titles generate, which regenerates the map and drops its declarations and approval.
- Translating the package's own reference documentation, or any prompt template. Those stay English, which is why the directive says so.
- A `/gentle:` command to report or write the setting. The background-subagents policy has one; this does not, yet.
