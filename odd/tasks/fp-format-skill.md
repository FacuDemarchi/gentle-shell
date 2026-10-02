# FP formatting skill for Gentle

Status: source content independently verified; commit and local activation explicitly authorized, delivery in progress.
Repository: release worktree `/home/facundo/projects/gentle-v4.0.0`.
Branch: `feat/fp-format-skill`, based on release `v4.0.0` (`1f35ab1e`).

## Authorization and objective

The user approved the proposal: "apruebo la propuesta, procede".
Deliver the first unit: a reusable `gentle-ai-fp-format` skill, a Spanish narrative template and examples, plus packaged discovery integration. Normalize functional-point documentation inside ODD without creating another source of truth.
The user subsequently selected `commit_and_activate`: commit the verified unit and activate the local 4.0.0 checkout in the user environment. No push/publication is authorized. Preserve unrelated settings and distinguish persistent registration, runtime loading, and registry refresh.

## Problem and rationale

Gentle 4.0.0 provides stable-ID ODD task documents but no universal FP hierarchy or per-subtask explanation convention. A scoped skill can guide consistent drafting; it does not replace structural validation or make the Project Map consume new fields automatically.

## Scope and constraints

- Write skill instructions and repository integration in English; the approved FP narrative, template and example prose are in Spanish.
- Preserve identifiers, states, exact paths/commands/API names, dependencies, and verification evidence.
- Preserve existing technical meaning; report missing information instead of inventing it.
- Preserve the fork-compatible `**Belongs to:**` metadata as a proposed FP document convention, not an existing universal 4.0.0 guarantee.
- Existing-document normalization or translation produces a proposal before applying; do not perform any conversion in this unit.
- Discovery is an intent hint, not guaranteed autorun or runtime enforcement.
- No validator, parser/map changes, automatic refresh, task execution, global language policy, unrelated global installation, version bump, publication, or unrelated fork changes. Only the specifically authorized local checkout activation is permitted.
- The release worktree owns these changes; the session fork remains untouched.

## Allowed edit surfaces

- `skills/fp-format/SKILL.md`
- `skills/fp-format/assets/fp-document-template.md`
- `skills/fp-format/assets/fp-document-example.md`
- `skills/fp-format/references/format-rules.md`
- `assets/orchestrator-skills.md`
- `scripts/verify-package-files.mjs`
- `tests/verify-package-files.test.ts` only if an applicable packaging regression test is needed.

The parent alone maintains this feature document and its memory mirror.

## Work unit

- [ ] **FPF-1 — Deliver the packaged FP formatting skill and verify its integration.**
  - Provide a compact, trigger-rich skill with preservation rules and Spanish FP narrative defaults.
  - Provide a reusable template and a clearly illustrative example, including per-subtask explanation, acceptance and evidence without fabricated project facts.
  - Add a scoped FP discovery hint without changing mirrored ODD lifecycle/routing.
  - Enumerate all new shipped assets in the package guard.
  - Observe applicable structural and packaging checks and review the resulting diff.
  - Record the now explicitly authorized work-unit commit after the verified source and staged scope are checked.

- [ ] **FPF-2 — Activate the authorized local checkout and verify skill discovery/registry.**
  - Map the existing launcher/package-registration behavior and exact settings/generated-index surfaces before changing them.
  - Use supported target-scoped activation; preserve unrelated packages/settings and avoid duplicate Gentle extension loading.
  - Refresh the registry using existing code/command in the correct project context when technically available.
  - Verify registration/discovery; do not claim the current live session has reloaded without observed evidence.
  - Record reversible configuration effects and checks in this document; retain pending live-session actions honestly.
  - Commit the repository-facing activation evidence after the outcome is observed; never commit credentials or user configuration.

## Verification

Passive skill/template documentation has no meaningful executable RED; use structural and packaging checks. If executable behavior is introduced, stop and use a focused deterministic RED/GREEN regression instead.

From the release worktree:

- `node --test tests/verify-package-files.test.ts`
- `node --test tests/skill-registry.test.ts`
- `node scripts/verify-package-files.mjs`
- `git diff --check`

Additionally inspect frontmatter, skill name/length, relative links, preservation constraints, Spanish template/example narrative, package path enumeration, and the absence of edits outside the allowed surfaces. Generate the ignored registry only if a documented local refresh is available without global installation or unrelated side effects; otherwise record refresh as pending, not as a completed load or installed skill.

## Progress and evidence

- Read-only mapping completed; feature branch created from the 4.0.0 release.
- Worktree was clean before the feature document was created.
- Writer produced six source files (reported 272 additions) and no commit.
- Writer checks: package guard tests 9/9 passed; skill registry tests 18/18 passed; package resource guard passed (159 resources, 69 byte-pinned artifacts); diff whitespace check passed.
- Parent readback found and the writer corrected the template mismatch: `Belongs to` is now one document-level declaration at line 3 in template/example, before the first checkbox, with a single backticked code. Skill and format rules now require clarification rather than automatic reparenting for malformed/ambiguous declarations.
- Post-correction writer checks: package guard tests 9/9 and skill registry tests 18/18 passed; package guard passed (159 resources, 69 byte-pinned artifacts); diff whitespace check passed.
- Native assessment returned `unassessable` because intended untracked files were undeclared; its plan requires writer self-verification plus an independent verifier. Do not infer a risk tier from the task description or mutate review authority to bypass this.
- Independent verifier: completed with no severe candidate findings; six candidate source paths, 284 added lines, zero deletions (279 lines in the four new skill files; tracking document excluded).
- Independent checks after correction: `node --test tests/verify-package-files.test.ts` 9 passed, 0 failed/skipped; `node --test tests/skill-registry.test.ts` 18 passed, 0 failed/skipped; `node scripts/verify-package-files.mjs` passed (159 resources, 69 byte-pinned artifacts); `git diff --check` passed.
- Parent spot check: corrected template membership at line 3 confirmed; `git diff --check` rerun passed; original session fork `git status --short` empty.
- Registry refresh and runtime activation: not performed. The documented launcher is `gentle-shell --link --package-root /home/facundo/projects/gentle-v4.0.0`; a session rooted in this checkout can run `/skill-registry:refresh`. Neither invocation was authorized/executed; packaged source is not claimed installed, loaded, or refreshed.
- Preexisting follow-up: `skills/skill-registry/SKILL.md` references absent `skills/_shared/skill-resolver.md`; left untouched, not a candidate blocker.
- Full suite/build/live-session behavior: not run; passive documentation and package enumeration were checked proportionately. RED/GREEN lifecycle not applicable to this documentation unit.
- Native review: clone-local RDD is off in the host; no review authority is created by this document.
- Commit and local activation: explicitly authorized by `commit_and_activate`; source commit about to be created. No push.

## Next step

Commit FPF-1 on the feature branch, then use the read-only activation map to derive FPF-2's narrow edit/configuration surfaces and verification. Validator and Project Map adaptation remain outside these units.
