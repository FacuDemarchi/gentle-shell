# Fork reconciliation — where this fork stands against upstream

Status: **authorized and executed 2026-10-02**. HEAD at measurement: `90b7fdd9`,
branch `feat/project-map-orchestration`.

**Decision taken:** the Project Map stays a **private cockpit of this fork**. It is
not proposed upstream. Packaging/release pins and the artifact-language work are
out.

Method: read-only forensics, five fronts, all numbers measured rather than
estimated.

---

## Headline findings

1. **Upstream retired SDD.** `cc5fbd94 refactor(shell): remove SDD surfaces and
   retain user safety` deletes 13 `assets/agents/sdd-*.md`, 3
   `assets/chains/sdd-*.chain.md`, `assets/sdd-orchestrator-workflow.md`,
   `assets/support/sdd-status-contract.md` and `assets/support/strict-tdd.md`
   (368 lines), and rewrites the four orchestrator assets. Net `assets/` delta
   `HEAD → upstream/main`: **27 files, −2,516 lines**.
2. **Upstream now owns the ODD layer we worked on.** `a76e6f29 feat(odd): default
   to applicable test-first development` plus the phase-inference family
   (`aa8e5c09`, `5b37c261`, `725e198c`, `f2bbe0f1`). Our own ODD/routing work turns
   out to be **already upstream and byte-identical** — see the correction below.
   This branch's net footprint on the canon is one line, and it auto-merges.
3. **Upstream moved to Pi 0.87.1** and redesigned the test runner
   (`fdc46b47 fix(tests): run all pnpm test stages independently`).
4. **The Project Map does not exist upstream.** Zero files match `project-map` in
   `upstream/main`: no `docs/project-map.md`, no `lib/project-map-*.ts`, no
   `openspec/project-map.json`.

## Collision map

| Measure | Value |
| --- | --- |
| Files this branch touched | 119 |
| Files upstream touched | 418 |
| Intersection | **15** |
| Ours only | 104 |
| Theirs only | 403 |
| Colliding new filenames | **0** |

Density (ours vs theirs): `extensions/gentle-shell.ts` 1/23 · `README.md` 1/21 ·
`extensions/gentle-ai.ts` 2/19 · `tests/gentle-shell.test.ts` 1/17 ·
`docs/gentle-shell.md` **16/5** · `docs/readme-reference.md` 3/8 ·
`lib/shell-sidebar-layout.ts` 3/4 · `assets/orchestrator-delegation.md` 2/4 ·
`tests/orchestrator-budget.test.ts` 2/1 · `tests/artifact-language.test.ts` 2/1.

Almost every hot file is *upstream-heavy, ours-light*. The single real exception
is `docs/gentle-shell.md`, which is a mechanical textual conflict.

**Verdict: surgical rebase, not a rewrite.** The risk is not the conflict, it is
the **deletion**: everything this fork references from SDD disappears from
underneath it.

## Commit classification

| Cut | Value |
| --- | --- |
| Isolated (new files only) | **191** of 218 |
| Touch shared core | **27** |
| `docs`/`feat`/`fix`/`test`/`refactor`/revert | 104 / 74 / 25 / 11 / 2 / 2 |

**Footprint on the always-on prompt: one line.** The three commits touching
`assets/` net out to `assets/orchestrator-memory.md` (1 line) and `package.json`
(1 line); `a5b53c09` and `c05ef431` cancel each other. The budget enforced by
`tests/orchestrator-budget.test.ts` is **8,192 bytes**, measured at both a short
and a 128-character assets root, with no line-count ceiling. Budget risk is
negligible.

**Dead code to drop for free:** this branch deletes `lib/artifact-language.ts`,
`odd/tasks/artifact-language-setting.md` and
`tests/artifact-language-setting.test.ts`. It is the residue of a reverted
feature.

## Delivery reality

Both suites are green on the uncommitted tree: project-map and shell-project-map
**650 pass / 0 fail** across 34 files; `tests/gentle-ai.test.ts` **85 pass / 0
fail**. `pnpm run typecheck` could not run (environment: the sandboxed wrapper
cannot spawn pnpm), which is not a code signal.

The documentation is honest, but every real gap sits in the same place — the
product surface of the satellite loop:

1. No public claim/renew/release command. The store exists
   (`lib/project-map-store-claims.ts:190`); the command surface exposes only
   `lead` (`extensions/gentle-project-map.ts:111`).
2. Worktree provisioning requires a live claim
   (`lib/project-map-worktrees.ts:280-313`) → **the documented flow is
   circular**: the product cannot create the claim the worktree needs.
3. No `blocker` sub-action (`lib/project-map-store-blockers.ts:188-234` has no
   surface).
4. The Open Pi child writes session binding and heartbeat but does not take the
   documented claim.
5. Quarantine and heartbeat pruning are implemented and tested with no command.

So: **the library is complete and tested; the cockpit cannot yet be driven
end-to-end from the product.** The multi-agent loop is the ambition; what exists
is the engine, not the steering wheel. That gap is the next real unit, not a
rebase task.

## Decisions (2026-10-02)

1. **The cockpit stays private.** No upstream PR for the Project Map. The
   reconciliation is a rebase, not a reconstruction on a new base.
2. **Packaging / release pins: out.** Upstream is on Pi 0.87.1 with its own
   runner; our pins are born stale.
3. **Artifact-language: out.** Reverted and already dead.
4. **Adopt upstream's test runner.** Our branch replaced
   `"test": "node scripts/run-test-suite.mjs"` with an explicit
   `node --test` invocation; upstream redesigned that stage. Theirs wins.
5. **The Spanish sidecar is tracked here and never ships.** `openspec/` is not in
   the `package.json` `files` array, so `openspec/project-map.es.json` stays repo
   data: the mechanism ships, the translation does not.

## Correction, 2026-10-02: the ODD front was not the risk

The first reading warned that the ODD/routing layer was the front where work
could be lost silently, because upstream built phase inference on the same
ground. **A measurement refuted that warning**, so it is corrected here rather
than left standing.

- **This branch's net footprint on the ODD canon is one line**: the `Belongs to:`
  clause in `assets/orchestrator-memory.md`. The artifact-language pair nets to
  zero on the other three assets, so our net delta on them is nothing.
- **That line auto-merges.** A three-way simulation
  (`git merge-tree --write-tree --name-only HEAD upstream/main`) resolves
  `assets/orchestrator-memory.md` cleanly: our clause and upstream's SDD deletion
  sit in different sections.
- **The ODD/routing units are not branch work.** `odd-proportional-delegation.md`,
  `odd-routing-ratchet.md`, `odd-runtime-delegation-gate.md` and
  `odd-todo-and-thinking-visuals.md` already exist upstream, together with
  `scripts/mirror-odd-routing.mjs`, `fixtures/odd-routing-canonical.md` and
  `tests/odd-routing-canonical-ratchet.test.ts`. All 30 `odd/` files shared by
  both sides are byte-identical: the `HEAD` to `upstream/main` diff under `odd/`
  contains additions and deletions and **zero modifications**.
- **`fixtures/odd-routing-canonical.md` is identical on both sides.** The routing
  ratchet has no drift to reconcile.
- Upstream's `assets/orchestrator-delegation.md` is a wholesale semantic shift:
  SDD removed, "these instructions apply to all development work", applicable
  test-first by default, and a new *Signaling the ODD phase to the Gentle prompt*
  section. Our net delta there is zero, so the rebase adopts it without a
  decision.

**What actually conflicts is the shell and TUI layer.** The same simulation
reports exactly five conflicted files:

| File | Ours (+/−) | Theirs (commits) | Our commits touching it |
| --- | --- | --- | --- |
| `README.md` | +2 / −0 | 21 | 1 |
| `extensions/gentle-ai.ts` | +64 / −15 | 19 | 2 |
| `extensions/gentle-shell.ts` | +26 / −4 | 23 | 1 |
| `lib/shell-sidebar-layout.ts` | +30 / −2 | 4 | 2 |
| `lib/shell-sidebar.ts` | +39 / −1 | 3 | 2 |

Ten of the fifteen colliding files auto-merge, including `docs/gentle-shell.md`
(ours 16 commits, theirs 5), `docs/readme-reference.md`,
`scripts/verify-package-files.mjs` and all three colliding tests.

**Conflict-stop bound:** only 8 of the 218 commits touch those five files, so a
rebase stops at most eight times. That is a bound derived from the merge surface,
not a measured rebase: `git replay` refuses to run in this environment and an
actual rebase was not attempted. Treat the file set as exact and the stop count
as an upper bound.

## Rebase plan, in slices

1. Drop artifact-language and the packaging pins.
2. Port the 104 our-only files as a block; they compete with nobody.
3. Re-apply the single `orchestrator-memory.md` line onto upstream's new canon.
4. Resolve `docs/gentle-shell.md`, the sidebar files and the three colliding
   tests.
5. **Resolve the five shell and TUI conflicts** listed in the correction above.
   The ODD front was diffed and needs nothing: it auto-merges.

**Executed 2026-10-02.** Seven conflict stops, two skipped commits and one repair
the merge simulation could not see; the outcome is recorded in
`odd/tasks/rebase-onto-upstream.md`.
