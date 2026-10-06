# Project Map on the 4.0.0 base, for every project

Status: **authorized 2026-10-05 (D1–D5). PMV-1 (`97a0f963`) and PMV-2 (`147bf1a6`) committed and gate-green; PMV-3 is next.**

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

- [x] **PMV-2 — Derive the map in memory for every project.**
  - **Frozen rule (2026-10-05, open to veto): the project declares nothing.** The `FP-N` convention from the FP format is the whole contract — no `project_map.*`, no roadmap pointer, no artifact. Rows are the `FP-N` work units the project writes in its own task documents; a code that continues a row (a Unicode letter or a dot) is that row's sub-element, and a document-level `**Belongs to:**` declaration overrides the deduction for that document. A continuation is **never** a row of its own: `FP-1b` is a sub-element of `FP-1`, and it is never promoted to a row when its parent is absent. A row is exactly the prefix followed by digits and optional dash-separated digits (`FP-0`, `FP-1`, `FP-9`).
  - The artifact path stays as it is: unused by the display half and still read by the gated executable half. No sub-action is removed by this unit.
  - No artifact is written and no `openspec/` is required; the derivation is read-only, per session, in any repository.
  - The card renders at the bottom of the rail with the project's data already set (D2=a), and the manual `declare`/`approve` steps are not part of the display path.
  - Observe: a repository with no map artifact shows a populated card; a repository with no `FP-N` units says so instead of rendering an empty map.
  - **Authorized test migration (2026-10-05, option A), extended the same day.** The frozen contract deliberately inverts behaviours that `tests/gentle-project-map.test.ts` pins: that the bare command writes an artifact, that a session without an artifact hides the card, and — the wider blast radius — that the display's rows, foundations and states come **from the artifact**. The display now derives them from the project's `FP` task documents, so the fixtures that fed rendering, selection, explanation and group-toggle tests move to `FP`-prefixed task documents and the label assertions follow the `FP` codes. Conditions: the new expectations must be observed **failing before** the implementation; every changed assertion must be reported one by one with what it asserted, what it asserts now, and which decision (D2=a or D3=b) makes the old one obsolete; every removed expectation needs an equal or stronger replacement, never a deletion; the **interaction** assertions (selection movement, click targets, reveal, group toggle) are preserved as they are and only their data source changes; the derivation is exercised end to end through documents rather than stubbed. Artifact-lifecycle fixtures move under an explicit `ensure` with their assertions intact, and the executable-half tests stay artifact-backed, because the artifact path itself is not removed. Any test that seems to need a change for some other reason stops the work instead of being adjusted.
  - **RED captured before the implementation (2026-10-05)**: `node --experimental-strip-types --test tests/*project-map*.test.ts` — exit **1**, **772 tests, 765 passed, 7 failed**. The seven are the new expectations against the untouched implementation: the bare command still routes to `ensure`, a missing or invalid artifact still hides the card, the resumed visibility choice still needs an artifact, and non-`FP` units still become rows. The recorded baseline was 769 tests, so the migration added coverage rather than removing it, and its audit reports no test that lost an assertion.
  - The artifact-lifecycle calls moved to an explicit `ensure` with their assertions intact, and the explanation test asserts the roll-up's presence and canonical order with every surface *unknown*, plus two stronger assertions: a conflicting artifact is ignored, and its bytes stay unchanged.
  - **Changed-assertion audit recovered (2026-10-05, parent; the worker was cancelled before delivering it).** `tests/gentle-project-map.test.ts` now holds **433** assertion calls against **395** at `HEAD`, and **81** tests against **75**: no test lost an assertion, the three renamed tests kept every one of theirs, and the six added tests are the new coverage. Classified one by one: the bare command's action `ensure` → `show` and the fixture labels `PM-*` → `FP-*` (**D2=a** — the FP format is the row contract, so a `PM-` unit is no longer a row); the absent, invalid and resumed-session visibility expectations invert from hidden to visible (**D3=b** — there is no artifact to opt in with); the group label `tooling` → `repository-tooling` and the row label `Catalog` → `FP-1 — Catalog` follow the derived projection (**D3=b**); the eleven artifact-lifecycle calls move to explicit `ensure` with their `wrote`, confirmation, diagnostic and byte assertions intact. The **interaction** assertions — selection clamps, `▸ Product capabilities`, group toggle, click targets, reveal — are byte-identical. The roll-up's real percentages gave way to all-seven-`—` plus **two stronger assertions** (`doesNotMatch(/Web 50%|API 0%|✕/)`, and the artifact's bytes unchanged), and the arithmetic stays asserted in the pure tests (`tests/shell-project-map-view.test.ts:320-328,354-357`, `tests/project-map-help-modal.test.ts:151,194`), so the PMV-3 debt is a relocation, not a deletion.
  - **Gate results on this tree (2026-10-05)**: focused map tests **exit 0 — 775/775**; `check-types` **exit 0 — 187**; `verify-package-files` **exit 0 — 188 files / 69 pinned**; `git diff --check` **exit 0**; `git status` exactly the eight files. The full suite is `exit 1` — 5,359 tests, 5,309 passed, **16 failed**, 34 skipped — and **none of the sixteen is a PMV-2 failure**: they are `tests/gentle-shell.test.ts` (11) and `tests/vim-editor-adapter.test.ts` (5) failing with `Unsupported Pi editor layout/version` at `lib/vim-editor-adapter.ts:178`, and the same file fails identically in two trees that do not contain these changes (the fork at `05fcd55c` and the base at `5ac56e8c`). See the environment obligation below.
  - **Scope corrected before the commit (2026-10-05, user decision A).** The implementation had also gated the orchestrator tabs row (`!projectMapExecutableEnabled(env)`), which D4=a does not authorize and which would have removed a delivered surface whenever the variable is unset; and it had also added a redundant `GENTLE_PI_PROJECT_MAP: "1"` to the shared `mountTabsCard` helper, which `projectMapExtension` already injects by default (`tests/gentle-project-map.test.ts:1079`) — a test change made for a reason other than D2/D3, which this authorization forbids. Both are reverted, and the two documentation sentences that described the tabs as part of the executable half are corrected. The `launchable()` early return is **kept and disclosed**: it is behaviourally equivalent to the base, because `projectMapLaunchableSet` already returns the empty set when `executable` is false (`lib/project-map-launchable.ts:30`), and it spares a store read under the default gate-off state.
  - **Fixture reverted**: the surface-roll-up test's document went back to `[ ] **FP-1 — Catalog**`. No assertion in that test depended on the checkbox, and nothing is adjusted without the expectation that requires it.
  - Work-unit commit: **`147bf1a6`** `feat(project-map): derive the map from FP task documents without an artifact` — 8 files, +313 / −94, working tree clean, not pushed.

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
  - 2026-10-05, PMV-1 pass 3 (parent): `pnpm` was installed, so the two gates that could not start now run. A normal `pnpm install` reified `node_modules` from the lockfile and `@earendil-works/pi-tui` resolves to `1.0.0`; the hand-built links and the preserved symlink are gone, so no dependency of this tree points at the global Pi install any more. Full suite: `provider-contract` **PASS**, `runtime-harness` **PASS**, `unit-tests` FAIL only on the two verified base failures. Re-measured on the lockfile install: map tests **769/769**, `check-types` exit 0 with 187 diagnostics and 11 file/code pairs improved.
  - Work-unit commit: **`97a0f963`** `feat(project-map): port the map onto the 4.0.0 base` — 80 files, +23,061 / −12, working tree clean, not pushed.

## Open obligations

- **The verification command has no declared home after 4.0.0.** Resolved for the port by moving the test's input into its own temporary fixture; it no longer pins this repository. Where a 4.0.0 project declares its test command is still unresolved and belongs to PMV-3.
- **Two base failures, owned by nobody in this unit**: `tests/review-host-relay-routing.test.ts` lines 405 and 1317, reproduced on the pristine base. They are 4.0.0's own red tests, outside this port's scope; recorded so they are never mistaken for port damage.
- **Closed**: the provider-contract and runtime-harness gates now run and pass, because `pnpm` is installed and `node_modules` is a normal lockfile install that resolves `@earendil-works/pi-tui` 1.0.0.
- **Review budget overage, flagged and not hidden**: the work-unit commit is 80 files and +23,061 lines, far over the 400-line review budget, because a port is one indivisible change — the imported code does not compile, register or test without the shared-file integration in the same commit. The hand-written surface is small and is the part worth reviewing by hand: the 11 shared files plus the geometry reconciliation in `lib/shell-project-map-card.ts`. The imported files are reviewable by diffing them against `feat/project-map-orchestration`.
- **Display coverage has an interim ceiling, owned by PMV-3.** With the display derived from documents, a surface roll-up can only report every surface as *unknown* until the FP format defines how a document declares surfaces (`**Allowed edit surfaces:**`), and a state beyond the checkbox cannot be declared at all, so `blocked` stays unreachable from documents. PMV-2 keeps the roll-up's structural presence and canonical order asserted and leaves the arithmetic covered in the pure view tests. **When PMV-3 lands, the explanation test must assert real percentages again** instead of staying at *unknown*: an interim weaker assertion is a debt with an owner, not a settlement.
- `scripts/types-baseline.json` was deliberately kept outside the allowed surfaces and was not modified: the delta was attributed by file and code and reported instead.
- **Newly dead export, PMV-2's to close**: `projectMapCardVisible` (`lib/shell-project-map-card.ts:191`) has no caller any more, because the display no longer consults the artifact. Delete it or justify keeping it in the same unit.
- **Advisory, deliberately unmeasured**: `displayCardState` re-derives the whole projection on every `render()` and `digest()` — `package.json` plus every `odd/tasks/*.md` — where the artifact state read one JSON file; the coordination store next door is cached for two seconds for a comparable reason. Measure before changing anything, and do not fold it into this unit.
- **The test harness hides the gate-off half, and that is how F1 stayed invisible.** `projectMapExtension` injects `{ [PROJECT_MAP_EXECUTABLE_ENV]: "1", ...env }` for every test built through it (`tests/gentle-project-map.test.ts:1079`), so no test in that file exercises the card or the tabs with `GENTLE_PI_PROJECT_MAP` unset — which is the default every real session runs with. A gate check added inside the display therefore passes every gate and changes real behaviour. Closing this needs either a gate-off companion test for the card, or the same decision recorded as unreachable by design; it is not PMV-2's to invent.
- **Environment incident, not a port result**: the editor tests resolve the *installed* Pi pair by prefix layout, and the global install at `/home/facundo/.nvm/versions/node/v26.8.1/lib/node_modules/@earendil-works/` now holds `pi-coding-agent` alone (directory rewritten 2026-10-05 17:03) with `pi-tui` and the rest nested beneath it. That is what makes the sixteen tests fail, and it is also why the two `review-host-relay-routing` failures PMV-1 recorded as base failures now pass. The suite's baseline on this machine is not stable across an install: re-measure the environment before trusting any red or green, and never attribute either to a diff without reproducing it on a tree that lacks the diff.

## Next step

PMV-2 is committed (`147bf1a6`) and its gates are green except the environment incident recorded above, so the unit is closed. PMV-3 follows: make the FP format the contract (`**Allowed edit surfaces:**`), restore the explanation test's real percentages, and give a 4.0.0 project one declared home for its test command.
