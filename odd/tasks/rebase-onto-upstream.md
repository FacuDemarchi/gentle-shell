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
Started 2026-10-02.
