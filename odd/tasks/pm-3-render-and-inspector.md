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

- [x] **PM3-3 — Row selection and the capability inspector**
  - Select a capability row and reveal its outcome, dependencies, surfaces, feature documents, and blockers.
  - Keep the selection inside the viewport, including when the card is taller than the rail.
  - Cover selection movement, the viewport bounds, and the inspector content.
  - Evidence: commits `00667b8a` (design) and `2998c026` (implementation); 511 changed lines across 12 files; lineage `review-e2f931d344cf1252` (medium, `review-reliability`) approved, acknowledged and burned with zero findings and no advisory; full suite 3553 pass / 0 fail / 38 skipped and a clean type gate on the reviewed tree.

- [x] **PM3-4 — Interactive surface declaration**
  - Declare a capability's surfaces from the shell and persist through the existing writer, which closes the PM-2 workflow gap.
  - Refuse to declare a surface that is not in the frozen vocabulary, and never write without a confirmation.
  - Cover the declaration, the refusal, and the resulting approval.
  - Design, fixed before the source write (2026-09-24):
    - Grammar, decided by the user as `set`: `/gentle:project-map declare <capability-id> <surface>...` replaces that capability's declared surface list with exactly those surfaces; the same command with no surface clears the list back to "not yet determined", which a draft allows. There is no additive mode, no removal operator, and no separate `undeclare`, so one invocation always describes the whole state, and no grammar exists that the command cannot state in its confirmation.
    - Pure transition in `lib/shell-project-map-approval.ts`, mirroring `approveProjectMap`: `declareProjectMapSurfaces(request: { map, capabilityId, surfaces })` returns `ProjectMapApprovalOutcome`, performs no I/O and mutates nothing. It refuses, in this order, before any change: an approved map (the PM3-4 decision `refuse-approved`, and the diagnostic says that changing an approved plan requires returning it to draft, which this version does not support), an empty capability id, a capability id the map does not declare (naming the ids it does declare), and a surface that is outside `PROJECT_MAP_SURFACES` or repeated in the argument (naming the vocabulary). The accepted candidate revalidates through `validateProjectMap`, so canonical surface ordering and every existing invariant land exactly once, in the same place as approval.
    - Extension wiring: `declare` joins `PROJECT_MAP_SUB_ACTIONS`, and `USAGE` becomes per-sub-action text so it never advertises an argument shape the action does not take. The declare branch reuses the draft/approve write path with no shortcut: read the artifact behind the unreadable guard, capture the observed source, run the transition, notify the resulting change, `ctx.ui.confirm` (never write without a confirmation, and `hasUI: false` never writes), then the `artifactMovedSince` guard, then `writeProjectMapFile`.
    - Docs: the "today that means editing `openspec/project-map.json` directly" gap in `docs/project-map.md` is replaced by the declare loop, and the sub-action joins the command surface section.
    - Tests: the pure transition is covered in `tests/shell-project-map-approval.test.ts` (set, clear, canonical order, and every refusal). The command is covered in `tests/gentle-project-map.test.ts`, where `declareEverySurface` stops editing the artifact by hand and drives the command instead, which is the honest test of the loop: declaration persists, a refusal writes nothing, a declined confirmation writes nothing, and the approve that follows a declaration succeeds.
  - Evidence: commits `27908b06` (design), `cf6ff425` (pure transition and its tests) and `2c0d6edc` (command, command tests, docs); 400 changed lines across 6 files; lineage `review-0aca0531761be1e3` (medium, `review-reliability`, 6 files / 400 lines, budget 200) approved, acknowledged and burned with zero corrections; full suite 3568 tests / 3530 pass / 0 fail / 38 skipped and a clean type gate on the reviewed tree.

- [x] **PM3-5 — Documentation and verification**
  - Document the card, the states, the coverage rule, the digest, the narrow-mode behavior, and the completed draft-declare-approve loop.
  - Focused test files green; full suite and typecheck attempted and their unavailability recorded honestly.
  - Design, fixed before the documentation write (2026-09-24):
    - Scope is documentation and evidence only: no behaviour change, no `lib/` change, no test change. A verification result that falsifies behaviour rather than a doc sentence is reported as a finding and left to its own work unit, because PM3-5 holds no authority to change the card.
    - Claim audit first, then write. A read-only auditor adjudicated every factual claim about the card and the command in `docs/project-map.md` (Command surface, Sidebar card, Surface declaration loop) and `docs/gentle-shell.md` (Gentle Project Map) against the implementation: 15 of 15 verified with file:line evidence. The same audit mapped all 11 acceptance criteria of this unit to covering tests: 11 of 11 covered. Only the gaps it found are edited; nothing is rewritten for style.
    - The five gaps and their resolutions. (a) Narrow mode renders the descriptor body for an empty or invalid artifact, not the completion summary: documented with the exact texts (`No Project Map at openspec/project-map.json.`, the diagnostic list). (b) The invalid card is bounded to three diagnostics followed by `Run /gentle:project-map status for the full report.` (`lib/shell-project-map-view.ts:70,233-234`): the ceiling and the pointer are documented. (c) A capability row whose identifier wraps keeps every continuation line as a click target (`lib/shell-project-map-view.ts:215`, `lib/shell-project-map-card.ts:61-64`): documented. (d) Every writing sub-action re-reads the artifact after its confirmation and refuses to write when the file moved, reporting it instead (`extensions/gentle-project-map.ts:233,262,310` and the staleness guard): the invariant is documented; the exact dialog strings deliberately are not, because freezing presentation text would make the docs claim wording the code is free to change. (e) The reserved rail order is `footer → project-map → agents → todo` and `agents` is omitted while unregistered, which is why the visible rail reads Status → Project Map → TODO: documented, resolving the apparent contradiction with this unit's wording "between Status and Agents".
    - Two coverage gaps found by the same audit are recorded, not fixed, because PM3-5 writes no tests: no test renders the invalid card's three-diagnostic ceiling with its follow-up line, and no test renders the narrow-mode bottom for an empty or invalid artifact. Both behaviours are documented, and both are reported to the user as separate work instead of being silently absorbed or dressed up as verified.
    - Bookkeeping reconciliation, because the roadmap drifted: `odd/tasks/project-map-orchestration.md` marks PM-2 done (its unit document closed it), marks PM-3 done at this stage's close, and replaces the stale "PM-1 is closed" next decision.
    - Verification: focused suites, full suite and `node scripts/check-types.mjs` re-run on the final tree and recorded with their real counts; the acceptance-criterion-to-test matrix recorded here as the unit's verification evidence.
  - Evidence: commits `ab623c54` (design), `239d4da6` (documentation of the five gaps), `977bd67b` (correction of the falsified narrow-mode sentence plus the link to the declaration loop) and `9be2efbb` (this closure); the first pass of this evidence line cited a closure commit that did not exist, caught before the stage was reported and corrected here.
  - Native review: lineage `review-26a81295c7bac52f`, tier `low`, 4 files / 56 changed lines, no lenses required (`non_executable_only`, documentation only), approved and acknowledged with its authority burned, zero corrections and no advisory.
  - Independent verification (`gentle-ai-verify`, own execution, 2026-09-24) adjudicated every documentation claim against the implementation, first to choose what to write and again after writing. The 15 pre-existing claims hold, each with file:line in `lib/shell-project-map-view.ts`, `lib/shell-project-map-card.ts`, `lib/shell-project-map-approval.ts`, `extensions/gentle-project-map.ts` and `lib/shell-sidebar-layout.ts`. It falsified one sentence this stage had just written: the collapsed bottom of an invalid artifact shows `The Project Map artifact is not valid:`, not its first diagnostic, because a collapsed card keeps the first body line and truncates the rest. Both docs now state what renders, and the verifier's second point — that no width can promise the whole quoted notice — is stated too. The correction is commit `977bd67b`, which is the verification earning its keep rather than a rubber stamp.
  - Acceptance criteria: all 11 have covering tests; three are partial and are recorded as partial instead of being rounded up.
    - 1. Artifact-driven groups and coverage — `shell-project-map-view.test.ts` "renders grouped rows with done indicators and lifecycle glyphs", "renders a declared surface with its share, counts, and declaring capabilities"; `shell-project-map-card.test.ts` "composes the ready descriptor through renderCard". Partial: the universal clause "no hardcoded project data anywhere" is a negative claim no test establishes globally.
    - 2. Empty, unreadable and invalid states — "classifies a missing artifact as empty", "classifies an unreadable artifact as empty rather than throwing", "classifies malformed JSON as invalid and renders its diagnostic", "renders empty and invalid artifacts distinctly without throwing". Partial: the narrow-mode bottom is untested for these states.
    - 3. Draft visibly a draft — "renders the approval state in the subtitle so a draft never reads as approved".
    - 4. Width safety — "clips every card line to the requested boundary width", `shell-card.test.ts` "renderCard never exceeds extremely narrow supplied widths", `shell-sidebar-layout.test.ts` "unsupported roots, empty rails and overflowing parts leave native layout intact". Partial: a boundary fixture, not an exhaustive state-by-width matrix.
    - 5. Digest follows the visible card — "keeps the digest stable when the card does not change and moves when it does", "digest follows the rendered descriptor rather than invalid codes or unrendered fields", "rail digest follows rendered diagnostics but ignores unrendered map fields".
    - 6. Undeclared surface stays unknown — "computes coverage from declared capabilities and counts only done ones", "renders an undeclared surface as unknown and never as zero percent".
    - 7. Slot order and non-disruptive hiding — `shell-sidebar-layout.test.ts` "rail orders Project Map between Status and Agents when it is registered"; `gentle-project-map.test.ts` "show and hide mount only for this session and do not write the artifact".
    - 8. Session-only visibility — the same test plus "session shutdown drops an explicit visibility choice".
    - 9. Narrow-mode card visible below the editor — "the rail is expanded while the bottom card is one collapsed body line", "the bottom uses the summary line and stays non-interactive", and the show/hide test's `placement: "belowEditor"` assertion. Partial: no empty or invalid bottom render test.
    - 10. Empty overlay renders nothing — "renders no overlay rows while the overlay is unavailable", "the unavailable overlay contributes no rendered rows".
    - 11. Unknown sub-action refused — "an unknown sub-action lists the valid ones and writes nothing".
  - Two test-coverage gaps confirmed independently and recorded rather than fixed, because PM3-5 writes no tests: (a) nothing asserts the three-diagnostic ceiling or the `Run /gentle:project-map status for the full report.` follow-up line; (b) nothing renders `projectMapCardBottom` for an empty or invalid artifact — the only two `projectMapCardBottom` calls use a ready artifact. Recorded too: the race tests assert the refusal and the preserved competing bytes but not the notification that reports the change to the user.
  - Gates on the final tree: focused suites 200 tests / 200 pass / 0 fail; full suite 3568 tests / 3530 pass / 0 fail / 38 skipped; `node scripts/check-types.mjs` 195 recorded diagnostics with no regressions and four improved file/code pairs. `pnpm test` cannot run in this environment (`pnpm: orden no encontrada`, exit 127), so its provider-contract check and its runtime harness are unverified here and are recorded as such instead of being replaced by a guess.

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
- 2026-09-24: PM3-4 closed. Commits `27908b06` (design), `cf6ff425` (pure transition), `2c0d6edc` (command, tests, docs). Measured 400 changed lines across 6 files — the review budget boundary — consolidated by the provider into one medium candidate with the single `review-reliability` lens, lineage `review-0aca0531761be1e3`, approved and acknowledged with its authority burned, zero corrections and no advisory. Gates on the reviewed tree: full suite 3568 tests / 3530 pass / 0 fail / 38 skipped; `node scripts/check-types.mjs` 195 recorded diagnostics, no regressions.
- 2026-09-24: Independent verification (`gentle-ai-verify`, read-only, own execution plus source inspection) confirmed claims 1-8 and 9-as-downstream-semantics, and falsified claim 10 as written: `docs/project-map.md` denied absolutely that an approved map can return to draft, while `draft` overwrites an approved artifact after confirmation. Fixed in the same slice: the approved-map diagnostic and both documentation sentences now say that regenerating the draft replaces the approved plan and that no plan-preserving return to draft exists.
- 2026-09-24: The same verification found two evidence gaps, both closed before the commit. (a) The new "never writes and never asks without a UI" test looped over `draft`, `declare` and `approve`, but its `approve` iteration ran against a freshly generated draft with no declared surfaces, so approval refused completeness before reaching the UI guard it claimed to test: the test now declares a surface first, and a mutation that neutralizes the approve guard fails it. (b) `evidence/repo-gates.log` was missing from the bundle because a later refresh deleted it: re-captured, and the parent-written harness labels were narrowed to exactly what each check covers (the purity check now deep-freezes the whole request and asserts no object is shared between input and result, and the malformed and unreadable artifact paths are covered).
- 2026-09-24: Four mutation probes, each killed by exactly the intended test, in copies under `/tmp/pm34-verify`: the declare staleness guard neutralized fails the declare race test; the declare UI guard neutralized fails the no-UI test; the approve UI guard neutralized fails the same no-UI test (the fix in the bullet above); and the diagnostic reverted to the old absolute wording fails the approved-map refusal test.
- 2026-09-24: The design and its binding decision were fixed before the first source write. The user chose `set` semantics: `declare <capability-id> <surface>...` replaces the whole list, and no surface clears it; there is no additive mode, no removal operator, and no `undeclare`. The earlier PM3-4 decision (`refuse-approved`) already fixed that declaring on an approved map is refused, and the grammar keeps that reachable only in a draft. Both the question, its options and the answer are recorded in Engram.
- 2026-09-23: PM3-3 closed. Commits `00667b8a` (design) and `2998c026` (selection, inspector, reveal bridge). Measured 511 changed lines across 12 files; the native review consolidated the range `6eec12ae..2998c026` into one medium candidate with the single `review-reliability` lens, lineage `review-e2f931d344cf1252`, approved and acknowledged with its authority burned, zero findings and no advisory. Gates on the reviewed tree: full suite 3553 pass / 0 fail / 38 skipped; `node scripts/check-types.mjs` 195 recorded diagnostics, no regressions.
- 2026-09-23: Independent verification (`gentle-ai-verify`, read-only, /tmp mutations) confirmed two real defects and one test gap, all fixed before commit. (a) A capability row whose 64-character identifier is pre-bounded into several body lines registered only its first line as a click target, leaving the identifier continuations inert at widths 12, 20 and 46: the structured body now reports the row's whole body span and the card sums the wrap height across it. (b) A render-time reveal was dropped on the first preparation and resolved against the previous frame's section offsets when a preceding section changed height: the reveal is now a request for the frame being prepared, flushed against that frame's own geometry after the snapshot is assigned. (c) Removing the out-of-viewport guard survived every suite, because the viewport test revealed the line already at `scrollTop`: the regression now reveals a line inside the viewport but below its first line. Post-fix mutation checks kill all three: collapsing the row span fails the span tests, unconditional scrolling fails the viewport test, and stale geometry fails the fresh-frame test.
- 2026-09-23: Docs corrected with the behavior: the selection keys and their env overrides, the row marker, the inspector fields, the static-only blocker rule, the reveal-on-change rule, and the automatic expansion of a collapsed capabilities group when the selection moves onto a hidden row.
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
PM-3 is closed: all five stages are committed, reviewed on their own ranges, and recorded above, and the card reads the repository's own artifact end to end. PM-4 (shared cross-worktree coordination store) is the next unit in the roadmap and needs its own authorization, exploration, and task document.

Two informational test-coverage gaps remain unowned and are listed under PM3-5: the invalid card's three-diagnostic ceiling with its follow-up line, and the narrow-mode bottom for an empty or invalid artifact. Neither is a behaviour defect; both are recorded so the absence is visible rather than implied.

Push and PR remain separate decisions: the branch is unpublished over the stable tag v3.7.0, and the pull request is blocked until a maintainer applies `status:approved` to issue #1396.
