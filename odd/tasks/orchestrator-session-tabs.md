# Orchestrator session-tab layer

Status: **planned, decision settled 2026-09-26 (option C), implementation starting.**

## Objective

Make every orchestrated session in this repository visible in Gentle Shell as a row of tabs between the host's global bar and the `✿ Gentle Shell` header row, so a user running more than one orchestrator can see, from any one of them, which capabilities are being worked on, by which session, in which worktree and branch, and whether that session is still alive — without leaving their own session.

## Problem

Today the sidebar answers "what is this session doing?". It cannot answer "what else is running on this project?": the coordination store already records live claims, session bindings and heartbeats across worktrees (PM-4), and the approved map already records each capability's objective and required surfaces (PM-1/PM-3), but nothing renders that cross-session picture. A user with two orchestrators open has to remember the other one.

## Why now

The ratified order is PM-7 → this unit → PM-8 → PM-9. PM-7 is closed, and this unit depends on it in exactly one direction: PM-7's handoff is what makes a launched child write its own `session-binding` and `heartbeat`, which is the data this layer reads. The dependency does not run the other way — PM-7 needed no new field for the tabs, because a tab's identity is the capability id already present in the `session-binding` and its grouping comes from the surfaces the map already declares.

## Decisions (ratified by the user, 2026-09-25)

1. **Data source.** The coordination store is primary: a session tab exists because a `session-binding` plus a heartbeat ties a session to a capability of this repository, with an exact capability id, worktree root and branch. `~/.pi/agent/presence` is used **only for liveness**; ambient presence never creates a tab on its own.
2. **Functional group.** The map's surfaces are the grouping. The recommended form is sections per surface, with a capability appearing under each surface it requires — so a capability that requires coverage in Web, API and Data appears in all three.
3. **Activation is read-only.** Selecting a tab reveals that session's objective, worktree, branch, claim, blockers and last activity. It never moves the user out of their own session. **Rejected:** jumping to the window through a host adapter (possible later as an explicit "focus in tmux" action) and in-process resume (it would break one-writer-per-worktree).
4. **Narrow mode.** The tabs hide with the rest of the chrome, below the existing 140-column breakpoint where the header and rail already stop painting. One rule, no extra row, so PM-9 verifies a single behaviour.

## Scope

### Included

- A pure projection from the coordination store plus the approved map to a tab model.
- The tab row, rendered inside the existing header region so it inherits the narrow-mode gate instead of adding one.
- A read-only detail block for the selected tab.
- Tests at the projection, rendering and wiring levels, plus documentation.

### Non-goals

- Any host adapter, window focus, or terminal-emulator detection. That would re-open PM-7's settled `tmux`-only scope.
- Resuming, attaching to, or writing into another session's worktree.
- Any write to the coordination store: this layer is a reader, with no claim, no heartbeat and no lease.
- Changing the map schema. If the tab needs a field the map lacks, that is PM-8's schema decision, not this unit's silent addition.

## Constraints

- **Read-only against the store.** Every read goes through the existing readers; no new write path.
- **No `process.env` or filesystem reads inside render.** Readers are injected at the composition site, matching the PM-7 receiver and the PM-3 card.
- **The rail digest matters.** `SidebarRail.digest()` is mandatory for a rail that paints live data, and the tab row paints heartbeats and liveness, so it must declare one or the memo will serve stale rows.
- **Fail closed.** A corrupted or unavailable store shows that honestly and renders no tabs, exactly as the map card degrades to an unavailable overlay rather than inventing state.
- **Width safety.** The header row has a hard 140-column gate and the row is full-width; every line must be measured, never assumed.

## Row shape (decided by the user, 2026-09-26: option C)

Decision 2's literal form — a capability repeated under each surface it requires — is a **list** shape, while the agreed placement is a **single full-width row** between the host bar and the `✿ Gentle Shell` bar. At 140 columns a row that repeats capabilities across up to seven surfaces overflows as soon as a project has a handful of live sessions. Three ways to reconcile it were put to the user, and **C was chosen**:

| Option | Row shows | Outcome |
|---|---|---|
| A. Section labels in the row, capability repeated | `Web · Merchant catalog, Checkout   API · Checkout` | Not chosen: closest to decision 2 verbatim, but truncates soonest. |
| B. One tab per capability, surface tags on the tab | `[Merchant catalog · Web API DB] [Checkout · Web API DB]` | Not chosen: fits the most, but demotes the surface grouping from section to attribute. |
| **C. Sections in the row, capability repeated, only for surfaces with a live session** | As A, filtered to live surfaces | **Chosen.** Keeps the surface reading that makes layer imbalance visible, while bounding the width to what is actually running now. |

The consequence is a defined rule rather than a truncation accident: **a surface section is rendered only while at least one session bound to a capability of this repository, under that capability's declared surfaces, is live.** Its acceptance criterion is number 8 below. A surface whose only sessions are stale renders no section, and the capability disappears from it — which is the intended behaviour, not a bug to file.

## Header ownership (decided by the user, 2026-09-26: option 1, contributor registry)

The plan's original edit surfaces could not express the wiring, for two measured reasons. The `header` slot is **single-owner** — `sidebarHeader(tui, rail)` does `parts.set("header", rail)` — and `extensions/gentle-shell.ts:947` already owns it, rendering exactly two rows. And that owner's mouse handler decided with `event.y !== 0`, so a contribution placed above the status line (which is exactly where the ratified placement puts it) would have moved the usage segment down and silently broken its click.

Three ways out were put to the user and **option 1 was chosen**: the shell keeps ownership of the region and paints the rows any extension contributes, while `extensions/gentle-project-map.ts` — which already owns the store root, the artifact path and the map card — registers the tabs row. Rejected: having the shell read the coordination store itself (couples the shell to the map's store and duplicates root/path resolution), and rendering the row inside the map card's own rail (crosses no boundary, but contradicts the ratified placement between the host bar and the `✿ Gentle Shell` bar). The accepted cost is a small new API in `lib/shell-sidebar.ts`, and the files it needs were added to the authorized surfaces below.

## Collision map

- `lib/shell-sidebar-layout.ts` owns the header row as a single full-width sibling above the hstack (`:38`, `:110`, `:203`), with `SIDEBAR_BREAKPOINT = 140` (`:5`). PM-3 already settled this file, so the entry point exists and this unit extends it rather than re-cutting it.
- `odd/tasks/fullscreen-live-header.md` owns the header row's origin. That unit has landed — the `header` slot, `headerActive`, and `sidebarHeader(...)` at `extensions/gentle-shell.ts:947` all exist — so the collision is extend-only.
- `lib/shell-project-map-card.ts:137` is the registration precedent to mirror (`sidebarPart(tui, key, bottom, rail)`).
- This layer must not change how agents or terminals are created.

## Authorized edit surfaces

- `lib/shell-project-map-tabs.ts` (new: the pure projection, the row/detail rendering, and the bounded snapshot).
- `tests/shell-project-map-tabs.test.ts`, `tests/shell-project-map-tabs-view.test.ts` (new).
- `lib/shell-sidebar.ts` (the header contributor registry, added by the option-1 decision).
- `tests/shell-sidebar.test.ts` (the registry cases).
- `lib/shell-sidebar-layout.ts` (the header region only).
- `extensions/gentle-shell.ts` (the header composition site only).
- `extensions/gentle-project-map.ts` (the tabs contribution registration only, added by the option-1 decision).
- `tests/shell-sidebar-layout.test.ts`, `tests/gentle-shell.test.ts` (the header cases only).
- `docs/gentle-shell.md`, `docs/project-map.md`.
- `odd/tasks/orchestrator-session-tabs.md`, `odd/tasks/project-map-orchestration.md`.

Anything outside this list is a scope question, not an edit.

## Task list

- [x] **TAB-1 — Pure tab projection.** `deriveOrchestratorSessionTabs(...)`: join the coordination state's satellites (capability, session, claim, lease status, heartbeat freshness) with the worktree bindings (branch, worktree root) and the approved map (objective, surfaces, declared state), then group by surface keeping only live ones (option C) and order deterministically. Readers injected; no I/O of its own. **Delivered 2026-09-26**, 362 new lines in `lib/shell-project-map-tabs.ts` and its suite (373 with this document), just under the 400-line budget and over the 280-line forecast.
  - **Two precedence rules the plan left implicit and the tests now pin.** *Liveness*: presence is authoritative when it is available (present means live, absent means stale) and the store's own lease status decides it when presence is unavailable, so one rule covers both the desktop case and the headless one. *Worktrees*: the store keeps one binding per capability, so a binding written by an earlier session still names this capability's worktree, but when two exist the one whose session matches wins, so a re-provisioned worktree cannot be shadowed by a stale binding.
  - **Two judgement calls recorded rather than buried.** A session holding a capability the approved map does not declare is dropped and named by a `warning`, because that is map drift worth surfacing. A **stale** session stays visible inside a section that a live peer keeps on screen: dropping it would make acceptance criterion 4 — a dead session distinguishable from a live one — impossible to satisfy, while option C still keeps a purely stale surface off screen entirely.
- [x] **TAB-2 — Row and detail rendering.** **Delivered 2026-09-26**, 273 changed lines (`lib/shell-project-map-tabs.ts` +102, `tests/shell-project-map-tabs-view.test.ts` 171), under the 400-line budget and at the 260-line forecast.
  - **The row is one line, as the placement requires.** It assembles every live section into a single string and then measures it with `truncateToWidth`, which understands ANSI, so a narrow terminal drops the tail with an ellipsis instead of wrapping and pushing the rail down. Two sessions on one capability collapse into one row item carrying `×2` rather than two identical labels, and the detail folds the same capability's per-surface repetitions back into one session list.
  - **Surface labels are local and drift-pinned.** `lib/shell-project-map-view.ts` holds the only other copy of that vocabulary but is outside this unit's authorized surfaces, so the tabs module owns its own `ORCHESTRATOR_SESSION_SURFACE_LABEL` and a test asserts its keys equal `PROJECT_MAP_SURFACES` exactly. A surface added to the schema fails the tabs suite instead of rendering an undefined label.
  - **The theme the tests use emits real ANSI.** A role-printing stub would have been counted by `visibleWidth` as visible text and would have made the width assertions pass for the wrong reason; the suite paints with escape codes and strips them to assert content, so the width tests measure what a terminal would.
  - Closure evidence: focused **20/20** (41 with TAB-1), neighbours **522**, full suite **3,879 (3,841 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Deliberately not verified: nothing is wired into the shell yet, so criteria 3, 5 and 7 remain open and belong to TAB-3.
- [x] **TAB-3a — Header contributor registry and composition.** **Delivered 2026-09-26.** `lib/shell-sidebar.ts` gains `sidebarHeaderContributor` and `sidebarHeaderContributors`: the region stays single-owner, so an extension that owns data the header should show contributes rows instead of a second part. `extensions/gentle-shell.ts` paints those rows above its own two, folds their digests into the header digest, and routes a click by the row group it landed in rather than by a fixed index.
  - **The regression this slice existed to prevent is pinned.** A test registers a contributor, asserts the contribution takes `y = 0` (rebased to its own first row) and that the usage segment answers at `y = 1`; a second asserts a contribution row that ignores a click never opens the usage panel; a third asserts the pre-existing `y = 0` behaviour is intact when nothing contributes. The narrow-mode rule (criterion 5) needed no new code: the 140-column gate that hides the header hides the contribution with it.
  - Closure evidence: focused **121/121**, full suite **3,889 (3,851 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [ ] **TAB-3b — The tabs contribution itself.** The bounded snapshot, the rail with its selection and digest, and its registration from `extensions/gentle-project-map.ts`. The snapshot is cached behind an injected clock rather than read per frame, because the coordination store and presence are far heavier than the single map artifact the card re-reads on every render. Forecast ≈ 300 lines. **Not started.**
- [ ] **TAB-4 — Documentation and unit verification.** `docs/gentle-shell.md` and `docs/project-map.md`, the acceptance trace, and the honest record of what was not verified. Forecast ≈ 150 lines.

Every slice stays under the 400-line review budget and is its own commit. The PM-6/PM-7 lesson is budgeted rather than rediscovered: a slice that introduces a human-visible surface costs its estimate plus one audit round.

## Acceptance criteria

1. A tab exists exactly when the store ties a session to a capability of this repository; ambient presence alone renders nothing.
2. Every tab names its capability, worktree, branch and last activity, all read from the store and never derived from a path.
3. Selecting a tab shows the read-only detail and moves the user out of no session.
4. A stale or dead session is distinguishable from a live one, and a corrupted store renders no tabs and says so.
5. The row hides below the 140-column breakpoint with the rest of the chrome, by the existing gate.
6. The layer writes nothing to the store and adds no map field.
7. The rail digest changes when the painted tab state changes.
8. **Only live surfaces get a section (option C).** A surface renders while at least one session bound to one of its capabilities is live; with no live session the section is absent, and a stale session never keeps a section on screen.

## Review disposition

RDD is **off** for this clone, as it was for PM-4 through PM-7. The unit therefore carries parent verification plus independent audits, and its deferred native review pass runs when the unit closes, one candidate per slice, from a worktree pinned at that slice's tip with `baseRef` set to the previous slice's tip, with RDD enabled for the pass and returned to `off` afterwards. No review is started mid-unit and never against a tree with a writer still running.

## Progress

- 2026-09-26: **unit planned** after a read-only surface recon. The findings that shaped the plan: the header row is already a single full-width sibling registered through `sidebarHeader(...)`, so the tabs extend it and inherit its 140-column gate instead of adding a second narrow-mode rule; the coordination state already exposes exactly the five facts a tab needs (capability, session, lease status, heartbeat freshness, blockers) and `listProjectMapStoreWorktreeBindings` supplies branch and root, so **no store or schema change is required**; and decision 2's list shape collides with the agreed single-row placement, which is recorded above as the one open decision rather than resolved silently. Nothing has been implemented at that point; TAB-1 was the next work unit once the shape decision was settled.
- 2026-09-26: **shape decision settled — option C** (a surface section renders while at least one session bound to one of its capabilities is live; a purely stale surface renders no section), recorded above with its three rejected alternatives and pinned as acceptance criterion 8.
- 2026-09-26: **TAB-1 delivered** (`lib/shell-project-map-tabs.ts`, 362 new lines with its suite). `deriveOrchestratorSessionTabs` is a pure function over already-read values: no filesystem access, no `process.env`, no store write, and every reader stays injected at the composition site. It joins the satellites to the map, resolves liveness by the presence precedence rule, resolves the worktree binding per capability, and builds the surface sections in the schema's own surface order. Closure evidence: focused **21/21**, neighbours **502/502**, full suite **3,859 (3,821 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Nothing is wired into the shell at that point, so no acceptance criterion beyond the projection's and the renderer's own is met; criteria 3, 5 and 7 belong to TAB-3.
- 2026-09-26: **header ownership settled — option 1** (the shell keeps the region and paints contributed rows; the map extension registers the tabs row), recorded above with its two rejected alternatives, and the two files it needs added to the authorized surfaces.
- 2026-09-26: **TAB-3a delivered** — the header contributor registry and its composition. The single-owner slot no longer blocks a second data owner, and the fixed-index mouse routing that would have broken the usage click is replaced by row-group routing. Closure evidence: focused **121/121**, full suite **3,889 (3,851 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Deliberately not verified: the row still is not on screen, so criteria 3 and 7 wait for TAB-3b; criterion 5 was satisfied without new code by the existing 140-column gate.
- 2026-09-26: **TAB-2 delivered** with the row and the read-only detail (273 changed lines). The row is one measured line built from the live sections, a multi-session capability collapses to one item carrying `×2`, the selected capability is marked in every section it appears in, and the detail lists the objective, the declared state, the blockers, the next action and one block per session with its worktree, branch, liveness and last activity. An unknown worktree is said to be unknown rather than rendered as a path. Closure evidence: focused **20/20**, neighbours **522**, full suite **3,879 (3,841 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Nothing is wired into the shell yet, so criteria 3, 5 and 7 are TAB-3's.
