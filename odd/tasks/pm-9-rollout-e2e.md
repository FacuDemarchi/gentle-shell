# PM-9 — Rollout, migration and end-to-end verification

Status: **planned and frozen 2026-09-27.** Five slices, six decisions settled by the user, implementation starting at PM9-1.
This is the last unit of the initiative. PM-1 through PM-8 and the session-tab layer are closed as units with their native review passes.

## Objective

Make the whole feature safe to turn on in a real project and honest to turn off: an explicit gate in front of the executable half, proof that initializing a project disturbs nothing that was already there, an end-to-end pass over the scenarios the roadmap names, a recovery runbook for a session that died, and package/compatibility evidence that the surfaces actually ship.

## Problem

Everything the initiative built is reachable today without asking. `extensions/gentle-project-map.ts` registers the command, the card and the tabs row unconditionally, so `worktree provision` can create branches and worktrees, `open` can start a Pi session, and `contract accept` can write coordination state in any repository where the artifact exists — and a repository with no artifact still gets the command surface. The roadmap's first PM-9 bullet asks for an **explicit opt-in until schemas and recovery behavior stabilize**; today there is no switch at all, in either direction.

## Recon findings (read-only, 2026-09-27)

The unit is **mostly verification and one small switch**, because the hard parts already exist:

- **No gate exists, and its home is single and small.** `extensions/gentle-project-map.ts` is the only registrant of all three surfaces: the command (`pi.registerCommand`, `:1087`), the card (`projectMapCardPart`, through `lib/shell-project-map-card.ts:154`) and the tabs row (`sidebarHeaderContributor` with `PROJECT_MAP_TABS_CONTRIBUTOR_KEY`, `:1071`). One predicate at that file covers the feature; no other file needs to know the switch exists.
- **The repository's own idiom for such a switch is an environment predicate, and there is a working precedent.** `agentsEnabled(env)` (`extensions/gentle-agents.ts:242`) returns false for a child session and reads `GENTLE_PI_AGENTS` with `0`, `false` and `off` disabling; `GENTLE_PI_TODO=0` does the same for the todo card, and `GENTLE_PI_SHELL_CHANGES_KEY=off` for a shortcut. Every existing project-map environment variable is keybinding-only (`GENTLE_PI_PROJECT_MAP_KEY`, `_NEXT_KEY`, `_PREV_KEY`), so the gate would be the first behavioral one.
- **Visibility is already artifact-driven and session-scoped, and is documented as unpersisted.** A ready artifact is visible by default; an empty or invalid one stays out of the rail until `show`; `show` and `hide` apply to the current session only and nothing about visibility, collapse or selection is written anywhere. The gate must not be confused with that: visibility decides *what is painted*, the gate decides *what can run*.
- **Initialization is already non-destructive, and the reason is in the write path.** `writeProjectMapFile` (`lib/shell-project-map-approval.ts:134`) validates before writing, writes atomically through `writeJsonFileAtomicallySync`, and skips byte-identical writes; that helper also does `mkdirSync(dirname(path), { recursive: true })` (`lib/agent-profiles.ts:531`), so a project with no `openspec/` directory gets one created plus exactly one file. The draft generator performs no filesystem access and no model call. Nothing in the draft/approve path opens `openspec/config.yaml` for writing, and the artifact path is a single exported constant (`PROJECT_MAP_ARTIFACT_PATH = "openspec/project-map.json"`).
- **Recovery is implemented and tested below the unit level, but there is no runbook.** The store refuses a corrupted generative descriptor on read, quarantines locks and records into `locks-quarantine`/`*-quarantine`, classifies `free | live | stale | corrupted | unreadable`, takes over a stale claim with a visible `stale-claim-recovered` warning, and expires a heartbeat at 60 seconds against a 10-second beat. What is missing is a **scenario-level** pass and a **written recovery sequence** — today a user whose session died has nothing to read.
- **The platform matrix is coded but not exercisable here.** `lib/project-map-open-pi.ts` already branches on `process.platform === "win32"` for the launcher name, passes `windowsHide: true`, records a tmux 3.6 verification, and degrades to a background subagent when tmux is unavailable. This environment is Linux only: macOS and Windows cannot be exercised, and the unit must say so rather than imply otherwise.
- **The package resource check does not pin the feature.** `scripts/verify-package-files.mjs` asserts an explicit `requiredPaths` list and **not one of them is a project-map surface**: `grep project-map scripts/verify-package-files.mjs` is empty. The directories ship through `package.json`'s `files` (`lib/`, `extensions/` are whole directories), so the build is fine today — but a dropped surface would not fail the pack. The same script reconciles generated runtime sources; the project-map modules are loaded as TypeScript and correctly have **no** `runtime/*.mjs` twin, so they belong in `requiredPaths` only, and adding them cannot affect that reconciliation.
- **Observability needs no new surface.** `status` reports approval state and counts, the card reports the first three diagnostics and points at `status` for the rest, the readiness report names each check's `verified | mismatched | unverified` state and its reason, `readiness-receipt` carries `authority: "none"`, and the store carries a `{ generation, epoch }` tuple. The repo's only telemetry lane is the agents runtime-metrics modules and is unrelated to this feature.

## Decisions (approved by the user, 2026-09-27)

Six decisions were put to the user with the options below and the recommendations recorded with them. The user approved all six recommendations, so the options each decision rejected are kept here as the record of what was considered.

**A. What does the gate cover?**
1. Everything: with the gate off, the command, the card and the tabs row are all absent.
2. **Only the executable half**: the artifact-facing half (`status`, `draft`, `declare`, `approve` and the card) stays reachable so a project can be initialized and reviewed; the runtime half (`worktree provision`, `open`, `lead claim|renew`, `contract accept`, `integrate`) is what the gate locks.
3. Only the mutating half: `worktree provision`, `open`, `lead claim|renew`, `contract accept`; `integrate` is read-only plus a receipt.
**Chosen: option 2.** Gating everything makes the feature unreachable — a user could not even initialize the artifact or read why the executable half is off — and it would also make the gate untestable end to end, because there would be no way to reach the surfaces it is supposed to protect. Option 3 leaves `integrate` writing a store receipt while claiming to be locked, which is the kind of half-truth this initiative has spent eight units avoiding. **The rule, not just a list:** the gate locks every route that acts *outside the map artifact*, which is the worktree and branch (`worktree provision`), the launched process (`open`), and the shared coordination store (`lead claim`, `lead renew`, `contract propose`, `contract accept`, `contract reject`, `integrate`). It never locks a read (`status`, `show`, `hide`, `worktree inspect`, `worktree list`, `lead status`, `contract list`) and it never locks a state-reducing release (`lead release`), because refusing to release while the gate is off would strand a claim the repository still needs to free, and a switch that traps state is not a safe switch.

**B. Gate default, idiom and propagation to children.**
1. **Explicit opt-in**: `GENTLE_PI_PROJECT_MAP=1` enables, unset/`0` disables, matching the roadmap's wording; a behavior change for anyone already using the map.
2. Opt-out: `GENTLE_PI_PROJECT_MAP=0|false|off` disables, matching `GENTLE_PI_AGENTS` and `GENTLE_PI_TODO`.
3. `=1` forces on, `=0` forces off, unset means "on once the artifact exists", so the artifact is the implicit opt-in.
**Chosen: option 1**, because the roadmap says *explicit opt-in until schemas and recovery behavior stabilize* and this unit is the last one — after it, the stabilization claim is verified rather than assumed, and a later unit may revisit the default. **Propagation**: a `open` launch starts a session in a worktree through tmux, and tmux does not forward a new client's variables to a session it creates; the launch already passes `-e ${PROJECT_MAP_OPEN_PI_ENV}=<launchIdentity>` for exactly that reason, so a gated child is either given the gate the same explicit way or is refused with the reason stated. This is part of decision A/B's implementation, not a new field.

**C. What does "migrate or initialize without destroying existing artifacts" require?**
1. **Verify and document only**: tests prove the initialization path creates `openspec/` when missing, writes exactly one file, and leaves `openspec/config.yaml`, ODD documents and the coordination store byte-identical; the doc states the sequence.
2. Also add a defensive refusal for the shapes the write already cannot handle (`openspec` present as a file, artifact present as a directory), reported by their own codes.
3. Add an explicit `init` sub-action.
**Chosen: option 1.** There is no schema to migrate: the map is `v1` only and the store is a new root, so nothing pre-existing needs conversion. Option 3 duplicates `draft` with a confirmation already in place. If a slice shows the current refusal is unattributable, option 2 lands only there.

**D. How does the unit represent platforms it cannot exercise?**
1. **Adapter-level tests for every platform branch, a real tmux run on Linux only when tmux is present (skipped otherwise), and an explicit matrix in the unit document naming each cell as exercised / unit-covered / unverified.**
2. Infer platform parity from the code branches and say the matrix is covered.
3. Drop the platform matrix as out of reach.
**Chosen: option 1.** The roadmap asks for the exercise; this environment can only honestly provide a part of it, and a matrix that distinguishes "verified here", "covered by a unit test with an injected adapter" and "not verified" is the only version of that answer that is not an overclaim.

**E. What do "observability" and "rollback" mean for this feature?**
1. **Document what already exists** — the diagnostics, the receipt with `authority: "none"`, the store generation, and the exact rollback sequence (disable the gate; nothing already written is undone; branches and worktrees stay; cleanup happens only through an explicit human-authorized command) — and prove by test that turning the gate off writes nothing and deletes nothing.
2. Add new instrumentation or a telemetry lane.
3. Add a `project-map recovery` command that mutates state.
**Chosen: option 1.** Option 2 duplicates reporting the unit already has and adds an external surface nobody asked for. Option 3 hands a recovery command authority the roadmap deliberately keeps with a human: "disabling the feature leaves branches and worktrees intact, and cleanup checks dirty state and requires human authorization whenever data may be lost."

**F. Package contents and compatibility evidence.**
1. **Pin every project-map surface in `requiredPaths`, and run the existing compatibility gates with their results recorded** (provider contract, generated runtime modules, type baseline, full suite, pack resource check).
2. Also add a new artifact-schema compatibility check.
3. Leave the pack list alone and record the gates.
**Chosen: option 1.** Option 2 is a mechanism without a consumer: the artifact carries `version` and the validator already fails closed on an unknown one. `requiredPaths` is the one place where a dropped surface is currently invisible.

## Slices

- **PM9-1 — the gate.** One predicate beside the registrations, in the shape decision A and B define, with the refusal naming the switch and its accepted values, and the executable half reporting *why* it is unavailable instead of vanishing without explanation.
- **PM9-2 — initialization and rollout verification.** Tests over a real temporary project: no `openspec/` directory, an existing `openspec/config.yaml`, existing ODD documents, and an existing store; prove exactly one file is created or replaced, and nothing else changes.
- **PM9-3 — end-to-end scenarios.** Multi-session and multi-worktree coordination, a stale claim recovered with its warning, a corrupted record refused rather than repaired, an unconfirmed launch reported as unconfirmed, and the headless fallback. Linux real; every other platform cell stated as unit-covered or unverified per decision D.
- **PM9-4 — package and compatibility evidence.** The `requiredPaths` pinning plus the gates of decision F, recorded with their exit states.
- **PM9-5 — documentation, runbook and acceptance trace.** `docs/project-map.md` and `docs/gentle-shell.md` gain rollout, recovery, disabling and cleanup sections; the unit traces the roadmap's five acceptance bullets; the unit closes.

## Non-goals

- Commit, push, PR, merge, release, or any destructive cleanup. Disabling writes nothing and deletes nothing.
- A new persisted setting, a `settings.json` key, or a schema change of any kind.
- A new telemetry lane or an external observability surface.
- macOS and Windows runs. They are reported as unverified rather than claimed.
- Re-litigating the store layout, the coordination protocol, the worktree lifecycle or the review gate.

## Constraints

- **The gate must be readable from one place and testable without Pi.** The predicate takes `env` as an argument, exactly as `agentsEnabled(env)` does, so a test can call it directly.
- **Off means off, and off says so.** A gated action is refused with its reason and the accepted values; nothing silently degrades to a different behavior.
- **Fail closed.** A gate value that is neither on nor off is off with a diagnostic, never on.
- **Docs and behavior travel together.** The gate, its default and its propagation to a launched child are documented in the same work unit that implements them.

## Collision map

- `extensions/gentle-project-map.ts` owns the command, the card and the tabs registration; PM-9 adds the predicate there and does not move any of them.
- `lib/shell-project-map-card.ts` owns the card descriptor; PM-9 touches it only if the gate has to reach the card's registration.
- `scripts/verify-package-files.mjs` owns the pack list; PM-9 adds entries and changes no mechanism.
- `lib/shell-project-map-approval.ts` and `lib/agent-profiles.ts` own the write path; PM-9 verifies them and changes neither.
- `lib/project-map-store-*.ts` owns recovery semantics; PM-9 exercises them and changes none of them.

## Authorized edit surfaces

- `extensions/gentle-project-map.ts` (the gate predicate and its registration points).
- `lib/shell-project-map-card.ts` (only if the gate must reach the card registration).
- `tests/gentle-project-map.test.ts`, `tests/shell-project-map-card.test.ts`.
- `tests/project-map-rollout.test.ts` (new), `tests/project-map-e2e.test.ts` (new) if the slices split that way.
- `scripts/verify-package-files.mjs` (the `requiredPaths` entries only).
- `docs/project-map.md`, `docs/gentle-shell.md`, `README.md` (only if the gate needs a README line).
- `odd/tasks/pm-9-rollout-e2e.md`, `odd/tasks/project-map-orchestration.md`.

## Review disposition

One native review candidate per slice, from a worktree pinned at that slice's tip with `baseRef` set to the previous slice's tip, RDD enabled for the pass and returned to `off` afterwards, exactly as PM-8 did. Budget: 400 lines per commit; an overage is recorded when small and put to the user when large. A slice that is pure documentation with no executable change is exempt by the entry rule and traced instead.

## Platform matrix (2026-09-27)

Decision D asked for adapter-level tests for every platform branch and an explicit matrix rather than an inferred one. This is the honest version of it: each cell says what was actually run here.

| Cell | Coverage in this environment |
| --- | --- |
| Linux (native, this machine) | **Exercised.** The four scenarios in `tests/project-map-e2e.test.ts`, the real tmux session in `tests/project-map-open-pi.test.ts`, and the full suite. |
| tmux 3.6 | **Exercised** on Linux: a real session is created with the plan's own `-e` pairs, `tmux show-environment` proves both the launch identity and the executable opt-in arrived, and the session is killed afterwards. Skips itself only where tmux is absent. |
| tmux unavailable / headless fallback | **Unit-covered.** `projectMapOpenPiReadiness` reports `host-unavailable`, the fallback plan and its spawn are driven with an injected spawn, and the command's offer and choice path is unit-covered. No real headless Pi child is started anywhere in the suite. |
| Windows | **Partially unit-covered, natively unverified.** The launcher-name branch is now exercised at the adapter level through an injected `platform` (`gentle-shell.cmd` under `win32`, and the extensionless name refused under it, and the `.cmd` wrapper refused under `linux`). Everything else about Windows — process groups, `windowsHide`, real path separators — is **unverified**: there is no Windows runner here and no native proof. |
| macOS | **Unverified.** No runner, and no macOS-specific branch exists in the feature to exercise in isolation. |
| crash recovery | **Exercised** (E2E scenario 2): the deadline passes with no renewal and the next session takes the claim over, with nothing deleted. The reporting defect found there is recorded below. |
| stale-state cleanup | **Exercised**: a stale claim is recovered on the next claim rather than reaped, and the store keeps every file it held. |
| corruption | **Exercised** (E2E scenario 3 and the store suites): refused on read, reported with a code, preserved byte for byte, never repaired in place. |
| multi-session / multi-worktree | **Exercised** (E2E scenario 1): two worktrees of one clone, two session identities, one shared store, with a claim and a proposal crossing between them. |

## Findings recorded as debt (each needs its own candidate)

**F1 — the first readiness receipt is unreachable from inside the product.** `coverage` is one of the eight gating checks, and it is `verified` only when the coordination projection reports the capability `complete`, which is true exactly when a readiness receipt exists. `integrate` is the only production issuer of receipts, and it issues them only for candidates whose checks are all `verified`. A fresh store therefore cannot produce a receipt, so no candidate can be `ready` for the first time, and `Next safe integration action` can never name one. `tests/project-map-e2e.test.ts` pins it: after two `integrate` runs against a real repository with a bound, fresh branch, zero receipts exist and the report says *no readiness receipt covers this capability*. The fix is a decision rather than a patch — either `coverage` stops gating and the receipt is issued for a verified candidate, which is what this unit's decision F describes, or a first-issuer path exists (a human-authorized route that issues one). PM-8's own integration case hid it by pre-issuing the first receipt through a direct library call.

**F2 — a stale takeover is reported as a refusal.** `acquireProjectMapClaim` returns the new claim *and* a `project-map-store/stale-claim-recovered` diagnostic whose severity is `warning`, and the lead branch treats any diagnostic as a failure: it notifies `Lead claim was refused.` and returns `wrote: false` while the store has already changed hands. The recovery is correct and the warning is the right warning — only the report is wrong, and it is wrong in the dangerous direction (it says nothing happened when something did). `tests/project-map-e2e.test.ts` pins it: the claim file names the new session while the command says it was refused. The fix is small (a refusal is an `error` diagnostic, not any diagnostic) but it changes a closed unit's reporting, so it is its own candidate too.

## Progress

- 2026-09-27: **PM9-4 delivered — package and compatibility evidence**, two changes and six recorded gate results. `scripts/verify-package-files.mjs` now pins all **25** Project Map surfaces by name (24 `lib/` modules plus `extensions/gentle-project-map.ts`): they shipped inside the `lib/` and `extensions/` globs all along, so nothing was broken, but nothing failed either if one were dropped. The pin is safe for the generated-runtime reconciliation because these modules are loaded as TypeScript and deliberately have no `runtime/*.mjs` twin. Alongside it, `tests/project-map-rollout.test.ts` gained a **source guard** that fails when a surface exists on disk without a pin or a pin names a surface that does not exist — labelled a source guard rather than a packing proof, because the packing proof is the script itself. **Gates, all with their exit state recorded**: package resource check **0** (`196 files; 69 exact byte-pinned contract artifacts for the v3.7.0 runtime`), provider contract **0** (contract 1.2.0, 9 bundle entries, 2 generated baselines, acquisition field-test-local), generated runtime modules **0** (`runtime matches TypeScript sources (7 generated modules; one-shot metrics sources validated)`), type baseline **195 recorded diagnostics with no regressions**, full suite **4,007 (3,969 passed, 38 skipped, 0 failed)** before this slice's sixth test, `git diff --check` **0**. **Compatibility is stated rather than re-mechanised** (decision F): the artifact carries `version` and the validator fails closed on an unknown one, so no new compatibility check was added; what is verified is that the surfaces ship, that the provider contract mirror still matches its pinned bytes, and that the generated runtime still matches its sources.

- 2026-09-27: **PM9-3 delivered — the end-to-end pass and the platform matrix**, four scenarios in a new `tests/project-map-e2e.test.ts` plus one real-transport extension, and the matrix below. Everything runs against a real clone with two real worktrees, a real Git history and one real store. Scenario 1: a lead claim taken in the main worktree is read as `live` from the satellite worktree, and a contract proposed there lands as a durable shared record. Scenario 2: a claim whose holder never renewed is taken over by the next session after its deadline, and the store loses no file. Scenario 3: a corrupted claim record is refused on read, reported with its code, and preserved byte for byte rather than repaired in place. Scenario 4: a bound worktree on a fresh branch is measured against the real integration target — `behind main by 0` — and the report repeats that readiness grants nothing.
- 2026-09-27: **a second boundary extension, recorded with its reason.** Decision D asks for adapter-level tests for every platform branch, and the launcher's `win32` branch read `process.platform` directly, so it could not be tested at all. `resolveProjectMapOpenPiLauncher` now takes an injected `platform` alongside the inputs it already injects, and three assertions cover it: the `.cmd` wrapper under `win32`, the extensionless name refused under `win32`, and the wrapper refused under `linux`. That turns a cell that was not even unit-covered into one that is, without pretending a Windows run happened.
- 2026-09-27: **the real tmux cell now proves PM9-1's propagation too.** The existing tmux case created a session with `argv.slice(0, 5)`, which after PM9-1 would silently drop the new `-e` pair. It now takes every leading `-e` pair from the plan, asserts the pair list is exactly the launch identity plus the opt-in, and verifies both with `tmux show-environment` against the live session — so the claim that a launched child can use the surfaces it was opened to use is measured against the real transport rather than a stub. tmux 3.6 is present here, so the case ran rather than skipped.
- 2026-09-27: **two real defects found by this pass and recorded rather than patched**, both pinned by the scenarios that found them: F1, the readiness gate cannot produce its first receipt from inside the product; F2, a successful stale-claim takeover is reported as a refusal with `wrote: false`. Each is described below with the evidence and the fix direction, each needs its own candidate because each changes a closed unit's behavior, and neither was silently corrected inside this slice.
- 2026-09-27: **PM9-2 delivered — initialization and the rollout boundary**, five cases in a new `tests/project-map-rollout.test.ts`, no product change. Each case compares exact byte snapshots of a real temporary project before and after the command, because "it initialized the project" is only a safe claim when the delta is provably one file. What they pin: a project with no `openspec/` directory gets one created plus exactly `openspec/project-map.json` and nothing else; a project that already holds `openspec/config.yaml`, `odd/tasks/*.md` and `docs/` keeps every one of them byte-identical; the `declare` and `approve` loop rewrites only the artifact and the approved map carries its actor and its surface; regenerating a draft replaces only the artifact, reflects the new source, and returns a draft, so a previous approval does not survive it; and a real Git repository with an initialized coordination store keeps that store byte-identical, with the store proven to sit under the Git common directory rather than anywhere in the working tree. **Decision C's option 1 held**: no refusal needed an extra case, because the write path already reports an unwritable artifact through `project-map/unreadable-artifact`, so no option 2 was added.

- 2026-09-27: **PM9-1 delivered — the gate**, commit `4c91b111`, 271 changed lines in 11 files. The predicate lives in a new `lib/shell-project-map-gate.ts` (46 lines) as a plain function over an environment object, so it is pinned without Pi, a repository or a store: only `1`, `true` or `on` (trimmed, case-insensitive) enable the executable half, everything else is off, and a value that was set but not understood is quoted back in the refusal instead of looking like an ignored request. `runProjectMapCommand` refuses eight routes — `worktree provision`, `open`, `lead claim`, `lead renew`, `contract propose`, `contract accept`, `contract reject`, `integrate` — with `project-map/executable-disabled`, after each route's own usage validation (a typo still reports itself) and before any work (a refusal writes nothing and asks no confirmation). Reads and `lead release` stay reachable, and the case list pins that. `projectMapOpenPiDecision` withdraws the Inspector's `[Open Pi]` offer while the gate is off, because an offer pointing at a refused action is the same half-truth the readiness gate already avoids.
- 2026-09-27: **one boundary extension, recorded with its reason.** Decision B's propagation needed `lib/project-map-open-pi.ts`, which was not in the frozen surface list: the launch now forwards `GENTLE_PI_PROJECT_MAP=1` through the same `tmux -e` door the launch identity uses, and through the fallback child's environment. tmux forwards no client variable of its own, so without this a session opened in a capability worktree would start with the executable half off — the child could not use the surfaces it was opened to use. The extension is two lines plus the comment that explains the invariant: a launch is reachable only while this session's gate is open, so the child inherits the intent rather than assuming it.
- 2026-09-27: **the four existing test files that drive gated routes now say so.** The executable half being opt-in means a fixture that drives `worktree provision`, `open`, `lead claim` or `contract propose` must enable it; three files wrap the command with the gate explicitly on and `tests/gentle-project-map.test.ts` does the same for its fixture extension, while the gate's own cases pass `env` explicitly in both directions. No production default was weakened to make a test pass.
- 2026-09-27: **PM9-1 closure evidence**: the six touched test files **115/115**, full suite **3,998 (3,960 passed, 38 skipped, 0 failed)** — eight tests more than the pre-slice 3,990 — type gate **195** with no regressions, provider contract, runtime harness, generated runtime modules and `git diff --check` all exiting 0. Deliberately not verified: the real tmux path is not exercised by this slice (it needs a tmux session, and it belongs to PM9-3's end-to-end pass), and the platform matrix is untouched here.

## Acceptance criteria (the roadmap's PM-9 bullets)

1. The functional system is gated behind an explicit opt-in until schemas and recovery behavior stabilize.
2. Projects are migrated or initialized without destroying existing ODD/OpenSpec artifacts.
3. Initialization, map review, parallel capability work, failure recovery, disabling and cleanup are documented.
4. Multi-session/worktree end-to-end scenarios are exercised on Linux, macOS, Windows, tmux, headless fallback, crash recovery and stale-state cleanup — with each cell's real coverage named.
5. Observability, rollback, package contents, compatibility and complete-suite behavior are verified.
