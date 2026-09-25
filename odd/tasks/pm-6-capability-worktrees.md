# PM-6 — Provision and manage capability worktrees safely

## Objective

Let a claimed capability get its own Git worktree and branch, safely: derive both names from the approved capability id, validate every precondition before touching the filesystem, create the worktree behind an explicit human confirmation, and record durably which capability owns which branch and which path. Nothing in this unit deletes or rewrites a worktree or a branch.

## Problem

PM-4 built the coordination store and PM-5 the protocol over it: claims, leases, heartbeats, session bindings, blockers, receipts and shared contracts are durable records, and a read-only projection reports who is where. What does not exist is the workspace itself. A satellite can claim a capability, but there is no worktree to work in, no branch named after the capability, and nothing that links a claim to a directory. The read-only inspection the whole repository relies on — `resolveSessionWorktreeWithGit`, `assertManagedStorePathV1`, `SessionWorktreeRegistry.validate` — can resolve and validate a worktree that already exists, but nothing in product code has ever created one for a capability: the only `git worktree add` calls in the repository belong to the review subsystem's ephemeral detached views and to test fixtures.

## Why

Every later unit needs this. PM-7 has nothing to open Pi into without a worktree, PM-8 has nothing to order for integration without branches, and the coordination projection's advisory scope signal cannot become real enforcement until a worktree is bound to a capability. Doing it safely is the whole point of the unit: this is the first piece of the project that writes outside the store, so every refusal has to be a named diagnostic and every creation has to be something a human saw first.

## Decisions (approved by the user, 2026-09-25)

| Question | Options offered | Chosen |
|---|---|---|
| Where does a capability worktree live and what is its branch called? | sibling per repository (`<parent>/<repo>-worktrees/<capability-id>`, branch `feat/<capability-id>`); one shared directory (`<projects>/gentle-pi-worktrees/<repo>-<capability-id>`); configurable with the sibling as default | **Sibling per repository, branch `feat/<capability-id>`** |
| Does PM-6 create the worktree or only inspect and propose? | create behind an explicit confirmation with a dry run first; inspect only and hand the human a plan; create silently when every validation passes | **PM-6 creates, behind an explicit confirmation, after showing the plan** |
| Is the capability claim a precondition? | live claim first, then the worktree; worktree first and the claim later; independent, the worktree does not require a claim | **A live claim first, then the worktree** |
| What happens when something already exists or the tree is dirty? | reuse when it is safe and ask when in doubt; strict fail-closed on everything; never decide, report and let the human choose | **Reuse when it is safe, ask when in doubt** |

## Scope

### Included

- A pure, deterministic identity: the branch and the worktree path derived from the approved capability id, with no filesystem access.
- A read-only inspection that answers every precondition question before anything is created: does the branch exist, does the target directory exist and is it empty, does the path sit inside another repository, is the target in the same clone, is a live session already there, does the requesting session hold the capability's claim.
- Provisioning: create the branch and the worktree behind a human confirmation, with the plan shown first; reuse an existing branch and directory only when they are the same clone and clean; refuse everything else with a named diagnostic.
- A durable record that binds a capability to its branch and worktree path, so the coordination projection and PM-8 can see the workspace as state rather than as a guess.
- Registration of the new worktree with the coordinating Pi session, reusing `SessionWorktreeRegistry`.
- The command surface for the human: inspect, provision, list.
- Documentation and verification of the unit.

### Non-goals

- Opening Pi in the worktree, terminal adapters and the handoff payload (PM-7).
- Integration ordering and merge-conflict prediction (PM-8).
- Any automatic deletion, pruning or rewriting of a worktree or a branch: cleanup inspects, reports and asks, and nothing destructive runs unattended.
- Delivery authority: provisioning a worktree or creating a branch authorizes no commit, push, PR, merge or release.
- Worktree provisioning for anything that is not an approved capability of this repository's map.
- The lead/satellite protocol itself: PM-5 owns it and this unit only consumes claims and bindings.

## Constraints

- TDD mode: strict (`openspec/config.yaml` declares `strict_tdd: true`); runner `node --experimental-strip-types --test tests/<file>.test.ts`.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons. No new runtime dependency.
- Reuse rather than reinvent: `resolveSessionWorktreeWithGit` and `worktreeGitEnvironment` (`lib/session-worktree-registry.ts`), `assertManagedStorePathV1` (`lib/review-repository.ts`), `parseWorktrees` and `foreignRootBranch` (`lib/shell-changes.ts`), `SessionWorktreeRegistry` for registration, and the store's lock, readiness gate, digest-not-segment paths, canonical serialization and diagnostic vocabulary.
- Every Git command runs with the sanitized environment the repository already uses, and never with an inherited `GIT_DIR`/`GIT_WORK_TREE`.
- The capability id is already restricted by the map schema (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters), so a branch name derived from it inherits those rules and needs no extra escaping — but the derivation is still a pure function with its own tests, because a branch name is a filesystem-adjacent string.
- One writer per worktree; the single-clone rule (`commonDir` equality) is enforced by the existing registry and re-checked here.
- Runtime state never enters the versioned map, and no capability worktree is ever created inside the repository checkout or inside the Git common directory.

## Authorized edit surfaces

Slice by slice; no slice may touch a path outside its own list.

- PM6-1 (identity and inspection, read-only): `lib/project-map-worktrees.ts` (new), `tests/project-map-worktrees.test.ts` (new)
- PM6-2 (provisioning): `lib/project-map-worktrees.ts`, `tests/project-map-worktrees.test.ts`, and `lib/project-map-store-schema.ts` plus `tests/project-map-store-schema.test.ts` for the provisioning diagnostic codes only
- PM6-3 (the durable worktree binding): `lib/project-map-store-worktrees.ts` (new), `tests/project-map-store-worktrees.test.ts` (new), `lib/project-map-store-schema.ts` for the `worktree-binding` record kind and its codes, `tests/project-map-store-schema.test.ts` for the pinned vocabulary and the record shape, and `lib/project-map-store.ts` plus `tests/project-map-store.test.ts` for adding `worktrees` to the record-directory accounting in the emptiness proof
- PM6-4 (session registration and command surface): `extensions/gentle-project-map.ts`, `tests/gentle-project-map-worktrees.test.ts` (new), and `tests/gentle-project-map.test.ts` for the sub-action list
- PM6-5 (documentation and verification): this document and `odd/tasks/project-map-orchestration.md`, plus `docs/project-map.md` for the protocol documentation
- This document and `odd/tasks/project-map-orchestration.md` for bookkeeping at any point

## Task list

- [ ] **PM6-1 — Worktree identity and safety inspection (read-only)**
  - Design, fixed before the source write (2026-09-25):
    - **The identity is pure and deterministic**: `deriveProjectMapWorktreeIdentity({ repositoryRoot, capabilityId })` returns `{ branch: \`feat/${capabilityId}\`, path: join(dirname(repositoryRoot), \`${basename(repositoryRoot)}-worktrees\`, capabilityId) }`. No filesystem access, no Git call, no clock. The path is derived from the *canonical* repository root the caller resolved, never from a caller-supplied string.
    - **A read-only inspection answers every precondition at once**: `inspectProjectMapWorktreeTarget({ cwd, capabilityId, sessionId, now })` returns `{ identity, repository, branch, directory, session, claim, diagnostics }` where `repository` carries `{ root, commonDir, sameClone }`, `branch` carries `{ name, exists, isCurrent }`, `directory` carries `{ path, exists, empty, insideAnotherRepository, insideCommonDir }`, `session` carries `{ occupiedBy: string | null, heartbeat: "fresh" | "stale" | "missing" }`, and `claim` carries `{ status: "free" | "live" | "stale" | "held-by-other" | "corrupted", sessionId }`. It writes nothing: no branch, no directory, no lock, no store record. A test proves the filesystem and the store are byte-identical before and after.
    - **The checks that do not exist yet, written here**: branch existence through `git show-ref --verify --quiet refs/heads/<branch>`; target directory state through a single `readdirSync` with an ENOENT-tolerant helper; nested-repository detection by asking Git for the target's own top level (`git -C <target> rev-parse --show-toplevel`) and refusing when it resolves to something other than the expected repository; and common-directory containment through `assertManagedStorePathV1`'s sibling rule, applied to the worktree base directory rather than the store.
    - **Occupancy is read from the store, not guessed**: a worktree is occupied when a live session binding exists for a session whose `workspace_root` is the target path and whose heartbeat is fresh. A stale binding with a provably dead pid is not occupancy — the store already has the proof predicate for that, and this slice reuses it rather than inventing a second one.
    - **Every Git call is read-only and sanitized**: `worktreeGitEnvironment()` for every invocation, `--no-optional-locks`, and no command that can mutate (`add`, `branch -d`, `checkout`, `prune`, `remove`). A test asserts that inspecting a repository leaves `git worktree list` and `git branch` output unchanged.
    - Tests, written first and watched fail: the identity derivation for a normal id, for a 64-character id, for an id with many hyphens, and for a repository whose basename contains a dot; branch absent and present; directory absent, present-and-empty, and present-with-content; a target inside another repository refused; a target inside the Git common directory refused; a foreign clone refused through `sameClone: false`; a free store, a live claim held by this session, a live claim held by another session, and a stale claim; a live session occupying the target and a dead one not occupying it; and the read-only proof.
    - Evidence expectation: RED before GREEN, mutation probes on the identity derivation, the nested-repository refusal and the occupancy rule, the four gates (focused, neighbours, full suite, `check-types`), independent verification and one native review.

- [ ] **PM6-2 — Provisioning, behind a confirmation**
  - Design, fixed before the source write (2026-09-25):
    - **Two functions, one plan**: `planProjectMapWorktree({ cwd, capabilityId, sessionId, now })` returns the inspection plus a `decision` of `"create" | "reuse" | "refuse"` and the exact command it would run; `provisionProjectMapWorktree({ cwd, capabilityId, sessionId, now })` re-inspects under the store lock and then performs the decision. The plan is what the command shows the human; the provision is what runs after the confirmation.
    - **A live claim is required, and it is the caller's or the lead's**: provisioning refuses with `worktree-claim-required` when the capability has no live claim, and with `claim-held` (the store's existing code, reused rather than duplicated) when another session holds it and the caller is neither that session nor the live lead. The check reads the claim through `readProjectMapClaim` and the lead through the PM-5 projection, so there is exactly one definition of each.
    - **Create** is `git worktree add -b <branch> <path> <base>`, where `<base>` is the resolved `HEAD` of the session's repository at the moment of the plan, recorded in the durable binding so the base is auditable. The command runs with the sanitized environment, and the base directory is created with `0o700` before Git is invoked.
    - **Reuse** happens only when the branch exists *and* the directory exists *and* both belong to the same clone *and* the directory is clean: then nothing is created, the existing worktree is attached and registered, and the result says `created: false`. A dirty directory is not a refusal by itself — the plan reports it and the human decides — but a directory holding a *different* branch or a foreign repository is a refusal.
    - **The refusals, each a named diagnostic**: `worktree-claim-required` (no live claim), `worktree-target-not-empty` (a directory with content that is not this worktree), `worktree-nested-repository` (the target resolves inside another repository), `worktree-foreign-clone` (`sameClone: false`), `worktree-occupied` (a live session already works there), and `worktree-path-escapes` (the derived path leaves the repository's parent directory). The store's existing `claim-held` is reused for the other-holder case.
    - **Six new diagnostic codes**, the only vocabulary change: the six above. Unreadable or corrupted store state reuses `unreadable-store` and `store-corrupted`; no existing code changes meaning.
    - **Nothing is half-created**: if the branch creation succeeds and the worktree creation fails, the branch is reported as created and left in place with a diagnostic that says so, because deleting a branch automatically is exactly what this unit forbids; the human is told the exact command to finish or undo.
    - Tests, written first and watched fail: a clean create that ends with the branch, the worktree and the expected `git worktree list` entry; a plan that refuses without a claim and a plan that refuses for another holder; a create that leaves nothing behind when the claim disappears between plan and provision; reuse of a same-clone clean worktree reporting `created: false`; a refusal for a non-empty foreign directory, for a nested repository, for a foreign clone, for an occupied target and for a path that escapes; a dirty-but-correct directory reported without refusing; the base commit recorded; and the byte-level proof that a refusal creates no branch and no directory.
    - Evidence expectation: RED before GREEN, mutation probes on the claim gate, the reuse condition and each refusal, the four gates, independent verification and one native review.

- [ ] **PM6-3 — The durable worktree binding**
  - Design, fixed before the source write (2026-09-25):
    - **One new record kind**, because neither existing record can carry this fact: a claim is a lease that expires, and a session binding records a session's workspace rather than a capability's branch. The record is `{ schema, kind: "worktree-binding", capability_id, branch, worktree_root, session_id, base_commit, created_at }` with `base_commit` a full 40- or 64-character commit id, `worktree_root` an absolute canonical path, and `branch` a name matching the repository's branch convention.
    - **Layout**: `worktrees/<sha256(capability_id)>.json`, the digest-not-segment discipline the store already uses, one record per capability because a capability has exactly one worktree.
    - **Operations**: `readProjectMapStoreWorktreeBinding({ root, capabilityId })` (lock-free, `free | bound | corrupted | unreadable`), `bindProjectMapStoreWorktree({ root, capabilityId, branch, worktreeRoot, sessionId, baseCommit, now })` (under the store lock, refuses on a store that is not `ready`, refuses `worktree-already-bound` when a record already exists whose branch or root differs, and is idempotent when the record matches exactly), and `listProjectMapStoreWorktreeBindings({ root })` which enumerates the directory and reports corrupt entries as diagnostics.
    - **The store still does not arbitrate**: `bind` records the session and never checks that it holds the claim; that check belongs to PM6-2 and the command, exactly as PM-5 drew the line.
    - **The emptiness proof learns about the new directory in this slice**: `PROJECT_MAP_STORE_RECORD_DIRECTORIES` gains `"worktrees"`, with the expectation in `tests/project-map-store.test.ts` that a store holding a binding is not provably empty and that the diagnostic names the directory.
    - **One new store diagnostic code**: `worktree-already-bound`. Unparsable, non-canonical or mismatched records reuse `unreadable-store` and `store-corrupted`.
    - Tests, written first and watched fail: a binding written and read back canonically; a second identical binding treated as an idempotent no-op; a second binding with a different branch or root refused with `worktree-already-bound` and the first record preserved byte-for-byte; a corrupt, non-canonical and mismatched record each classified `corrupted`; a list that reports corrupt entries as diagnostics and returns the valid ones; a binding operation on an uninitialized store refused with nothing written; an adversarial capability id landing inside `worktrees/` with nothing outside it; and the emptiness expectation for the new directory.
    - Evidence expectation: RED before GREEN, mutation probes on the idempotence rule, the already-bound refusal and the mismatch classification, the four gates, independent verification and one native review.

- [ ] **PM6-4 — Session registration and the command surface**
  - Design, fixed before the source write (2026-09-25):
    - **Registration reuses the registry**: after a create or a reuse, the worktree is registered through `SessionWorktreeRegistry.register(path, evidence)` with evidence naming the capability, so the session's roots include it and the same-clone rule is enforced by the code that already enforces it. A registration failure is reported as a warning on an otherwise successful provision, because the worktree exists whether or not the session learned about it.
    - **The command sub-action** `worktree inspect|provision|list` is added to `PROJECT_MAP_SUB_ACTIONS` with its usage string and dispatched in the existing chain: `inspect` prints the plan and writes nothing; `provision` prints the same plan, asks for confirmation through the extension's existing `ctx.ui.confirm` convention, and then provisions; `list` reads the durable bindings and prints capability, branch and path.
    - **The confirmation shows the plan, not a summary of it**: branch, path, base commit, and the decision (`create` or `reuse`) plus every check that passed, so the human confirms the exact command that will run.
    - **Refusals keep their store codes**, and the command prints them rather than paraphrasing, matching how the `contract` sub-action already behaves.
    - Tests, written first and watched fail: the parser accepts `worktree` and still rejects an unknown sub-action; `inspect` prints the plan and writes nothing (store and filesystem byte-identical); `provision` asks exactly once and creates on confirmation; a declined confirmation creates nothing; a provision whose registration fails still reports the worktree and a warning; `list` prints the bindings for several capabilities; and every refusal surfaces its diagnostic code.
    - Evidence expectation: RED before GREEN, mutation probes on the confirmation gate, the plan-then-provision order and the registration warning, the four gates, independent verification and one native review. If the slice measures over the review budget it is split into a registration half and a command half before it is committed.

- [ ] **PM6-5 — Documentation and verification**
  - Document the unit where a human meets it: `docs/project-map.md` gains the worktree section (where a capability worktree lives, how it is named, what the command does, what is refused, and what never happens automatically), and the roadmap pointer is updated.
  - Verify the unit against the acceptance criteria below, with the full suite, the type gate and a written record of what was verified and what was not.

## Acceptance criteria

- A capability's branch and worktree path are derived purely from its approved id, and the derivation is deterministic and tested at the id's boundaries.
- No branch, directory, worktree or store record is created by an inspection, and the proof is byte-level.
- Provisioning requires a live claim on the capability, held by the requesting session or by the live lead.
- Provisioning creates a worktree only after the human saw the exact plan and confirmed it.
- An existing same-clone clean worktree is reused and reported as not created; anything else is refused with a named diagnostic, and a refusal leaves no branch and no directory behind.
- A nested repository, a foreign clone, an occupied target and an escaping path are all refused.
- The durable binding records capability, branch, absolute worktree root, session and base commit, is idempotent for an identical re-bind, and refuses a conflicting one without overwriting the first.
- A store holding a worktree binding is never provably empty.
- Nothing in this unit deletes, prunes or rewrites a worktree or a branch automatically, and nothing grants commit, push, PR, merge or release authority.
- Every Git command in the unit runs with the repository's sanitized environment.

## Review workload forecast

Estimates: PM6-1 ≈ 380 lines (the identity, the inspection and their fixtures), PM6-2 ≈ 320, PM6-3 ≈ 320, PM6-4 ≈ 300, PM6-5 ≈ 150. Every slice stays under the 400-line review budget, and each is delivered as its own commit. If a slice measures over budget, it is split before it is committed rather than after.

## Progress

- 2026-09-25: unit planned after a read-only surface map. The map's most important finding is that **nothing in product code creates, moves or deletes a capability worktree or branch today** — the only `git worktree add` calls belong to the review subsystem's ephemeral detached views and to test fixtures — so PM-6 introduces the first filesystem write outside the store. The map also established that the capability id rules (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤64 characters) are already enforced by the map schema, that the human-authorization patterns to reuse are `ctx.ui.confirm` preceded by a printed plan, and that no helper exists yet for branch existence, target-directory state or nested-repository detection. The user settled the four open product decisions and the plan is frozen above. Nothing has been implemented yet; PM6-1 is the next work unit.

## Next decision

PM6-1 (worktree identity and safety inspection, read-only) is the next work unit and is authorized by this plan; its design is frozen above and it starts with the tests written first. Then PM6-2 (provisioning behind a confirmation), PM6-3 (the durable binding), PM6-4 (registration and the command surface) and PM6-5 (documentation and verification), which closes the unit. After PM-6, the roadmap continues with PM-7 through PM-9.

Two things a later reader should not have to rediscover: this is the first unit that writes outside the coordination store, so its refusals are the safety story and every one of them is a named diagnostic; and the four decisions above are product decisions, so changing the worktree layout, the branch prefix, the claim precondition or the collision policy is a decision to re-take rather than a bug to fix.
