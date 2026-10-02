# Land the working tree

## Objective
Land every uncommitted change in the working tree as work-unit commits, so the
branch has no loose state before the upstream reconciliation begins.

## Problem
After five days the tree holds four modified paths and three untracked ones. One
of them — the models-panel unit — is implemented, tested and verified, but was
never committed: `git log` over `odd/tasks/models-panel-visible-rows.md` returns
nothing. Loose state here would be lost or mis-attributed during a rebase.

## Decisions taken while landing
- **The project map change is one commit, not two.** The first reading called it
  a split (mechanical relabels versus new capabilities). Measurement refuted
  that: 39 new capability entries and 41 relabelled outcomes share a single
  intent — the map records the units that were actually delivered. Two commits
  would be ceremony for one concern.
- **The Spanish sidecar is tracked.** `openspec/project-map.es.json` is live
  runtime input read by `lib/project-map-translations.ts:19`, not a dead
  specification, and `openspec/` is not in the `package.json` `files` array, so
  tracking it changes no packaged surface. Reversible with one `git rm --cached`.

## Scope
Four commits: the models-panel unit, the reconciled project map, the Spanish
content pass with its sidecar, and the fork governance records.

## Non-goals
- No rebase, no history rewrite, no upstream PR.
- No new product code, no new tests.
- No native review. The user-owned switch for this clone reads
  `receipt-driven development: off (decided by clone_local)` and off wins, so the
  preflight does not apply to these candidates.
- No fix for the satellite-loop surface gaps recorded in
  `odd/fork-reconciliation.md`.

## Authorized edit surfaces
- `odd/tasks/land-the-working-tree.md` (this document)
- `odd/fork-reconciliation.md`
- `odd/communication-contract.md`
- staging only, content authored earlier: `extensions/gentle-ai.ts`,
  `tests/gentle-ai.test.ts`, `odd/tasks/models-panel-visible-rows.md`,
  `openspec/project-map.json`, `openspec/project-map.es.json`,
  `odd/tasks/project-map-spanish-translations.md`

## Tasks
- **LWT-1** Write the reconciliation record and this unit document.
- **LWT-2** Commit the models-panel unit.
- **LWT-3** Commit the reconciled project map.
- **LWT-4** Commit the Spanish content pass and track its sidecar.
- **LWT-5** Commit the fork governance records and confirm a clean tree.

## Acceptance criteria
1. `git status --short` is empty at the end, on `feat/project-map-orchestration`.
2. Four commits, one concern each, in Conventional Commit form.
3. The models-panel commit carries the test file it was verified with.
4. Nothing is pushed, no history is rewritten, `upstream` is untouched.
5. The commit identities are recorded in this document.

## Checks
- `node --experimental-strip-types --test tests/gentle-ai.test.ts` → 85 pass / 0
  fail, observed in this session before the commit.
- `node --experimental-strip-types --test tests/project-map-*.test.ts
  tests/shell-project-map-*.test.ts` → 650 pass / 0 fail, observed.
- Passive documentation and data commits carry no runnable RED; ordinary
  structural verification applies instead: `git show --stat` per commit and a
  clean `git status`.

## Progress
Landed 2026-10-02. Four commits, all on `feat/project-map-orchestration`, none
pushed, no history rewritten.

| Task | Commit | Subject |
| --- | --- | --- |
| LWT-2 | `255a7ac4` | feat(models): show every model the terminal can hold in `/gentle:models` |
| LWT-3 | `366dee80` | docs(project-map): record every delivered unit and label each outcome by code |
| LWT-4 | `639df717` | docs(project-map): record the Spanish content pass and track its sidecar |
| LWT-5 | `1b4e587d` | docs(odd): record the fork reconciliation, the contract and the landing unit |

Both suites were observed green on this exact tree before the commits (650 pass /
0 fail across 34 files; `tests/gentle-ai.test.ts` 85 pass / 0 fail). Committing
moves bytes between the index and `HEAD` without changing content, so those runs
still describe the landed content.

## Next
Not this unit: the satellite-loop surface gaps recorded in
`odd/fork-reconciliation.md` are the next real unit — the cockpit cannot be
driven end-to-end from the product yet. The upstream rebase follows the sliced
plan in the same document.
