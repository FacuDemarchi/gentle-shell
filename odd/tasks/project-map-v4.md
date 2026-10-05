# Project Map on the 4.0.0 base, for every project

Status: **authorized 2026-10-05 (D1–D5). PMV-1 in progress.**

Owning worktree: `/home/facundo/projects/project-map-v4` (worktree of the `project-map-preview` clone).
Branch: `feat/project-map-v4`, based on `feat/fp-format-skill` = release tag `v4.0.0` (`1f35ab1e`) plus three FP-skill commits, tip `5ac56e8c`.

Base rationale: D1=b ports only the map onto the 4.0.0 release and leaves the fork's 227 own commits behind. The FP skill belongs to this unit (D5=a modifies it), so this branch carries it and no separate base is needed.

## Authorization (user decisions, 2026-10-05)

- **D1=b** — Port only the map to `v4.0.0` as a new branch, leaving the rest of the fork behind; then link that checkout as the harness so `/gentle:project-map` exists in every project.
- **D2=a** — Zero friction: the map derives itself in a project and the card appears with that project's data already set; no manual `declare`/`approve` step.
- **D3=b** — No persisted artifact and no `openspec/` (the 4.0.0 release dropped it). The map is derived in memory on each session; the artifact-config path (`openspec/config.yaml` → `project_map.*`) disappears with it.
- **D4=a** — The executable gate stays opt-in. `GENTLE_PI_PROJECT_MAP` keeps gating exactly `worktree provision`, `open`, `lead`/`contract` and `integrate`; the documentation half and the card stay free. This is consistent with the user's earlier decision to postpone delegation until further notice. If the orchestration half is ever wanted ambient, the right move then is a persisted per-project setting, not an environment variable — a separate unit.
- **D5=a** — `**Allowed edit surfaces:**` becomes part of the FP format in `skills/fp-format`, and the harness maps it with a canonical surface table that lives in the harness, not in each project.

## Objective

Make `/gentle:project-map` the living, normalized documentation surface of any project: the row is the project's `FP-N` functional point, the `?` explains it together with its sub-elements, and the card renders at the bottom of the rail with the project's data already set — on the 4.0.0 base, with the FP format as the single contract.

## Problem

1. **The feature is not installed anywhere.** The running harness is the published `gentle-pi` 4.0.0 npm package, whose `extensions/` has no `gentle-project-map.ts`; the map lives only on a branch based on a 3.7-era tree (`v4.0.0` is not an ancestor: 227 ahead, 98 behind). Nothing works in any project until the feature runs on the 4.0.0 base.
2. **The map cannot populate itself.** Today a project opts in by having an artifact, and only `surfaces` has a command writer; `outcome`, `state`, `dependsOn` and `foundationRefs` are only ever written by the generator. With D2=a/D3=b there is no artifact to opt in with, so derivation must be complete and in memory.
3. **The source format was per-project convention.** Rows, sub-element membership and surfaces were derived from code shapes and from `openspec/config.yaml` mappings — different in every project. D5=a replaces that with one contract: the FP format.

## Scope and non-goals

In scope: the port to the 4.0.0 base; in-memory derivation in any project; the FP format as the read contract, including `**Allowed edit surfaces:**` and the canonical surface mapping; reporting documents the map cannot read; the rail card at the bottom with data already set; installing the checkout as the harness.

Non-goals: the delegation half (postponed by the user — the gate stays on); no `openspec/**` is created; the fork's `odd/` backlog and its `openspec/**` artifacts are not ported; no behavior change to the executable routes beyond keeping the gate semantics on the new base.

Operating constraints from the user: no push and no commit without an explicit go; single-threaded writes; technical artifacts in English.

## Allowed edit surfaces

Ported product files (measured inventory below), plus these shared files, restricted to our own delta:

- `extensions/gentle-shell.ts`
- `lib/shell-sidebar-layout.ts`
- `lib/shell-sidebar.ts`
- `scripts/verify-package-files.mjs`
- `package.json`
- `tests/gentle-shell.test.ts`, `tests/shell-sidebar-layout.test.ts`, `tests/shell-sidebar.test.ts`
- `docs/project-map.md`, `docs/gentle-shell.md`, `docs/readme-reference.md`, `README.md`, `assets/orchestrator-memory.md`
- `skills/fp-format/SKILL.md`, `skills/fp-format/assets/fp-document-template.md`, `skills/fp-format/assets/fp-document-example.md`, `skills/fp-format/references/format-rules.md`
- `odd/tasks/project-map-v4.md` (this document; the parent alone maintains it and its memory mirror)

Never created: `openspec/**`.

## Port inventory (measured 2026-10-05)

`git diff --name-status v4.0.0...feat/project-map-orchestration` — the three-dot diff from the merge-base, so only our own side appears. The plain two-dot diff is dominated by 4.0.0 features the fork lacks and must not be used for the port.

- Own additions: 106 files — 38 tests, 28 `lib/` modules, 31 `odd/tasks` (fork backlog, not ported), 3 `openspec/**` (not ported), 2 `odd/` mirrors, 1 `extensions/gentle-project-map.ts`, 1 `docs/project-map.md`.
- Shared files carrying our own delta: 11 — `README.md`, `assets/orchestrator-memory.md`, `docs/gentle-shell.md`, `docs/readme-reference.md`, `extensions/gentle-shell.ts`, `lib/shell-sidebar-layout.ts`, `lib/shell-sidebar.ts`, `scripts/verify-package-files.mjs`, `tests/gentle-shell.test.ts`, `tests/shell-sidebar-layout.test.ts`, `tests/shell-sidebar.test.ts`.
- No deletions on our side.

## Environment risk (measured)

- `@earendil-works/pi-tui >= 1.0.0` is a devDependency of the 4.0.0 tree and is **not resolvable on this machine**: the only copy is `0.85.1`, inside the fork's `node_modules`. `pnpm` and `corepack` are absent; `node v26.8.1` and `npm 11.19.0` are present; the new worktree has no `node_modules`.
- If the dependency tree cannot be resolved, the gates report `unverified` with that named cause and this unit does not claim green. It never claims a pass it did not run.

## Work units

- [x] **PMV-1 — Port the map onto the 4.0.0 base.**
  - Bring the own-addition product files over (`lib/project-map-*`, `lib/shell-project-map-*`, `extensions/gentle-project-map.ts`, `docs/project-map.md`, the map tests), excluding `openspec/**` and the fork's `odd/**`.
  - Re-apply our own delta of each of the 11 shared files onto the 4.0.0 versions of those files.
  - Resolve the dependency tree enough to run the test suite, and record the resolved `pi-tui` version.
  - Reconcile the integration points against 4.0.0's changed shell internals without changing product behavior; report whatever needs a decision instead of inventing one.
  - Observe: the map's focused tests, the full suite, `check-types`, `verify-package-files`, and `git diff --check` by exit code.

- [ ] **PMV-2 — Derive the map in memory for every project.**
  - Rows come from the project's `FP-N` functional points; sub-elements come from a document-level `**Belongs to:**` declaration or from continued sub-numbering.
  - No artifact is written and no `openspec/` is required; the derivation is read-only, per session, in any repository.
  - The card renders at the bottom of the rail with the project's data already set (D2=a, D4=a semantics).
  - Observe: a repository with no map artifact shows a populated card; a repository with no recognizable documentation says so instead of rendering an empty map.

- [ ] **PMV-3 — Make the FP format the contract.**
  - Add `**Allowed edit surfaces:**` to the FP format: skill instructions, template, format rules.
  - Map those declarations onto the canonical surface table inside the harness; remove the per-project `project_map.*` configuration path.
  - Observe: a project whose FP documents declare surfaces yields coverage with no configuration file of its own.

- [ ] **PMV-4 — Report documents the map cannot read.**
  - The three extraction failure modes are silent today: prose after the closing `**` makes a work unit invisible without an omission; an over-long normalized title is dropped; an unrecognized document shape contributes nothing.
  - Making them visible is what makes "for all projects" honest: the card or the command must name what it could not read.
  - Observe: each failure mode produces a named, reported omission.

- [ ] **PMV-5 — Install and verify in a second project.**
  - Link this checkout as the harness and confirm the command and the card in a project that is not this repository.
  - Record the exact install command and the observed result, including whether a restart is required.

## Verification plan

Behavior changes with runnable deterministic tests use focused RED/GREEN first, then the full suite, `check-types`, `verify-package-files` and `git diff --check` by exit code. Passive documentation changes use structural checks instead. The port itself is a migration: its evidence is the gate output on the new base plus a behavior comparison against the fork's HEAD for the map's own tests.

Native review runs only under the user's switch; the candidate is a work-unit commit or a PR slice, never this checklist.

## Progress and evidence

- 2026-10-05: worktree and branch created at `5ac56e8c`; port inventory and environment risk measured; this document written before the first source write.
- 2026-10-05, PMV-1 pass 1 (worker; no commit, no push): imported 68 own-addition files (28 `lib/` modules, `extensions/gentle-project-map.ts`, `docs/project-map.md`, 38 test files) plus our own delta of all 11 shared files. No `openspec/**` created or imported; the untracked `odd/tasks/project-map-v4.md` preserved; no assertion changed.
  - Gates: focused `tests/*project-map*.test.ts` exit 1 — 756 tests, 754 passed, 2 failed. Full suite exit 1 — 4,673 tests, 4,633 passed, 21 failed, 19 skipped; the provider-contract and runtime-harness stages could not start (`pnpm` absent). `check-types` exit 1 — 226 diagnostics against a recorded 200, 12 file/code pairs above their recorded counts. `verify-package-files` exit 0 (188 files, 69 byte-pinned). `git diff --check` exit 0.
  - Attribution as measured: 18 failures are environment (`pi-tui` 0.85.1 has no `colorToRgb`; SDK `createCodemodeExtension` missing; installed SDK 0.85.1 below the required range), 1 is the base conflict recorded below, 2 are unattributed.
- 2026-10-05, environment correction measured by the parent: the running Pi's own bundled tree carries exactly the versions the 4.0.0 base declares — `@earendil-works/{pi-tui,pi-ai,pi-agent-core,pi-codemode,pi-telemetry,chord,pi-mcp}` and `pi-coding-agent`, all `1.0.0`, under `/home/facundo/.nvm/versions/node/v26.8.1/lib/node_modules/@earendil-works/`. `pi-tui` 1.0.0 does export `colorToRgb`. The 18 environment failures are therefore locally resolvable without fetching anything.
- 2026-10-05, PMV-1 pass 2 (worker; no commit, no push): the local `node_modules` was built from the sibling's installed entries plus links to the eight authorized `1.0.0` packages (`pi-tui`, `pi-ai`, `pi-agent-core`, `pi-codemode`, `pi-telemetry`, `chord`, `pi-mcp`, `pi-coding-agent`); the preserved legacy symlink lives at `node_modules-sibling-link` and the resource guard stayed at exit 0 with 188 files and 69 pinned artifacts. No network fetch, no assertion relaxed.
  - The float-card geometry was reconciled in `lib/shell-project-map-card.ts` (shared panel widths, float body-row offsets and margins for rendering, clicks and reveals; style now included in the digest), with new float/neon geometry coverage in `tests/shell-project-map-card.test.ts`.
  - The config test's input moved into its own temporary fixture in `tests/project-map-integration-documents.test.ts`; the command assertion is unchanged.
  - Gates: focused `tests/*project-map*.test.ts` **exit 0 — 769 tests, 769 passed, 0 failed**. Full suite exit 1 — 5,353 tests, 5,307 passed, 2 failed, 44 skipped; the unit stage fails only on the two base failures below, and the provider-contract and runtime-harness stages cannot start (`pnpm` absent). `check-types` **exit 0 — 187 diagnostics against a recorded 200, no regressions** (the drop from 226 is the environment fix, not a baseline edit). `verify-package-files` exit 0. `git diff --check` exit 0.
  - Attribution: every one of the 18 environment failures is eliminated; no port failure remains; nothing is unattributed.
  - The two remaining full-suite failures (`tests/review-host-relay-routing.test.ts` lines 405 and 1317) are **verified base failures**: the parent reproduced the identical mismatch on the pristine base `5ac56e8c` in the untouched `gentle-v4.0.0` worktree, with the same 1.0.0 SDK, and the failing entry imports none of the runtime files this port modifies.

## Open obligations

- **The verification command has no declared home after 4.0.0.** Resolved for the port by moving the test's input into its own temporary fixture; it no longer pins this repository. Where a 4.0.0 project declares its test command is still unresolved and belongs to PMV-3.
- **Two base failures, owned by nobody in this unit**: `tests/review-host-relay-routing.test.ts` lines 405 and 1317, reproduced on the pristine base. They are 4.0.0's own red tests, outside this port's scope; recorded so they are never mistaken for port damage.
- **Two gates stay `unverified`**: the provider-contract and runtime-harness stages cannot start without `pnpm`, which is absent from this environment.
- **Dependency links depend on the global Pi install.** The eight `1.0.0` packages are linked from `/home/facundo/.nvm/.../lib/node_modules/@earendil-works/`. They follow the installed Pi version; a Pi upgrade can move them and must be re-checked before trusting the local gates.
- `scripts/types-baseline.json` was deliberately kept outside the allowed surfaces and was not modified: the delta was attributed by file and code and reported instead.

## Next step

PMV-2: derive the map in memory for every project. Proposed rule, open to veto: a project declares nothing at all — the `FP-N` convention from the FP format is the whole contract, rows are the `FP-N` units found in the project's own documents, sub-elements come from a document-level `**Belongs to:**` or from continued sub-numbering, and a project with no readable functional points says so instead of rendering an empty map. The artifact path stays as it is, unused by the display half and still read by the gated executable half.
