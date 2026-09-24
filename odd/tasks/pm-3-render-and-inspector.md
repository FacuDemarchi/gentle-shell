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
- `pnpm` and `node_modules` are absent in this worktree, so the full suite and the typecheck gate cannot run here; focused `node --test` runs and an explicit limitation note are the substitute evidence.

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

## Tasks

- [ ] **PM3-1 — Read-only card of the real map**
  - Read the artifact through the schema's own reader and classify the result as empty, invalid, or ready.
  - Render Foundations, Product capabilities, and Coverage through `renderCard`, with a glyph per state and the approval state in the subtitle.
  - Compute per-surface coverage from capability state, and render an undeclared surface as unknown.
  - Export a digest derived from the rendered lines.
  - Register the `project-map` rail between Status and Agents, mounted only while shown, with the same component as the narrow-mode bottom so the card stays visible below the editor when the sidebar is inactive.
  - Add `show` and `hide` sub-actions that are session-scoped and write nothing to disk.
  - Cover the empty, invalid, draft, and approved states, width safety at boundary widths, the digest, and the sub-action validation.

- [ ] **PM3-2 — Coverage explanations and grouping**
  - Explain each coverage value in terms of the capabilities behind it, so a percentage is never the only thing on screen.
  - Group and collapse Foundations and Product capabilities, and keep the collapsed state session-scoped.
  - Cover the explanation text, the grouping, and the collapsed rendering.

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
- 2026-09-23: PM3-1 split into PM3-1a and PM3-1b after measuring. The boundary is verifiability: everything that imports the TUI runtime is unverifiable in this clone, because `node_modules` is absent and every rendering suite in the repository fails for that reason (`shell-card`, `shell-todo`, `shell-sidebar-layout`, `gentle-todo`). PM3-1a is the pure view core, which imports no runtime and therefore runs; PM3-1b is the thin `renderCard` composition plus the shell wiring, which cannot run here and is recorded as such. Each half stays under the 400-line budget.
- 2026-09-23: Unit planned after read-only exploration of both the uncommitted prototype in the sibling clone and the current rendering surfaces in this branch. Decisions on the prototype, the entry point, the staging, and surface collection accepted by the user as recommended. Task document created before the first source write. PM3-1 through PM3-5 pending.

## Next decision
Implementation of PM3-1 may begin. Commit, push, and PR remain separate decisions and require explicit authorization; native review remains a separate user-owned choice.
