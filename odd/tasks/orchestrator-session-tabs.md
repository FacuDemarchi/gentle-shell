# Orchestrator session-tab layer

Status: **planned, not implemented.** One shape decision is open (see "Open decision" below) and blocks the first source write.

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

## Open decision (needs the user before the first source write)

Decision 2's literal form — a capability repeated under each surface it requires — is a **list** shape, while the agreed placement is a **single full-width row** between the host bar and the `✿ Gentle Shell` bar. At 140 columns, a row that repeats capabilities across up to seven surfaces overflows as soon as a project has a handful of live sessions. Three ways to reconcile it, and the plan does not choose silently:

| Option | Row shows | Cost |
|---|---|---|
| A. Section labels in the row, capability repeated | `Web · Merchant catalog, Checkout   API · Checkout` | Closest to decision 2 verbatim; truncates soonest. |
| B. One tab per capability, surface tags on the tab | `[Merchant catalog · Web API DB] [Checkout · Web API DB]` | Never repeats a capability, so it fits far more; the surface grouping becomes an attribute instead of a section. |
| C. Sections in the row, capability repeated, but only for surfaces with a live session | As A, filtered | Fits best in practice; hides a surface with no live session, which is the common case. |

## Collision map

- `lib/shell-sidebar-layout.ts` owns the header row as a single full-width sibling above the hstack (`:38`, `:110`, `:203`), with `SIDEBAR_BREAKPOINT = 140` (`:5`). PM-3 already settled this file, so the entry point exists and this unit extends it rather than re-cutting it.
- `odd/tasks/fullscreen-live-header.md` owns the header row's origin. That unit has landed — the `header` slot, `headerActive`, and `sidebarHeader(...)` at `extensions/gentle-shell.ts:947` all exist — so the collision is extend-only.
- `lib/shell-project-map-card.ts:137` is the registration precedent to mirror (`sidebarPart(tui, key, bottom, rail)`).
- This layer must not change how agents or terminals are created.

## Authorized edit surfaces

- `lib/shell-project-map-tabs.ts` (new: the pure projection and the row/detail rendering).
- `tests/shell-project-map-tabs.test.ts` (new).
- `lib/shell-sidebar-layout.ts` (the header region only).
- `extensions/gentle-shell.ts` (the header composition site only).
- `tests/shell-sidebar-layout.test.ts`, `tests/gentle-shell.test.ts` (the header cases only).
- `docs/gentle-shell.md`, `docs/project-map.md`.
- `odd/tasks/orchestrator-session-tabs.md`, `odd/tasks/project-map-orchestration.md`.

Anything outside this list is a scope question, not an edit.

## Task list

- [ ] **TAB-1 — Pure tab projection.** `deriveOrchestratorSessionTabs(...)`: join the coordination state's satellites (capability, session, claim, lease status, heartbeat freshness) with the worktree bindings (branch, worktree root) and the approved map (objective, surfaces, declared state), then group and order deterministically. Readers injected; no I/O of its own. Forecast ≈ 280 lines with fixtures.
- [ ] **TAB-2 — Row and detail rendering.** Measured, width-safe lines for the row and for the read-only detail of the selected tab, behind the same decision that names the diagnostic when the store is unavailable. Forecast ≈ 260 lines.
- [ ] **TAB-3 — Header wiring and selection.** Compose the row into the existing header region with a digest, wire selection, and prove the narrow-mode rule by the existing gate rather than a new one. Forecast ≈ 220 lines.
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

## Review disposition

RDD is **off** for this clone, as it was for PM-4 through PM-7. The unit therefore carries parent verification plus independent audits, and its deferred native review pass runs when the unit closes, one candidate per slice, from a worktree pinned at that slice's tip with `baseRef` set to the previous slice's tip, with RDD enabled for the pass and returned to `off` afterwards. No review is started mid-unit and never against a tree with a writer still running.

## Progress

- 2026-09-26: **unit planned** after a read-only surface recon. The findings that shaped the plan: the header row is already a single full-width sibling registered through `sidebarHeader(...)`, so the tabs extend it and inherit its 140-column gate instead of adding a second narrow-mode rule; the coordination state already exposes exactly the five facts a tab needs (capability, session, lease status, heartbeat freshness, blockers) and `listProjectMapStoreWorktreeBindings` supplies branch and root, so **no store or schema change is required**; and decision 2's list shape collides with the agreed single-row placement, which is recorded above as the one open decision rather than resolved silently. Nothing has been implemented; TAB-1 is the next work unit once the open decision is settled.
