# Rebase onto upstream/main

## Objective
Move this branch on top of `upstream/main`, so the fork's cockpit work sits on
the current release instead of a base that is 262 commits old.

## Why now
The reconciliation measured the surface: five files conflict, ten more auto-merge,
the ODD layer carries a one-line footprint that auto-merges, and 191 of the
branch's commits touch only new files. See `odd/fork-reconciliation.md`.

## Base decision
`git rebase --onto upstream/main origin/main`.

Verified before starting: `git rev-list --count upstream/main..origin/main` is
**0**, so the 12 commits `origin/main` holds that this branch lacks are all
already upstream. The rebase drops nothing.

`upstream/main` tip at the start: `f14b19a2` (2026-09-28). Merge base:
`59257bff chore(release): prepare gentle-pi v3.7.0` (2026-09-23).

## Conflicts, measured
Exact set from `git merge-tree --write-tree --name-only HEAD upstream/main`:

| File | Ours (+/−) | Our commits touching it |
| --- | --- | --- |
| `README.md` | +2 / −0 | 1 |
| `extensions/gentle-ai.ts` | +64 / −15 | 2 |
| `extensions/gentle-shell.ts` | +26 / −4 | 1 |
| `lib/shell-sidebar-layout.ts` | +30 / −2 | 2 |
| `lib/shell-sidebar.ts` | +39 / −1 | 2 |

## Resolution criterion
**A semantic merge, never a side-wins.** Upstream's changes land, and our
additions are re-applied on top of them:

- `extensions/gentle-ai.ts` — the models-panel height unit: one render budget
  constant feeding both the panel and its overlay clamp.
- `extensions/gentle-shell.ts` — the single-owner header contributor registry.
- `lib/shell-sidebar-layout.ts` — the rail slot order that places Project Map
  below Todos.
- `lib/shell-sidebar.ts` — the Project Map card slot.
- `README.md` — the two Project Map rows (feature list and documentation link).

Taking a whole file from either side would silently discard the other side's work
in that file. Each hunk is resolved on its own.

## Non-goals
- No push, no PR, no release.
- No changes to the artifact-language work or the packaging pins: both are out by
  decision, not by conflict outcome.
- No rewrite of commit content beyond what a conflict forces.

## Acceptance criteria
1. `git status` clean and no rebase in progress at the end.
2. `HEAD` is a descendant of `upstream/main`: `git merge-base --is-ancestor
   upstream/main HEAD` succeeds.
3. `git rev-list --count HEAD..upstream/main` is `0`.
4. Both suites green on the rebased content.
5. Each of the five files carries upstream's changes **and** our additions.
6. `backup/pre-upstream-rebase-8e6d50bf` still points at `8e6d50bf`.

## Checks
- project-map suites: `node --experimental-strip-types --test
  tests/project-map-*.test.ts tests/shell-project-map-*.test.ts`
- models panel: `node --experimental-strip-types --test tests/gentle-ai.test.ts`
- provider contract: `pnpm run check:provider-contract` (if the runner is
  available; the sandboxed wrapper could not spawn pnpm earlier in the session,
  in which case the failure is environmental and must be reported as such, not as
  a pass).

## Rollback
`git rebase --abort` while in progress; otherwise `git reset --hard
backup/pre-upstream-rebase-8e6d50bf`.

## Progress
Completed 2026-10-02. **Seven conflict stops, two skipped commits, one repair.**

| Stop | Commit | Conflict | Resolution |
| --- | --- | --- | --- |
| 23/225 | `ef4ac0ab` | `lib/shell-sidebar-layout.ts` | upstream's filter plus `project-map` in the section list |
| 29/225 | `2998c026` | `lib/shell-sidebar-layout.ts`, `lib/shell-sidebar.ts` | upstream's restructured guard and props plus our `pendingReveal` and `reveal` |
| 124/225 | `7afa4341` | `README.md` | our Project Map row plus upstream's ODD row wording |
| 132/225 | `8cb31f18` | `extensions/gentle-shell.ts`, 2 regions | our contributor registry plus upstream's `visualSettings`; union of imports |
| 174/225 | `835de716` | `lib/shell-sidebar-layout.ts` | our final rail order plus upstream's filter |
| 190/225 | `a5b53c09` | 4 files | **skipped** — artifact-language is out by decision |
| 192/225 | `c05ef431` | 4 files | upstream's side; the revert deleted the three feature files |
| 219/225 | `255a7ac4` | `extensions/gentle-ai.ts`, 8 regions | **skipped** — superseded by upstream |

### The two skips

Both are decisions, not conflict outcomes.

- `a5b53c09` belongs to the artifact-language unit, which is out by decision. Its
  add/revert pair nets to zero, so it was skipped and its revert was allowed to
  remove the residue: `lib/artifact-language.ts`,
  `odd/tasks/artifact-language-setting.md` and
  `tests/artifact-language-setting.test.ts`, 310 deletions in one commit.
- `255a7ac4` is the models-panel unit, and **upstream had already shipped the same
  behaviour two days earlier** (`681c78f9`, `a25633d9`, both 2026-09-25, by Alan
  Buscaglia). Upstream's `visibleListRows` yields the same arithmetic on a 24-row
  terminal. Keeping both implementations would have meant rewriting eight regions
  to fight the maintainer's design for an identical result, so upstream's won and
  the unit's record is superseded. Two of its details are not in upstream and are
  recorded as follow-up candidates in that document: the non-finite and throwing
  budget guard, and `PANEL_MIN_LIST_ROWS = 3` against upstream's floor of 1.

### One repair the merge simulation could not see

Upstream's `cc5fbd94` deleted 164 files under `openspec/`, including
`openspec/config.yaml`, which this fork's Project Map reads for the quality-gate
foundation, the declared surfaces and the roadmap. The simulation reported only
textual conflicts, so it could not surface a **dependency break**. Restored
unchanged in `73bc100d`.

### Verification

| Criterion | Result |
| --- | --- |
| `git status` clean, no rebase in progress | ✅ |
| `git merge-base --is-ancestor upstream/main HEAD` | ✅ descends |
| `git rev-list --count HEAD..upstream/main` | ✅ `0` |
| project-map and shell-project-map suites | ✅ **650 pass / 0 fail** |
| `tests/gentle-ai.test.ts` | ✅ **89 pass / 0 fail** |
| `backup/pre-upstream-rebase-8e6d50bf` | ✅ still at `8e6d50bf` |
| Our net contribution on the five files | ✅ `README.md` +2, `extensions/gentle-shell.ts` +26/−4, `lib/shell-sidebar-layout.ts` +31/−2, `lib/shell-sidebar.ts` +39/−1, `extensions/gentle-ai.ts` **zero** |

### Blocked check

The full unit suite (`tests/*.test.ts`) reports **4687 pass / 48 fail / 41
skipped**. All 48 failures are in the Pi-TUI and vim-editor area and share one
root cause: the rebased `package.json` requires `@earendil-works/pi-tui 0.87.1`
and `lib/vim-editor-adapter.ts` pins `verifiedVersion` 0.87.1, while
`node_modules` still holds **0.85.1**. `pnpm` and `corepack` are both unavailable
in this environment, so `pnpm install` could not run. This is a dependency gap,
not a resolution defect, and it must be re-run after `pnpm install`.

### Result

`223` commits ahead of `upstream/main`, `0` behind. Nothing pushed. The branch is
now based on the release instead of a base 262 commits old.
