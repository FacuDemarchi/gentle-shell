# PM-9 — Rollout, migration and end-to-end verification

Status: **planned at recon depth 2026-09-27. Six decisions await the user; no code written.**
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

## Decisions (proposed 2026-09-27, awaiting the user)

Each decision records the options considered; the recommendation is mine, unratified. Nothing below is implemented until the user answers.

**A. What does the gate cover?**
1. Everything: with the gate off, the command, the card and the tabs row are all absent.
2. **Only the executable half**: the artifact-facing half (`status`, `draft`, `declare`, `approve` and the card) stays reachable so a project can be initialized and reviewed; the runtime half (`worktree provision`, `open`, `lead claim|renew`, `contract accept`, `integrate`) is what the gate locks.
3. Only the mutating half: `worktree provision`, `open`, `lead claim|renew`, `contract accept`; `integrate` is read-only plus a receipt.
**Recommended: option 2.** Gating everything makes the feature unreachable — a user could not even initialize the artifact or read why the executable half is off — and it would also make the gate untestable end to end, because there would be no way to reach the surfaces it is supposed to protect. Option 3 leaves `integrate` writing a store receipt while claiming to be locked, which is the kind of half-truth this initiative has spent eight units avoiding.

**B. Gate default, idiom and propagation to children.**
1. **Explicit opt-in**: `GENTLE_PI_PROJECT_MAP=1` enables, unset/`0` disables, matching the roadmap's wording; a behavior change for anyone already using the map.
2. Opt-out: `GENTLE_PI_PROJECT_MAP=0|false|off` disables, matching `GENTLE_PI_AGENTS` and `GENTLE_PI_TODO`.
3. `=1` forces on, `=0` forces off, unset means "on once the artifact exists", so the artifact is the implicit opt-in.
**Recommended: option 1**, because the roadmap says *explicit opt-in until schemas and recovery behavior stabilize* and this unit is the last one — after it, the stabilization claim is verified rather than assumed, and a later unit may revisit the default. **Propagation**: a `open` launch starts a session in a worktree through tmux, and tmux does not forward a new client's variables to a session it creates; the launch already passes `-e ${PROJECT_MAP_OPEN_PI_ENV}=<launchIdentity>` for exactly that reason, so a gated child is either given the gate the same explicit way or is refused with the reason stated. This is part of decision A/B's implementation, not a new field.

**C. What does "migrate or initialize without destroying existing artifacts" require?**
1. **Verify and document only**: tests prove the initialization path creates `openspec/` when missing, writes exactly one file, and leaves `openspec/config.yaml`, ODD documents and the coordination store byte-identical; the doc states the sequence.
2. Also add a defensive refusal for the shapes the write already cannot handle (`openspec` present as a file, artifact present as a directory), reported by their own codes.
3. Add an explicit `init` sub-action.
**Recommended: option 1, plus option 2 only where the recon shows the current refusal is unattributable.** There is no schema to migrate: the map is `v1` only and the store is a new root, so nothing pre-existing needs conversion. Option 3 duplicates `draft` with a confirmation already in place.

**D. How does the unit represent platforms it cannot exercise?**
1. **Adapter-level tests for every platform branch, a real tmux run on Linux only when tmux is present (skipped otherwise), and an explicit matrix in the unit document naming each cell as exercised / unit-covered / unverified.**
2. Infer platform parity from the code branches and say the matrix is covered.
3. Drop the platform matrix as out of reach.
**Recommended: option 1.** The roadmap asks for the exercise; this environment can only honestly provide a part of it, and a matrix that distinguishes "verified here", "covered by a unit test with an injected adapter" and "not verified" is the only version of that answer that is not an overclaim.

**E. What do "observability" and "rollback" mean for this feature?**
1. **Document what already exists** — the diagnostics, the receipt with `authority: "none"`, the store generation, and the exact rollback sequence (disable the gate; nothing already written is undone; branches and worktrees stay; cleanup happens only through an explicit human-authorized command) — and prove by test that turning the gate off writes nothing and deletes nothing.
2. Add new instrumentation or a telemetry lane.
3. Add a `project-map recovery` command that mutates state.
**Recommended: option 1.** Option 2 duplicates reporting the unit already has and adds an external surface nobody asked for. Option 3 hands a recovery command authority the roadmap deliberately keeps with a human: "disabling the feature leaves branches and worktrees intact, and cleanup checks dirty state and requires human authorization whenever data may be lost."

**F. Package contents and compatibility evidence.**
1. **Pin every project-map surface in `requiredPaths`, and run the existing compatibility gates with their results recorded** (provider contract, generated runtime modules, type baseline, full suite, pack resource check).
2. Also add a new artifact-schema compatibility check.
3. Leave the pack list alone and record the gates.
**Recommended: option 1.** Option 2 is a mechanism without a consumer: the artifact carries `version` and the validator already fails closed on an unknown one. `requiredPaths` is the one place where a dropped surface is currently invisible.

## Candidate slices (pending the decisions)

- **PM9-1 — the gate.** One predicate beside the registrations, in the shape the chosen decision defines, with the refusal naming the switch and its accepted values, and the executable half reporting *why* it is unavailable instead of vanishing without explanation.
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

## Authorized edit surfaces (candidate, pending the decisions)

- `extensions/gentle-project-map.ts` (the gate predicate and its registration points).
- `lib/shell-project-map-card.ts` (only if the gate must reach the card registration).
- `tests/gentle-project-map.test.ts`, `tests/shell-project-map-card.test.ts`.
- `tests/project-map-rollout.test.ts` (new), `tests/project-map-e2e.test.ts` (new) if the slices split that way.
- `scripts/verify-package-files.mjs` (the `requiredPaths` entries only).
- `docs/project-map.md`, `docs/gentle-shell.md`, `README.md` (only if the gate needs a README line).
- `odd/tasks/pm-9-rollout-e2e.md`, `odd/tasks/project-map-orchestration.md`.

## Review disposition

One native review candidate per slice, from a worktree pinned at that slice's tip with `baseRef` set to the previous slice's tip, RDD enabled for the pass and returned to `off` afterwards, exactly as PM-8 did. Budget: 400 lines per commit; an overage is recorded when small and put to the user when large. A slice that is pure documentation with no executable change is exempt by the entry rule and traced instead.

## Acceptance criteria (the roadmap's PM-9 bullets)

1. The functional system is gated behind an explicit opt-in until schemas and recovery behavior stabilize.
2. Projects are migrated or initialized without destroying existing ODD/OpenSpec artifacts.
3. Initialization, map review, parallel capability work, failure recovery, disabling and cleanup are documented.
4. Multi-session/worktree end-to-end scenarios are exercised on Linux, macOS, Windows, tmux, headless fallback, crash recovery and stale-state cleanup — with each cell's real coverage named.
5. Observability, rollback, package contents, compatibility and complete-suite behavior are verified.
