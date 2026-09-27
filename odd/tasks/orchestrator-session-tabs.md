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
- `lib/shell-project-map-card.ts` (the read-only detail extension point only, added by the TAB-3d placement decision).
- `tests/shell-project-map-card.test.ts` (the detail stacking cases).
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
- [x] **TAB-3b — The bounded snapshot and the row rail.** **Delivered 2026-09-26**, 374 changed lines (`lib/shell-project-map-tabs.ts` and `tests/shell-project-map-tabs-contribution.test.ts`). `createOrchestratorSessionTabsSnapshot` reads the coordination store, the worktree bindings and each session's heartbeat at most once per injected window, and turns a failing read into an unavailable row with a diagnostic instead of an exception escaping into a render. `orchestratorSessionTabsRail` paints the row and resolves a click against the column range each capability actually occupies, so the dropped tail of a narrow row is not clickable while the visible head of a partially shown item still is.
  - **Why the snapshot is bounded rather than read per frame.** The map card re-reads its single artifact on every render, which is cheap. The coordination store is not: it scans a directory per record kind and one per capability, and presence pages are bounded in megabytes. Reading that on the paint path would be a real cost, so the window is injected and tested with a fake clock.
  - **Presence hashing lives in the adapter, not the projection.** Presence keys a session by `sha256(sessionId)` (`lib/orchestrator-presence.ts:39,256`), so the reader port takes the session ids and returns the present subset; the projection keeps receiving plain session ids and stays free of that format.
  - Closure evidence: focused **12/12** (53 with the other tabs suites), full suite **3,904 (3,866 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [x] **TAB-3c — Register the contribution from the map extension.** **Delivered 2026-09-26**, ~160 changed lines (`extensions/gentle-project-map.ts` and the integration cases in `tests/gentle-project-map.test.ts`), split out because TAB-3b and TAB-3c together measured 493 lines against a 400-line budget. The adapter maps the store's snake_case worktree records to the projection's shape, reads each session's last heartbeat, and hashes session ids for presence. The contribution is registered inside the card's own mount callback, so hiding the card takes the row with it, and a store root that cannot be resolved leaves the row absent rather than failing the card.
  - **The row is on screen, proven end to end.** The integration tests build a real Git repository, initialize a real store, seed a claim, a session binding, a heartbeat and a worktree binding, mount the card and assert the contribution renders `Web · catalog` from the real readers. Two more assert the contribution paints nothing with an empty store, and that unmounting releases it. A temporary agent home with no presence data makes the presence reader report itself unavailable, so the test is deterministic and exercises the documented liveness fallback rather than the presence path.
  - Closure evidence: focused **38/38** for the extension suite, full suite **3,904 (3,866 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [x] **TAB-3d — Paint the read-only detail.** **Delivered 2026-09-26**, 160 changed lines, and acceptance criterion 3 is now met end to end.
  - **Where the detail goes, and the measurement that decided it.** The rail paints a **closed list** of section keys — `["footer", "project-map", "agents", "todo"]` (`lib/shell-sidebar-layout.ts:206`) — so a second card cannot register itself in the rail area at all. Three placements were weighed: the header below the row (no new file, but six or more rows of chrome above the brand bar, pushing identity down every time a tab is selected), a new rail slot (the most correct conceptually, but it adds a key to a deliberately closed list and a slot that is empty whenever nothing is selected), and the card's own rail (no new slot, detail in the rail area, one small extension point). **The user chose the card's rail.**
  - **The card lends its rows rather than growing a second owner.** `projectMapCardRail` and `projectMapCardPart` take an optional `ProjectMapCardDetail`: read-only rows painted below the card, folded into the rail digest, and never given a click. Because the detail is appended after the card, the card's own hit indices keep their meaning, which the tests pin by toggling a group through the card's own row while a detail is stacked below it.
  - **What was verified, and how.** Four unit cases (rows stack below the card and leave it untouched, an empty detail adds nothing, the digest follows the detail, a detail row is never the card's click while the card's own rows keep their indices) and one integration case that seeds a real store, mounts the card, clicks the contributed row and asserts the card's rail now paints the session, its branch and its worktree while the card itself is still there. Closure evidence: focused **21/21** for the card suite and **39/39** for the extension suite, full suite **3,909 (3,871 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [ ] **TAB-4 — Documentation and unit verification.** `docs/gentle-shell.md` and `docs/project-map.md`, the acceptance trace, and the honest record of what was not verified. Forecast ≈ 150 lines.

Every slice stays under the 400-line review budget and is its own commit. The PM-6/PM-7 lesson is budgeted rather than rediscovered: a slice that introduces a human-visible surface costs its estimate plus one audit round.

## Acceptance criteria (all met, traced 2026-09-26)

The unit added **61 tests**: 53 across the three tabs suites, 4 for the card's detail stacking and 4 integration cases that build a real repository and a real store.

1. **A tab exists exactly when the store ties a session to a capability of this repository; ambient presence alone renders nothing.** The projection iterates the store's satellites, never presence — presence is only consulted to settle liveness, and a session absent from it is reported `stale` rather than dropped. Pinned by `a live satellite on a mapped capability becomes one tab in every surface it declares`, `presence overrides a live lease and reports the session as stale`, `an empty map still warns about a session holding a capability it does not declare`, and the integration case `the contribution paints nothing when no session holds a capability the map declares`.
2. **Every tab names its capability, worktree, branch and last activity, all read from the store and never derived from a path.** Pinned by `a tab carries the objective, declared state, worktree, branch and activity`, `a session with no worktree binding still renders, with its worktree left unknown`, `a session with no heartbeat instant reports no activity rather than inventing one`, `the store keeps one worktree binding per capability…`, `when a capability somehow has two bindings, the one belonging to this session wins`, and the integration case `mounting the card contributes one header row group that reads the real coordination store`.
3. **Selecting a tab shows the read-only detail and moves the user out of no session.** Pinned by the eight detail cases, `the rail paints the row and selects the capability a click lands on`, `clicking the selected capability again clears the selection`, and the integration case `selecting a tab paints its read-only detail in the card's rail`. The second half is structural rather than tested: the layer contains no code path that launches a process, attaches, resumes or writes, and `lib/shell-project-map-tabs.ts` imports no store module at all — only the schema, the view's glyphs, the card theme type and pi-tui's width helpers.
4. **A stale or dead session is distinguishable from a live one, and a corrupted store renders no tabs and says so.** Pinned by `a stale session stays visible inside a section that a live session keeps on screen`, `without presence the store's own status decides liveness`, `presence overrides a stale lease and can keep the section on screen`, `a reader that throws yields an unavailable row with a diagnostic instead of escaping`, `an absent map renders no tabs and says the store is unavailable`, `an absent map still forwards the diagnostics it was given` and `the row renders nothing when the store is unavailable`.
5. **The row hides below the 140-column breakpoint with the rest of the chrome, by the existing gate.** No new code: the contributed rows are painted by the header part, and `lib/shell-sidebar-layout.ts` does not install the extension layout below `SIDEBAR_BREAKPOINT`, so the header part is never rendered. Pinned by the pre-existing `only fullscreen at 140 columns activates; shrinking restores bottom paint`, which drives 139 columns; **not separately pinned** is that a contribution in particular disappears there, because it rides on a gate that test already covers.
6. **The layer writes nothing to the store and adds no map field.** Structural, and verified by inspection rather than by a test: the tabs module imports only `node:crypto`, pi-tui, the card theme type, the sidebar contributor type, the map schema and the view's state glyphs — **no store module, reader or writer** — and the only store calls in the unit live in the extension's adapter object, which uses `readProjectMapCoordinationState`, `listProjectMapStoreWorktreeBindings` and `readProjectMapStoreHeartbeat`. The map schema was not touched.
7. **The rail digest changes when the painted tab state changes.** Pinned by `the digest changes when the painted tab state changes`, `the digest is stable while the painted state is stable`, `a diagnostic does not change the digest, because it paints nothing`, `the rail digest follows both the model and the selection`, and on the card side by `the rail digest follows the detail's own digest so a changed detail repaints`.
8. **Only live surfaces get a section (option C).** Pinned by `a surface whose only sessions are stale gets no section` and `a surface with no session on screen is absent from the row entirely`, with the counterpart rule pinned by criterion 4's first case.

## Native review pass (closed 2026-09-26)

**All six candidates approved with their authority burned, and no correction round was opened.** RDD was enabled for the clone for the pass and returned to `off` afterwards, as PM-4 through PM-7 did. Each candidate was reviewed from a worktree pinned at its own tip with `baseRef` set to the previous slice's tip.

| Slice | Candidate range | Lineage | Tier | Lenses | Outcome | Advisory |
|---|---|---|---|---|---|---|
| TAB-1 | `da9f8e17..53730f40` | `review-63a9d8544ef0da3d` | medium | reliability | approved, burned | none |
| TAB-2 | `53730f40..23b97f15` | `review-6689b7665c6d221a` | medium | reliability | approved, burned | none |
| TAB-3a | `23b97f15..8cb31f18` | `review-59a59807cd749fd6` | high | risk, resilience, readability, reliability | approved, burned | 1 |
| TAB-3b | `8cb31f18..b79fa7d3` | `review-5572ad1f176916fa` | medium | reliability | approved, burned | 1 |
| TAB-3c | `b79fa7d3..31a41394` | `review-02933c3717c5deb1` | high | risk, resilience, readability, reliability | approved, burned | 1 |
| TAB-3d | `31a41394..e596c6f4` | `review-105ad6308368e027` | high | risk, resilience, readability, reliability | approved, burned | none |

**Three advisories, all informational and all non-blocking**: `R3-001` at `extensions/gentle-shell.ts:968` (TAB-3a), `R3-truncation-hit` at `lib/shell-project-map-tabs.ts:244` (TAB-3b) and `R3-001` at `tests/gentle-project-map.test.ts:674` (TAB-3c). None opened a correction, none reopens its review, and none is a reason to re-run a closed candidate; they are later work against those files.

**Two things worth knowing about the tiers.** TAB-1 and TAB-2 came back **medium with a single lens** despite being 387 and 282 changed lines, because a pure projection and a pure renderer start no process — the tier follows `shell_process`, not size, exactly as PM-7's pass showed. TAB-3c is **high for a reason worth recording**: its 163 lines are mostly a test file, and what raised the tier was `execFileSync` in the integration fixture that builds a real Git repository. A test that shells out is still a process boundary to the provider.

**The pass cost six forecasts and eighteen reviewer runs** — four each for the three high-tier candidates, one each for the three medium ones — not the twenty-four a uniform four-lens pass would have cost.

**Two binding submissions were rejected, and the rejection was correct both times.** Both were transcription errors on my side inside an opaque provider binding: one character in TAB-1's `baseTree`, one in TAB-3c's `repository-context` handle. The provider refused them as unknown, the slot was **not** consumed, and resubmitting the exact binding worked. The lesson is that an opaque binding is copied, never typed from memory, and that a rejection here costs nothing but a retry.

**Not reviewed**: TAB-4 (`e596c6f4..a6dc0b05`) is documentation and the acceptance trace with no executable change, which the entry rule exempts as a passive documentation-only edit. Its content is verified indirectly, because the trace it adds cites the tests the other six candidates were reviewed against.

## Progress

- 2026-09-26: **unit planned** after a read-only surface recon. The findings that shaped the plan: the header row is already a single full-width sibling registered through `sidebarHeader(...)`, so the tabs extend it and inherit its 140-column gate instead of adding a second narrow-mode rule; the coordination state already exposes exactly the five facts a tab needs (capability, session, lease status, heartbeat freshness, blockers) and `listProjectMapStoreWorktreeBindings` supplies branch and root, so **no store or schema change is required**; and decision 2's list shape collides with the agreed single-row placement, which is recorded above as the one open decision rather than resolved silently. Nothing has been implemented at that point; TAB-1 was the next work unit once the shape decision was settled.
- 2026-09-26: **shape decision settled — option C** (a surface section renders while at least one session bound to one of its capabilities is live; a purely stale surface renders no section), recorded above with its three rejected alternatives and pinned as acceptance criterion 8.
- 2026-09-26: **TAB-1 delivered** (`lib/shell-project-map-tabs.ts`, 362 new lines with its suite). `deriveOrchestratorSessionTabs` is a pure function over already-read values: no filesystem access, no `process.env`, no store write, and every reader stays injected at the composition site. It joins the satellites to the map, resolves liveness by the presence precedence rule, resolves the worktree binding per capability, and builds the surface sections in the schema's own surface order. Closure evidence: focused **21/21**, neighbours **502/502**, full suite **3,859 (3,821 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Nothing is wired into the shell at that point, so no acceptance criterion beyond the projection's and the renderer's own is met; criteria 3, 5 and 7 belong to TAB-3.
- 2026-09-26: **header ownership settled — option 1** (the shell keeps the region and paints contributed rows; the map extension registers the tabs row), recorded above with its two rejected alternatives, and the two files it needs added to the authorized surfaces.
- 2026-09-26: **TAB-3a delivered** — the header contributor registry and its composition. The single-owner slot no longer blocks a second data owner, and the fixed-index mouse routing that would have broken the usage click is replaced by row-group routing. Closure evidence: focused **121/121**, full suite **3,889 (3,851 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Deliberately not verified at that point: the row still was not on screen, so criteria 3 and 7 waited for TAB-3b; criterion 5 was satisfied without new code by the existing 140-column gate.
- 2026-09-26: **TAB-3b delivered** — the bounded snapshot (one store read per injected window, a failing read degraded to an unavailable row with a diagnostic) and the row rail (selection resolved against the columns actually painted). 374 changed lines. Closure evidence: focused **12/12**, full suite **3,904 (3,866 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- 2026-09-26: **TAB-3c delivered** — the contribution registered from the map extension, with the real store adapters (snake_case worktree records mapped, last heartbeat read, session ids hashed for presence) and three integration tests that build a real repository and a real store and assert the row renders, stays absent with an empty store, and is released when the card unmounts. **The row is now on screen**: criteria 1, 2, 6, 7 and 8 are met, and criterion 5 by the pre-existing gate. The pass measured 493 lines for TAB-3b plus TAB-3c together against the 400-line budget, so the two were committed separately rather than as one oversized candidate.
- 2026-09-26: **TAB-3d delivered** — the read-only detail paints in the card's rail, chosen after measuring that the rail's sections are a closed list. 160 changed lines. **All eight acceptance criteria are now met**: 1, 2, 6, 7 and 8 by the projection and the contribution; 3 by this slice; 4 by the liveness rules the renderer and the projection pin; 5 by the pre-existing 140-column gate. Closure evidence: focused **21/21** and **39/39**, full suite **3,909 (3,871 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- 2026-09-26: **TAB-2 delivered** with the row and the read-only detail (273 changed lines). The row is one measured line built from the live sections, a multi-session capability collapses to one item carrying `×2`, the selected capability is marked in every section it appears in, and the detail lists the objective, the declared state, the blockers, the next action and one block per session with its worktree, branch, liveness and last activity. An unknown worktree is said to be unknown rather than rendered as a path. Closure evidence: focused **20/20**, neighbours **522**, full suite **3,879 (3,841 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Nothing is wired into the shell yet, so criteria 3, 5 and 7 are TAB-3's.
