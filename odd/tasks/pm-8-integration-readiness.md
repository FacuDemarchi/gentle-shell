# PM-8 — Integration-readiness sequencing

Status: **planned and frozen 2026-09-26.** Five slices, six decisions settled by the user, implementation starting at PM8-1.

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

## Decisions (approved by the user, 2026-09-26)

Six decisions were put to the user with the options below and the recommendations recorded with them. The user approved all six recommendations, so the options each decision rejected are kept here as the record of what was considered.

**A. Per-capability verification requirements (deferred by PM-7).** The Open Pi handoff currently says `Verification requirements: not declared by the map.`
1. Add a `verification` field to the capability (expected commands and the evidence they must produce).
2. Derive it from the project's `openspec/config.yaml` `apply.test_command` instead of the map.
3. Leave it undeclared and keep saying so.
**Chosen: option 2.** The requirement is derived from the project's `openspec/config.yaml` `apply.test_command`, not from the map. The reason is drift: the repository already declares a test command per project, and a second copy in the map could disagree with it. Option 1 stays available if the derived requirement proves too coarse to be useful, and that would be its own decision.

**B. Exact tmux launch identity (deferred by PM-7).** `confirmed` on the tmux path proves a live session bound itself to this worktree at or after the launch, not that it is this launch's child.
1. Add a `launch_nonce` to the `session-binding` schema and compare it.
2. Accept the worktree-level evidence and keep documenting the limit.
3. Drop the tmux confirmation to the weaker claim and say so.
**Chosen: option 1.** A `launch_nonce` field is added to the `session-binding` schema and compared by the confirmation. It is a small additive field, the consumer already exists, and it closes a limit carried through two units. Its slice is noted below as a **launch-flow change carried by this unit because PM-8 owns the decision**, not as part of the readiness sequencing.

**C. Does the map surface native review evidence?** The roadmap lists "review evidence" among the things readiness verifies.
1. Read it through `lib/review-*` and show it read-only in the readiness report.
2. Keep review out of the map entirely.
3. Show only a boolean "reviewed" with no detail.
**Chosen: option 1, with a hard boundary.** Review evidence is read through `lib/review-*` and shown read-only in the readiness report, labelled as evidence and never as authorization — the same rule the readiness receipt already encodes with `authority: "none"`. It is the one place the roadmap explicitly asks for it, and the alternative is the user reconciling two systems by hand. **Nothing in `lib/review-*` is modified, and review state never gates a candidate.**

**D. How far does conflict detection go?** The roadmap says "detect likely merge conflicts early without pretending to resolve them automatically".
1. **Changed-path overlap only**: which files two ready candidates both touch, plus their distance from the integration target. Cheap, deterministic, no false confidence.
2. **Real conflict probing** in a scratch worktree (`git merge-tree` or a throwaway `merge --no-commit`). Truer answers, but it writes, it needs a sandbox, and it can be slow.
3. Freshness only, no overlap.
**Chosen: option 1, with the answer labelled "likely".** Detection is changed-path overlap between ready candidates plus their distance from the integration target. Option 2 — real conflict probing in a scratch worktree — is **explicitly out of scope**: it writes, it needs a sandbox, and the roadmap's wording asks for *likely* conflicts while forbidding any pretence of resolving them. Nothing is ever merged, staged or resolved.

**E. What does "map/task consistency" mean concretely?**
1. Check that each declared `featureDocs` reference exists and is readable.
2. Parse the feature document's task checkboxes and compare them against the capability's declared state.
3. Don't check.
**Chosen: option 2.** The check parses the feature document's task checkboxes and compares them against the capability's declared state. The map declares a state and the document declares what is done; the drift between them is exactly the risk the roadmap names, and this is the only place that can see both. A mismatch is **reported and never corrected automatically**, in either direction.

**F. Where the report lives.**
1. A new `/gentle:project-map integrate` sub-action that prints the ordered report and issues a readiness receipt per verified capability.
2. A read-only `status` extension, no new sub-action.
3. A rail section.
**Chosen: option 1.** A new `/gentle:project-map integrate` sub-action prints the ordered report and issues a `readiness-receipt` per verified candidate. A receipt is what makes the verification durable and auditable, and `readiness-receipt` already exists for exactly that with `authority: "none"`.

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
- `lib/shell-project-map-draft.ts` (the config parser export only, added when PM8-2b needed the project's own test command).
- `tests/project-map-integration-documents.test.ts` (new).
- `lib/project-map-store-schema.ts` and its tests **only if decision B adds a field**.
- `docs/project-map.md`, `docs/gentle-shell.md`.
- `odd/tasks/pm-8-integration-readiness.md`, `odd/tasks/project-map-orchestration.md`.

Anything outside this list is a scope question, not an edit.

## Task list

- [x] **PM8-1 — The readiness projection.** **Delivered 2026-09-26**, 410 changed lines (`lib/project-map-integration.ts` 180, `tests/project-map-integration.test.ts` 230) — **2.5% over the 400-line budget, recorded rather than split**, following the PM6-2b precedent (415 lines with the overage recorded). Splitting ordering from assembly would have been artificial: ordering alone is a helper, and the module's value is the assembled candidate.
  - **Ordering is topological and deterministic.** A dependency always precedes the capability that depends on it, ties break by id, and a cycle — which the map's own validation prevents, but a safety net is cheap — is reported as a warning with the members appended in id order rather than dropped.
  - **The checks default to `unverified`, never to verified.** `freshness`, `conflicts`, `tasks` and `review` come only from injected results, so a candidate nobody verified is never reported ready. `dependencies`, `contracts`, `blockers`, `coverage` and `verification` are computed here because their inputs are already-read values.
  - **Review is reported and never gates.** `PROJECT_MAP_INTEGRATION_GATING_CHECKS` names the eight checks a candidate must pass and deliberately excludes `review`, which is decision C made structural: a candidate with no review lineage can be ready, and the test pins it.
  - **The verification requirement is the project's own command.** It is carried as `{ command, source: "openspec-config" }` or `{ command: null, source: "not-declared" }`, and an undeclared command is `unverified` — which blocks ready rather than passing silently.
  - Closure evidence: focused **19/19**, full suite **3,928 (3,890 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [x] **PM8-2a — The repository readers.** **Delivered 2026-09-26**, 321 changed lines (`lib/project-map-integration-repository.ts` 136, `tests/project-map-integration-repository.test.ts` 185), within the budget. The slice was split from PM8-2 because Git and documents are two different readers.
  - **The executor reports failure as a value.** `ProjectMapIntegrationGitExecutor` returns `{ ok, output?, reason? }` instead of throwing, so a failing query is a fact the report can carry rather than an exception that escapes into a render. **The shape is deliberately flat, not a discriminated union**: this repository runs with `strict: false` and TypeScript does not narrow a union by its discriminant under that setting, which the type gate caught on the first pass.
  - **The default executor reuses the review tool's sanitisation.** `reviewGitEnvironment()` is imported rather than reimplemented, because two copies of a security-relevant function is how they drift; it fails closed on an inherited Git override, and the failure becomes `{ ok: false }`.
  - **The integration target is the branch the main worktree is on** — the first entry of `git worktree list`, the primary checkout. A detached main worktree, or a list that cannot be read, leaves the target unknown and every dependent answer stays unverified rather than guessing.
  - **Freshness separates *old* from *diverged*.** A base the target does not contain is a `mismatched`; a base that is merely behind is `verified` with the distance reported, because being behind is information, not a defect.
  - **Overlap is labelled *likely*, and the label is in the code.** `mismatched` on the conflicts check means *a likely conflict was detected*, never *a conflict was proven*; the shared paths are named and sorted, and one candidate's Git failure leaves the others' answers intact.
  - Closure evidence: focused **14/14**, full suite **3,942 (3,904 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [x] **PM8-2b — The document readers.** **Delivered 2026-09-26**, ~170 changed lines (`lib/project-map-integration-documents.ts` and its suite).
  - **The config parser was exported, not copied.** `readSimpleConfigEntries` already existed as a private function in `lib/shell-project-map-draft.ts`, and the verification requirement needs the project's own test command. It is now exported and reused, because a second reader of the same file is how two readers drift apart — the same reasoning that made the Git executor reuse `reviewGitEnvironment`. It is the one boundary extension this slice needed, and the file is added to the authorized surfaces below.
  - **The drift rule is symmetric and never resolves itself.** A capability declared `done` whose document still has open tasks is a mismatch, and so is a document whose every task is done while the map does not declare it done. A capability in flight with some tasks done agrees, because that is what in flight looks like; a document with no checkboxes never contradicts anything; a declared document that could not be read is a mismatch rather than a silent pass; and a capability that declares no document at all stays `unverified` with the reason named.
  - Closure evidence: focused **17/17**, full suite **3,959 (3,921 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
- [ ] **PM8-3 — The report and the receipts.** The `integrate` sub-action, the ordered report, and a `readiness-receipt` per verified candidate, with `authority: "none"` printed where a user cannot miss it (decision F).
- [ ] **PM8-4 — The launch nonce.** The `session-binding` schema field (decision B), the receiver that writes it, and the confirmation that compares it, with the tmux limit closed in the documentation. **This is a launch-flow change carried by this unit because PM-8 owns the decision, not a readiness change**, and it is ordered after the readiness core so the two never share a commit.
- [ ] **PM8-5 — Documentation and unit verification.** `docs/project-map.md`, the acceptance trace, and the honest record of what was not verified.

Each slice stays under the 400-line review budget and is its own commit. The schema field of decision B lands in PM8-4 with its own tests, never as a drive-by edit.

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

- 2026-09-26: **unit planned at recon depth.** Read-only surface map only; no code written. Its central finding is that the unit is mostly **assembly rather than invention**: the receipt shape, the ordering inputs, the branch base and an injectable Git executor all already exist, so the work is sequencing, verification and honest reporting rather than new state.
- 2026-09-26: **plan frozen.** The user approved all six recommendations: the verification requirement is derived from `openspec/config.yaml` rather than added to the map; a `launch_nonce` is added to the session binding to close the tmux identity limit; review evidence is read read-only through `lib/review-*` and never gates anything; conflict detection stays at changed-path overlap labelled *likely*, with real probing out of scope; map/task consistency is checked by parsing the feature document's checkboxes and reporting drift without correcting it; and the report lands as a new `integrate` sub-action issuing receipts with `authority: "none"`. The unit is five slices, PM8-1 through PM8-5, with the launch nonce isolated in PM8-4 because it belongs to the launch flow rather than to readiness, and PM8-2 split into 2a (the Git readers) and 2b (the document readers) because they are two different readers.
- 2026-09-26: **PM8-1 delivered** — the pure readiness projection, 410 changed lines, 2.5% over the budget and recorded rather than split. Ordering is topological with deterministic tie-breaking and a reported cycle safety net; every check defaults to `unverified`; review is reported but excluded from the gating set by construction; and the verification requirement is the project's own command with an undeclared one blocking ready. Closure evidence: focused **19/19**, full suite **3,928 (3,890 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0. Deliberately not verified: nothing touches the repository yet, so every repository-facing check stays `unverified` and no candidate is ready in production until PM8-2 supplies the real results.
- 2026-09-26: **PM8-2a delivered** — the Git-facing readers, 321 lines. The executor reports failure as a value rather than throwing, reuses the review tool's environment sanitisation instead of copying it, and the flat result shape exists because this repository's `strict: false` does not narrow a discriminated union by its discriminant — a trap the type gate caught on the first pass. The integration target is the branch the main worktree is on, freshness separates *old* from *diverged*, and overlap is labelled *likely* in the code itself. Closure evidence: focused **14/14**, full suite **3,942 (3,904 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, provider contract, runtime harness and `git diff --check` all exiting 0.
