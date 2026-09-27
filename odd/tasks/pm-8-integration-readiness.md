# PM-8 — Integration-readiness sequencing

Status: **planned at recon depth. Six product decisions are open and block the first source write.**

## Objective

Answer, from the map, the question a user actually has at the end of parallel work: *which capability can be integrated next, and what is the evidence?* Order the candidates, verify what can be verified, detect likely merge conflicts early, and present the next safe integration action — while leaving commit, push, PR and merge to ordinary repository policy.

## Problem

The coordination projection already computes a `nextSafeAction` per capability (`claim`, `wait-for-dependency`, `resolve-blocker`, `decide-contract`, `integrate`, `work`, `done`, `blocked`), and `integrate` is already one of its outcomes. But nothing verifies anything behind that word: no check that the capability's coverage is complete, that its branch is still based on the integration target, that its changed paths do not collide with another ready capability's, or that its review evidence exists. A user with three finished capabilities has to work all of that out by hand, from Git and from memory.

## Why now

The roadmap's ratified order puts PM-8 after the session-tab layer, and the tab layer is closed as a unit with its native review pass. PM-8 is also the **owner of two schema decisions this initiative deliberately deferred**: PM-7 recorded that the map does not model per-capability verification requirements, and that exact tmux launch identity would need a field in the session binding. Those two decisions are the reason this unit cannot be planned to completion without the user.

## Recon findings (read-only, 2026-09-26)

The unit is **cheaper than it looked**, because most of its inputs already exist:

- **A durable home for readiness evidence already exists.** `readiness-receipt` (PM-4) carries `verified: string[]`, `evidence: string[]` and `authority: "none"`, with `issueProjectMapStoreReadinessReceipt` and `readProjectMapStoreReadinessReceipts`. PM-8's job is therefore **sequencing and verification, not a new record kind**.
- **The ordering inputs are already projected.** `readProjectMapCoordinationState` returns `dependencyReady`, `complete`, `openBlockers`, `proposedContracts` and `nextSafeAction` per capability, plus the conflicts it detects.
- **Branch freshness has its input without a schema change.** The `worktree-binding` record already stores `base_commit`, so "is this branch still based on something the integration target contains, and how far behind is it" needs no new field.
- **A reusable, injectable Git executor pattern exists.** `lib/review-candidate-view.ts` defines `CandidateGitExecutor` and `deriveChangedPathManifest(cwd, baseTree, candidateTree, executor)`, and `lib/session-worktree-registry.ts` takes `run` as a parameter. That is the precedent for both freshness and overlap checks, and it keeps the product code testable without a real repository.
- **The native review's own library is in this repository.** `lib/review-repository.ts` exposes `resolveRepositoryAuthorityV1(cwd)`, `reviewStoreRootForRepositoryV1(cwd)` and `assertManagedStorePathV1(commonDirectory, path)`. Review evidence can therefore be read through product-owned APIs rather than by parsing `.git/gentle-ai` by hand — but whether the map should read it at all is a product decision (see D below).
- **The command surface is a closed list.** `PROJECT_MAP_SUB_ACTIONS` is `["draft", "declare", "approve", "status", "show", "hide", "lead", "contract", "worktree", "open"]`, and `USAGE` is per sub-action so it never advertises an argument shape an action does not take. A new sub-action is a small, well-established addition.

## Open decisions (block the first source write)

Recommendations are mine; none of these is settled.

**A. Per-capability verification requirements (deferred by PM-7).** The Open Pi handoff currently says `Verification requirements: not declared by the map.`
1. Add a `verification` field to the capability (expected commands and the evidence they must produce).
2. Derive it from the project's `openspec/config.yaml` `apply.test_command` instead of the map.
3. Leave it undeclared and keep saying so.
**Recommendation: 2, then 1 later if it proves too coarse.** The repository already declares a test command per project, and putting it in the map duplicates a source that exists and can drift.

**B. Exact tmux launch identity (deferred by PM-7).** `confirmed` on the tmux path proves a live session bound itself to this worktree at or after the launch, not that it is this launch's child.
1. Add a `launch_nonce` to the `session-binding` schema and compare it.
2. Accept the worktree-level evidence and keep documenting the limit.
3. Drop the tmux confirmation to the weaker claim and say so.
**Recommendation: 1.** It is a small, additive field, the consumer already exists, and it closes a limit that has been carried through two units. It also makes the background path's pid check redundant rather than special.

**C. Does the map surface native review evidence?** The roadmap lists "review evidence" among the things readiness verifies.
1. Read it through `lib/review-*` and show it read-only in the readiness report.
2. Keep review out of the map entirely.
3. Show only a boolean "reviewed" with no detail.
**Recommendation: 1 with a hard boundary.** Read-only, labelled as evidence, and never as authorization — the same rule the readiness receipt already encodes with `authority: "none"`. This is the one place where the roadmap explicitly asks for it, and the alternative is the user reconciling two systems by hand.

**D. How far does conflict detection go?** The roadmap says "detect likely merge conflicts early without pretending to resolve them automatically".
1. **Changed-path overlap only**: which files two ready candidates both touch, plus their distance from the integration target. Cheap, deterministic, no false confidence.
2. **Real conflict probing** in a scratch worktree (`git merge-tree` or a throwaway `merge --no-commit`). Truer answers, but it writes, it needs a sandbox, and it can be slow.
3. Freshness only, no overlap.
**Recommendation: 1, with the answer labelled "likely", and 2 explicitly out of scope.** The roadmap's own wording asks for *likely* conflicts and forbids pretending to resolve them; a path overlap plus freshness is honest about being a signal.

**E. What does "map/task consistency" mean concretely?**
1. Check that each declared `featureDocs` reference exists and is readable.
2. Parse the feature document's task checkboxes and compare them against the capability's declared state.
3. Don't check.
**Recommendation: 2, reported as a mismatch, never corrected automatically.** The map declares a state; the feature document declares what is done; the drift between them is exactly the risk the roadmap names, and this is the only place that can see both.

**F. Where the report lives.**
1. A new `/gentle:project-map integrate` sub-action that prints the ordered report and issues a readiness receipt per verified capability.
2. A read-only `status` extension, no new sub-action.
3. A rail section.
**Recommendation: 1.** A receipt is what makes the verification durable and auditable, and `readiness-receipt` already exists for exactly that with `authority: "none"`.

## Non-goals

- Commit, push, PR creation, merge, release, or any branch/worktree mutation. Readiness is informational, exactly as `readiness-receipt`'s `authority: "none"` says.
- Automatic conflict resolution, and any merge that changes a tree.
- Re-litigating the coordination protocol, the store layout, or the worktree lifecycle.
- Making review state a gate. Review evidence is evidence.

## Constraints

- **Read-only against the repository.** Every Git call is a query; nothing stages, commits or merges.
- **Git behind an injected executor**, following `CandidateGitExecutor` and `resolveSessionWorktreeWithGit`, so the unit is testable without a real repository and so the existing environment sanitisation (`reviewGitEnvironment`) is reused rather than reinvented.
- **Fail closed.** An unreadable map, store or branch reports what it could not verify instead of assuming it is fine. "Unverified" is a result, not an error.
- **A receipt grants nothing.** The unit issues receipts with `authority: "none"` and says so in the report.

## Collision map

- `lib/project-map-coordination-state.ts` already owns `nextSafeAction`; PM-8 consumes it and does not redefine it.
- `lib/project-map-store-receipts.ts` owns the receipt shape; PM-8 issues through it and does not change it.
- `lib/review-*.ts` is the native review's own implementation. PM-8 may read through its public functions and must not change any of them.
- `extensions/gentle-project-map.ts` owns the command surface; a new sub-action extends the closed list.

## Authorized edit surfaces (provisional, pending the decisions)

- `lib/project-map-integration.ts` (new: the ordering and verification projection).
- `tests/project-map-integration.test.ts` (new).
- `extensions/gentle-project-map.ts` (the new sub-action and its `USAGE` entry only).
- `tests/gentle-project-map.test.ts` (the new sub-action's cases).
- `lib/shell-project-map-schema.ts` and `tests/shell-project-map-schema.test.ts` **only if decision A adds a field**.
- `lib/project-map-store-schema.ts` and its tests **only if decision B adds a field**.
- `docs/project-map.md`, `docs/gentle-shell.md`.
- `odd/tasks/pm-8-integration-readiness.md`, `odd/tasks/project-map-orchestration.md`.

Anything outside this list is a scope question, not an edit.

## Task list (provisional)

- [ ] **PM8-1 — The readiness projection.** A pure function over already-read values: order the candidates by dependency and contract state, and compute per-candidate the freshness, the coverage and the blocker facts. Readers injected; no I/O of its own.
- [ ] **PM8-2 — Verification against the repository.** The injected Git executor, freshness against the integration target, changed-path overlap between candidates, and the map/task consistency check. Every result is `verified`, `mismatched` or `unverified`, and the last one is never silently treated as the first.
- [ ] **PM8-3 — The report and the receipts.** The `integrate` sub-action, the ordered report, and a `readiness-receipt` per verified candidate, with `authority: "none"` printed where a user cannot miss it.
- [ ] **PM8-4 — Documentation and unit verification.** `docs/project-map.md`, the acceptance trace, and the honest record of what was not verified.

Each slice stays under the 400-line review budget and is its own commit. A schema field from decision A or B lands in the slice that consumes it, with its own tests, not as a drive-by edit.

## Acceptance criteria (provisional)

1. The report orders candidates by dependency and accepted-contract state, deterministically.
2. Every claim in the report is either verified, mismatched or explicitly unverified — never inferred from a missing answer.
3. Branch freshness is computed against the integration target and names how far behind a branch is.
4. Likely conflicts are reported as *likely*, with the overlapping paths named, and nothing is resolved.
5. A readiness receipt is issued only for a verified candidate, and it grants nothing.
6. Nothing in the unit writes to the repository, the store or the map.
7. An unreadable map, store or branch degrades to an explicit "unverified" rather than a silent pass.

## Review disposition

RDD is **off** for this clone, as it was for PM-4 through PM-7 and the session-tab layer. The unit therefore carries parent verification plus independent audits, and its deferred native review pass runs when the unit closes, one candidate per slice, from a worktree pinned at that slice's tip with `baseRef` set to the previous slice's tip, with RDD enabled for the pass and returned to `off` afterwards.

## Progress

- 2026-09-26: **unit planned at recon depth.** Read-only surface map only; no code written. Its central finding is that the unit is mostly **assembly rather than invention**: the receipt shape, the ordering inputs, the branch base and an injectable Git executor all already exist, so the work is sequencing, verification and honest reporting rather than new state. Six product decisions are recorded above with recommendations, and the first source write waits on them.
