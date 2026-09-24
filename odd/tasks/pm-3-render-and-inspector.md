# PM-3 — Render the real map and capability inspector

## Objective
Put the approved Project Map on screen as a real card below Status, driven by the repository's own versioned definition instead of demo data, and make each capability inspectable so a person can see what exists, what is missing, and what is blocked without reconstructing the project from feature documents.

This is the third work unit of the initiative roadmap recorded in `odd/tasks/project-map-orchestration.md`. It consumes PM-1's schema and PM-2's artifact, and it replaces nothing.

## Problem
The map exists as a validated artifact and a command, but nothing draws it. A person can generate a draft and approve it and then never see the result. The only rendering that ever existed is an uncommitted session-only prototype in a different clone, built on a base 151 commits behind, holding hardcoded Example Shop strings that describe a fictional product.

## Why
The roadmap's central claim is that the map is the project's navigation surface, not a post-hoc report. A definition nobody can see cannot be navigation. Until the card exists, the map is a file and a promise.

## Decisions (approved by the user)
- **The prototype is discarded and the rendering is rewritten.** Its data is fabricated, its layout assumptions predate the current sidebar API, and it does not cover render digests, width safety, or narrow mode — three things this unit must cover. Only its approach survives: a card built with `renderCard`, registered through `sidebarPart`, toggled per session.
- **The human enters through sub-actions on the existing command.** `show`, `hide`, `status`, `draft`, and `approve <actor>` all live on `/gentle:project-map`, following the `gentle:review-mode` precedent. This removes the command-name collision with the prototype instead of creating a second command for one feature.
- **The unit is staged, read-only first.** PM3-1 renders the real map with its slot, digest, width safety, narrow mode, and empty and invalid states. PM3-2 adds coverage explanations and grouping. PM3-3 adds row selection, the inspector, and viewport behavior. Each stage is independently reviewable.
- **Surface collection belongs to this unit.** PM-2 documented a workflow gap where a generated draft cannot be approved because the generator never infers surfaces and the approval gate requires them. PM-3 closes it, so the loop "draft, declare, approve" completes inside the shell instead of requiring hand-edited JSON.

## Scope
- A render library that turns the validated artifact into card lines, with a stable digest.
- A `project-map` rail slot ordered between Status and Agents.
- Session-scoped show and hide, with no state on disk.
- Empty, invalid, draft, and approved states, each rendered distinctly.
- Per-surface coverage derived from capability state, with unknown reported as unknown.
- Coverage explanations, grouping, and collapse.
- Row selection, a capability inspector, and viewport behavior.
- Interactive surface declaration for a capability.
- Documentation of the card, the states, and the workflow.

## Non-goals
- The runtime overlay: claims, leases, heartbeats, session bindings, worktrees, and transient blockers are PM-4 and PM-5 and do not exist in code. The renderer takes an overlay input that is currently always empty, so the seam exists and no fabricated data is rendered.
- Opening a Pi session for a ready capability, and any `[Open Pi]` action (PM-7). A ready capability is rendered as ready; the action is absent, not disabled by a guess.
- Integration ordering and readiness receipts (PM-8).
- Any commit, push, PR, or release as a consequence of what the card shows.

## Constraints
- TDD mode: strict (`openspec/config.yaml` declares `strict_tdd: true`); runner `node --experimental-strip-types --test tests/<file>.test.ts`.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons.
- No new runtime dependency.
- The card must never overflow its width. `lib/shell-sidebar-layout.ts` deactivates the whole sidebar when any rail line exceeds the content width, so an overflowing card is not a cosmetic bug: it silently removes the sidebar.
- The rail must declare `digest?(): string` so the existing per-section cache re-renders the map independently of Status and TODO updates.
- Single writer; no parallel writes.
- ~~`pnpm` and `node_modules` are absent in this worktree, so the full suite and the typecheck gate cannot run here; focused `node --test` runs and an explicit limitation note are the substitute evidence.~~ Superseded 2026-09-23 (see Progress): `node_modules` and `.gentle-ai` are installed in this worktree, so focused suites, the rendering suites, the full suite, and `node scripts/check-types.mjs` all run here.

## Authorized edit surfaces
- `odd/tasks/pm-3-render-and-inspector.md`
- `lib/shell-project-map-view.ts` (new)
- `tests/shell-project-map-view.test.ts` (new)
- `extensions/gentle-project-map.ts`
- `tests/gentle-project-map.test.ts`
- `lib/shell-sidebar-layout.ts`
- `tests/shell-sidebar-layout.test.ts`
- `docs/project-map.md`
- `docs/gentle-shell.md`

Verified as not required: the prototype's files are not copied, so no path is taken from it. `package.json` declares `pi.extensions: ["./extensions"]`, so no registration list changes. `scripts/verify-package-files.mjs` enforces presence of a minimum set and does not reject unlisted files outside `contracts/`.

## Card contract

```text
state:  empty   — no artifact, or the artifact could not be read
        invalid — the artifact exists and the validator rejected it
        ready   — a validated map, whose own approval.state is draft or approved
rows:   Foundations, then Product capabilities, then Coverage
glyphs: done ✓   active ◉   review ◉   ready ○   blocked ✕   planned ○
```

- The subtitle carries the project name and the approval state, because a draft map must never read as an approved one.
- Coverage is computed per surface as the share of capabilities that declare the surface and are `done`. A surface no capability declares is rendered as unknown, never as `0%`, because an undeclared surface is an absence of evidence rather than evidence of absence.
- The digest is derived from the rendered lines, so it changes exactly when the visible card changes.
- The overlay input is accepted and empty; nothing renders from it until PM-4 supplies data.

## PM3-2 design (fixed before the first source write)

- Groups: `Foundations` and `Product capabilities` become collapsible groups. Each header carries a compact indicator of done over total (`▾ Foundations 2/3`, `▸ Product capabilities 6/12`) and the collapse glyph (`▾` expanded, `▸` collapsed). An empty foundations list renders no group; the capabilities group always renders.
- Collapse state: `{ foundations: boolean; capabilities: boolean }` per session, in memory, dropped on session shutdown, exactly like visibility; `true` means collapsed.
- Interaction: one configurable shortcut folds and unfolds both groups at once — fold all when any group is expanded, unfold all otherwise — following the Todo and Agents precedent of an env-overridable key plus a top-rule hint. Clicking a group header in the rail toggles that group alone; the narrow bottom stays a non-interactive summary. Hover styling, per-row selection, and viewport behavior stay out (PM3-3).
- Coverage explanations: every declared surface renders its value and the capabilities behind it with their state glyph (`Web 67% (2/3): auth ✓, search ✓, billing ✕`), pre-wrapped at the existing coverage budget so the descriptor keeps its 60-column bound; an undeclared surface still renders `—`.
- Narrow bottom: one compact summary line (`2/3 foundations · 6/12 capabilities`) instead of the first group header.
- The digest is derived from the descriptor built with the collapse state, so a toggle re-renders the map section and nothing else.

## PM3-3 design (fixed before the first source write)

- Selection is a session-scoped capability id. Shortcuts `alt+j` and `alt+k` (env `GENTLE_PI_PROJECT_MAP_NEXT_KEY` and `GENTLE_PI_PROJECT_MAP_PREV_KEY`, `off` disables either) move it over the capabilities in canonical order and clamp at the ends; the first move with nothing selected selects the first capability. Clicking a capability row selects it, and clicking the selected row clears it. Moving to a capability whose group is collapsed expands that group: a selection the card cannot show is not a selection.
- The selected row is marked at column 0 with `▸ ` in the accent role, replacing that row's two-space indent, so the lifecycle glyph keeps column 2 and the group headers keep their own glyph.
- Inspector: an `Inspector` section appended to the body after Coverage whenever a capability is selected. It renders the id, the outcome, the state, the declared surfaces, the referenced foundations and dependencies with their state glyphs, the contracts, and the feature documents. Blockers are static only — the blocked state, a non-done dependency, or a non-done foundation — and runtime blockers are reported as unavailable until PM-4, never fabricated.
- Viewport: the descriptor exposes its structured body (lines, group-header body indices, selected-row body index) so click targets and the reveal target come from the same structure instead of scanning rendered text; the card converts a body index to a rendered line by wrapping height. `lib/shell-sidebar-layout.ts` gains a reveal bridge on `sidebarState` that `installSidebar` sets and its disposer clears: it scrolls the rail with `ScrollView.scrollTo` only when the target line is outside the viewport. A rail part cannot take keyboard focus without stealing typing from the editor, so navigation stays on global shortcuts and clicks.
- Out of scope: opening a Pi session for a capability (PM-7), runtime claims and blockers (PM-4 and PM-5), and any inspector action that mutates the artifact.

## PM3-1b design (fixed before the first source write)

- `lib/shell-project-map-card.ts` owns the composition: artifact path → `projectMapCardState` → `projectMapCardDescriptor` → `renderCard(card, theme, width, { expanded })`. Width safety is inherited from `renderCard`, which clips and pads every line to exactly `width`.
- The rail renders expanded and scrolls with the rail; the narrow-mode bottom renders the same card collapsed to one line, exactly like the Todo card's rail/bottom pair. Collapsing for space is not the collapse interaction, which stays in PM3-2.
- `projectMapCardDigest` keeps its `(state)` signature and hashes the descriptor the card renders from (`title`, `subtitle`, `tone`, `body`). That closes the invalid-message drift, drops the false positive where a field the card never renders moved the digest, and leaves the existing digest tests compiling.
- Visibility is session-scoped and data-dependent: a `ready` artifact mounts the card by default, and an empty or invalid artifact stays out of the rail until an explicit `show`. A map is navigation; a missing or broken artifact is a diagnostic and must not take rail space unasked.
- `show` and `hide` are sub-actions of the existing command. `hide` disposes the registered rail part and clears the widget; nothing is written to disk.
- Rail order becomes `["footer", "project-map", "agents", "todo"]`. A part that is not registered contributes no line and no separator, so the change is inert for every other card.

## Tasks

- [x] **PM3-1a — Pure card core of the real map** (delivered 2026-09-23)
  - Read the artifact through the schema's own reader and classify the result as empty, invalid, or ready. — `lib/shell-project-map-view.ts`
  - Compute per-surface coverage from capability state, and render an undeclared surface as unknown.
  - Render Foundations, Product capabilities, and Coverage as card lines, with a glyph per state and the approval state in the subtitle. — `projectMapCardDescriptor`
  - Cover the empty, invalid, draft, and approved states, width safety at the narrowest card, and the digest. — `tests/shell-project-map-view.test.ts`, 16 tests
  - Evidence: commits `21b4dce7` (pure data core) and `33eb4500` (silence the type-checker gate without union narrowing), reviewed and approved; `node --experimental-strip-types --test tests/shell-project-map-view.test.ts tests/gentle-project-map.test.ts` → 34/34 pass, 0 fail.

- [x] **PM3-1b — Card composition and shell wiring**
  - `lib/shell-project-map-card.ts`: compose `projectMapCardDescriptor` through `renderCard`, and derive the digest from the descriptor the card renders so it cannot drift from what the card shows (closes the R3 finding recorded in Progress).
  - Register the `project-map` rail between the `footer` and `agents` sections (the plan's "Status" is that footer), mounted only while shown, with the same component as the narrow-mode bottom so the card stays visible below the editor when the sidebar is inactive.
  - Add `show` and `hide` sub-actions that are session-scoped and write nothing to disk, and keep rejecting an unknown sub-action by listing the valid ones.
  - Cover the composition at boundary widths, the rail ordering, the digest re-render, the narrow-mode bottom, and the sub-action validation. — `tests/shell-project-map-card.test.ts`, `tests/gentle-project-map.test.ts`, `tests/shell-sidebar-layout.test.ts`
  - Update `docs/project-map.md` and `docs/gentle-shell.md` with the card, its states, and the sub-actions; PM3-5 still owns the unit-level documentation and verification.
  - Evidence: commits `7cb359f4` (design), `ef4ac0ab` (composition core), `8d87cbd8` (shell wiring and docs); 471 changed lines across 11 files, consolidated into one medium review (`review-f1a096e37abefa06`, `review-reliability`, approved and acknowledged, authority burned, zero corrections); full suite 3488 pass / 0 fail / 38 skipped and a clean type gate on the reviewed tree.

- [x] **PM3-2 — Coverage explanations and grouping**
  - Explain each coverage value in terms of the capabilities behind it, so a percentage is never the only thing on screen.
  - Group and collapse Foundations and Product capabilities, and keep the collapsed state session-scoped.
  - Cover the explanation text, the grouping, and the collapsed rendering.
  - Evidence: commits `0859b7b6` (design) and `37b43a74` (implementation); 540 changed lines across 9 files; lineage `review-1ff91259c3902660` (medium, `review-reliability`) approved, acknowledged and burned with zero corrections; full suite 3541 pass / 0 fail / 38 skipped and a clean type gate on the reviewed tree.

- [ ] **PM3-3 — Row selection and the capability inspector**
  - Select a capability row and reveal its outcome, dependencies, surfaces, feature documents, and blockers.
  - Keep the selection inside the viewport, including when the card is taller than the rail.
  - Cover selection movement, the viewport bounds, and the inspector content.

- [ ] **PM3-4 — Interactive surface declaration**
  - Declare a capability's surfaces from the shell and persist through the existing writer, which closes the PM-2 workflow gap.
  - Refuse to declare a surface that is not in the frozen vocabulary, and never write without a confirmation.
  - Cover the declaration, the refusal, and the resulting approval.

- [ ] **PM3-5 — Documentation and verification**
  - Document the card, the states, the coverage rule, the digest, the narrow-mode behavior, and the completed draft-declare-approve loop.
  - Focused test files green; full suite and typecheck attempted and their unavailability recorded honestly.

## Acceptance criteria
- The card renders Foundations, Product capabilities, and Coverage from the repository's artifact, with no hardcoded project data anywhere.
- A missing or unreadable artifact renders an empty state, and an invalid artifact renders its diagnostics; neither renders a blank card or throws.
- A draft map is visibly a draft: the approval state appears in the card and never reads as approved.
- No rendered line exceeds the requested width at any boundary width, so the sidebar is never deactivated by this card.
- The digest changes when the visible card changes and does not change when it does not.
- An undeclared surface renders as unknown, and no coverage value is ever derived from data the artifact does not state.
- The `project-map` slot sits between Status and Agents, and hiding the card removes it without disturbing the other cards.
- Showing and hiding write nothing to disk and affect only the current session.
- The narrow-mode card is visible below the editor rather than silently absent.
- The overlay input is present, empty, and rendered from nothing.
- `/gentle:project-map` rejects an unknown sub-action by listing the valid ones and writing nothing.

## Review workload forecast
Estimates: PM3-1 ≈ 420 lines (view library, its tests, the extension wiring, the layout slot, and the extension tests), PM3-2 ≈ 300, PM3-3 ≈ 400, PM3-4 ≈ 350, documentation ≈ 120. The unit total exceeds the 400-line review budget several times over, so it is implemented and reviewed as separate work-unit commits, each reporting its own measured size. PM3-1 is at the budget boundary and is split further if it measures over.

## Progress
- 2026-09-23: PM3-2 closed. Commits `0859b7b6` (design) and `37b43a74` (groups, collapse, explanations, summary line, shortcut, click targets). Measured 540 changed lines across 9 files — over the 400-line budget — and the native review consolidated the range `36ba2c8b..37b43a74` into one medium candidate with the single `review-reliability` lens, lineage `review-1ff91259c3902660`, approved and acknowledged with its authority burned, zero corrections. Gates on the reviewed tree: full suite 3541 pass / 0 fail / 38 skipped; `node scripts/check-types.mjs` 195 recorded diagnostics, no regressions.
- 2026-09-23: Independent verification (`gentle-ai-verify`, read-only, /tmp mutations) falsified four claims; the first three were fixed before commit. (a) Diagnostic text of an invalid artifact could be clicked and toggled a group, because the header map scanned rendered text: only a `ready` map now exposes click targets, and the diagnostic row stays inert, with a regression test. (b) The frame-skip guard had no discriminating test, because `"Foundations"` alone cannot match the header pattern: the title test now uses a project named `▾ Foundations 1/1` and fails when the guard is removed. (c) The 60-column descriptor bound was overstated: the invalid body is now bounded like the ready body, and the claim is scoped to body lines, because the subtitle carries the free-form project name (72 columns at the 64-character maximum) and `renderCard` clips it at render time. Both mutation checks for (a) and (b) now fail the suite as intended.
- 2026-09-23: Carried debt, informational, no review reopening. `R3-001` (reliability, WARNING) at `extensions/gentle-project-map.ts:369`, delivered by the provider's closure without text. A wrapped capability row loses its two-space indent in the continuation line, which belongs to the shared `renderCard` wrapping rather than to this unit.
- 2026-09-23: PM3-1b closed. Commits `7cb359f4` (design), `ef4ac0ab` (composition core), `8d87cbd8` (shell wiring and docs). Measured 471 changed lines across 11 files — over the 400-line budget — so it was committed as three slices; the native review consolidated the range `33eb4500..8d87cbd8` into one medium candidate with the single `review-reliability` lens, lineage `review-f1a096e37abefa06`, approved and acknowledged with its authority burned, zero corrections. Gates on the reviewed tree: full suite 3488 pass / 0 fail / 38 skipped; `node scripts/check-types.mjs` 195 recorded diagnostics, no regressions.
- 2026-09-23: Independent verification (`gentle-ai-verify`, read-only, working-tree diff) falsified three claims and all three were fixed before commit: the digest canonicalized the map and recomputed coverage while the card renders the supplied state (now the digest is the descriptor of the state as given); malformed JSON classified as empty and hid a real error against the card contract (now invalid, with its diagnostic); the widget omitted its placement and mounted above the editor rather than below (now `{ placement: "belowEditor" }`). Its width probe (widths 1-160, a 543-character diagnostic row, unbreakable identifiers) found no overflow, and the `cardLine` clipping mutation is caught by `tests/shell-card.test.ts`, so the reported test-sensitivity gap is not a coverage hole.
- 2026-09-23: Carried debt from the review: `R3-001` (reliability, WARNING, informational) at `extensions/gentle-project-map.ts:315`. The provider delivered it as a non-blocking advisory without text and it never reopened the candidate; treat it as separate later work, and do not re-run review on `review-f1a096e37abefa06` for it.
- 2026-09-23: The verifiability premise of the PM3-1 split is void. `node_modules` and `.gentle-ai` are installed in this worktree (`npx --yes pnpm@11.1.1 install --frozen-lockfile`, then `node scripts/install-gentle-ai.mjs`), so PM3-1b is fully verifiable here: the focused suites, the rendering suites (`shell-card`, `shell-todo`, `shell-sidebar-layout`, `gentle-todo`), the full suite, and `node scripts/check-types.mjs` all run. The split stays as a work-unit boundary — each half is independently reviewable and under the 400-line budget — not as an excuse for unverified code.
- 2026-09-23: PM3-1a closed. Commits `21b4dce7` and `33eb4500`; `tests/shell-project-map-view.test.ts` holds 16 tests and the view plus command suites pass 34/34 with 0 failures on the current tree. PM3-1b scoped as the next work unit.
- 2026-09-23: One review finding carried into PM3-1b. `projectMapCardDigest` keys the invalid state on `code@path` only (`lib/shell-project-map-view.ts:170`) while the card renders `path: message`, so two invalid artifacts that differ only in a diagnostic message render differently and digest identically: the section cache would keep painting the stale card. The card contract already requires the digest to be derived from the rendered lines, so PM3-1b implements that instead of extending the key, which removes the whole drift class.
- 2026-09-23: PM3-1 split into PM3-1a and PM3-1b after measuring. The boundary is verifiability: everything that imports the TUI runtime is unverifiable in this clone, because `node_modules` is absent and every rendering suite in the repository fails for that reason (`shell-card`, `shell-todo`, `shell-sidebar-layout`, `gentle-todo`). PM3-1a is the pure view core, which imports no runtime and therefore runs; PM3-1b is the thin `renderCard` composition plus the shell wiring, which cannot run here and is recorded as such. Each half stays under the 400-line budget.
- 2026-09-23: Unit planned after read-only exploration of both the uncommitted prototype in the sibling clone and the current rendering surfaces in this branch. Decisions on the prototype, the entry point, the staging, and surface collection accepted by the user as recommended. Task document created before the first source write. PM3-1 through PM3-5 pending.

## Next decision
PM3-2 is closed. PM3-3 (row selection, the capability inspector, and viewport behavior) is the next stage of this unit and needs an explicit go-ahead before its first source write; its own decided surfaces come with it. Commit, push, and PR remain separate decisions and require explicit authorization.
