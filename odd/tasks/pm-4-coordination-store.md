# PM-4 — Build the shared cross-worktree coordination store

## Objective
Give the Project Map a place to keep live process state that several worktrees of the same clone can read and write safely: which session claims which capability, which leases are live, which heartbeats are fresh, which blockers exist, and which readiness receipts were issued. The store lives in the shared Git common directory, never in the versioned map, and every read that cannot be trusted fails closed.

This is the fourth work unit of the initiative roadmap recorded in `odd/tasks/project-map-orchestration.md`. It consumes PM-1's vocabulary (capability identifiers, lifecycle states, coverage surfaces) and it is a prerequisite for PM-5 (lead/satellite contracts), PM-6 (worktree lifecycle) and PM-8 (integration readiness).

## Problem
The map records intent, not activity. Nothing in the repository can answer "who is working on this capability right now", and two sessions in two worktrees of the same clone have no shared, atomic place to find out. Without that, parallel work either stalls on human coordination or races: both sessions take the same capability, both write the same artifact, and the conflict surfaces late, after the work is done.

A store written naively is worse than none. Two writers appending to one JSON file lose each other's records; a crash leaves a claim nobody can release; a corrupted file read as empty silently hands live work to a second session. The store's value is exactly its refusal to be wrong.

## Why
The roadmap's parallel-work decision is one branch and one worktree per active capability, with a single writer per worktree. That decision only scales if ownership is durable, atomic, and recoverable without a human reconstructing state from process listings. The store is the mechanism that makes "one capability, one owner" enforceable rather than aspirational.

## Decisions (approved by the user)

| Decision | Choice | Consequence |
|---|---|---|
| Store root | `<canonical git common dir>/gentle-ai/project-map/` | Every linked worktree of the clone shares it; it is never committed; it is scoped to the clone and disappears with it. Already fixed by the roadmap's architecture boundary. |
| Repository identity | Reuse the clone-stable identity already computed from the canonical common directory | Sibling worktrees resolve to the same identity; an unrelated repository resolves to a different one and is refused. |
| Generation | Tuple `{ generation, epoch }` with a UUID epoch, mirroring `store_epoch`/`generation`/`authority_incarnation_id` in `lib/review-object-store.ts` | A restarted or resurrected session cannot pass its own stale generation off as current, which is what closes the split-brain window a bare counter leaves open. |
| Layout | Segmented: a store descriptor, a claims document, lease records, `heartbeats/<session-id>.json`, and `history/` | A 10-second heartbeat never rewrites the global claims document, so heartbeat traffic cannot contend with claim transitions. |
| Heartbeat / stale lease | 10s heartbeat, 60s stale | A crashed session's claim becomes recoverable within a minute, with room for a suspended laptop or a slow scheduler before the claim is stolen. |
| Corruption (user choice, refined) | Refuse on any unreadable or non-canonical store; quarantine on explicit recovery; auto-reset only when emptiness is proven | A failed read is never treated as an empty store, because that is the one path that silently discards live state. Auto-reset applies only to a store that read successfully and provably holds zero claims, zero leases and no live heartbeat. The user's literal choice was "auto-reset if empty"; this is that choice with the transient-error window closed, and the user can override it to reset on read errors too. |
| Scope | The whole PM-4 model in this unit: claims, leases, heartbeats, session bindings, blockers, readiness receipts | Several slices, each independently reviewable, rather than one oversized change. |

## Scope
- Store root resolution from the canonical Git common directory, with a no-escape assertion and restrictive permissions.
- Versioned schemas for every record type, with never-throwing validation, canonicalization and deterministic serialization, mirroring `lib/shell-project-map-schema.ts`.
- Atomic install and compare-and-swap on a monotonic generation with an epoch, so two writers cannot both win.
- Claims and leases: acquire, release, renew, expire, and detect a dead owner.
- Heartbeats and session bindings under the 10s/60s policy.
- Blockers and readiness receipts.
- Bounded history with pruning.
- Corruption handling: fail-closed reads, explicit quarantine-and-recover, and auto-reset on proven emptiness only.
- Tests for sibling worktrees, an unrelated repository, crash recovery, and stale leases.

## Non-goals
- The lead/satellite event protocol: typed events, arbitration, proposal/acceptance flows are PM-5. PM-4 stores state; it does not negotiate.
- Worktree provisioning, branch derivation, dirty-state inspection and cleanup are PM-6.
- Opening a Pi session in a capability worktree, and any terminal adapter, is PM-7.
- Integration ordering and readiness sequencing are PM-8. PM-4 defines a readiness receipt; deciding what makes a capability ready is PM-8's.
- Any change to `openspec/project-map.json`. The versioned map stays free of runtime fields, and its forbidden-field list is unchanged.
- Any claim of delivery authority: a claim grants bounded ownership of one capability's surfaces, never repository-wide write access, and never a commit, push or merge.

## Constraints
- TDD mode: strict (`openspec/config.yaml` declares `strict_tdd: true`); runner `node --experimental-strip-types --test tests/<file>.test.ts`.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons.
- No new runtime dependency.
- Reuse rather than reinvent, with the precedent recorded: canonical identity (`resolveCanonicalGitRepositoryIdentity`, `lib/review-session-standing-permission.ts:91`), canonical JSON and domain hashing (`lib/review-canonical.ts:28,36,40`), atomic install (`lib/review-object-store.ts:190`, `lib/agent-profiles.ts:536`), monotonic generation with predecessor chaining and a quorum pointer (`lib/review-object-store.ts:80,211`), lock acquisition with dead-owner proof (`lib/review-lock.ts:14`), bounded pruning (`lib/agents-history.ts:74`).
- Every read of shared state is fail-closed; only a successful read may be interpreted, and only a proven-empty store may be initialized.
- Single writer per worktree; this unit is developed on `feat/project-map-orchestration`.
- The store must never be written into the repository working tree, and its directory must not escape the common directory.

## Authorized edit surfaces
Slice by slice, since the unit is delivered as several work units. No slice may touch a path outside its own list.

- PM4-1 (schema and root): `lib/project-map-store-schema.ts` (new), `tests/project-map-store-schema.test.ts` (new), `lib/project-map-store-root.ts` (new), `tests/project-map-store-root.test.ts` (new)
- PM4-2 (store engine): `lib/project-map-store.ts` (new), `tests/project-map-store.test.ts` (new)
- PM4-3 (claims and leases): `lib/project-map-store-claims.ts` (new), `tests/project-map-store-claims.test.ts` (new)
- PM4-4 (heartbeats and bindings): `lib/project-map-store-heartbeats.ts` (new), `tests/project-map-store-heartbeats.test.ts` (new)
- PM4-5 (blockers and receipts): `lib/project-map-store-receipts.ts` (new), `tests/project-map-store-receipts.test.ts` (new)
- PM4-6 (cross-worktree end to end): `tests/project-map-store-worktrees.test.ts` (new)
- This document and `odd/tasks/project-map-orchestration.md` for bookkeeping.

## Task list

- [ ] **PM4-1 — Store schema and canonical root**
  - Freeze the record schemas (store descriptor, claim, lease, heartbeat, session binding, blocker, readiness receipt) with never-throwing `validate*`/`parse*`, canonicalization, deterministic serialization and diagnostic codes, mirroring the Project Map schema module.
  - Resolve the store root from the canonical Git common directory with the clone-stable repository identity, a no-escape assertion and `0o700` permissions; refuse a directory that is not the canonical root.
  - Refuse an unrelated repository's store and prove sibling worktrees resolve to the same root.
  - Cover the schema boundary, the canonical form, the root resolution and the refusal.
  - Design, fixed before the source write (2026-09-24):
    - Two new modules and their two test files, nothing else. `lib/project-map-store-schema.ts` mirrors the map schema module's shape: a frozen version constant `PROJECT_MAP_STORE_SCHEMA_V1 = "gentle-shell.project-map-store/v1"`, a `PROJECT_MAP_STORE_RECORD_KINDS` list, a `PROJECT_MAP_STORE_DIAGNOSTIC_CODES` map, a diagnostic type with `{ code, path, message, severity }`, and a never-throw boundary. `lib/project-map-store-root.ts` resolves the root and is the only module allowed to know where the store lives.
    - One generic record API instead of five functions per record type: `validateProjectMapStoreValue(kind, value)`, `parseProjectMapStoreValue(kind, text)`, `readProjectMapStoreValueFile(kind, path)`, `canonicalizeProjectMapStoreValue(kind, value)` and `serializeProjectMapStoreValue(kind, value)`. Each returns `{ record, diagnostics }`, mirroring the map schema's `{ map, diagnostics }`; `record` is `null` on any refusal and every function never throws. Five functions beat thirty-five, and the `kind` argument keeps the types honest. `schema` inside every document must equal the frozen version, and `kind` inside the document must equal the requested kind. Success returns the canonicalized record, so `serialize` writes exactly what `validate` accepted.
    - Diagnostic codes are schema-level only (`project-map-store/unsupported-schema-version`, `unknown-field`, `missing-field`, `invalid-field`, `invalid-json`, `unreadable-store`). Generation, staleness and corruption codes belong to PM4-2 and are not invented here.
    - **Record envelope (fixed 2026-09-24, second writer pass)**: every canonical record carries a required `kind` immediately after `schema`, because the store is a directory of JSON files whose names a reader must not have to trust: a renamed, copied or hand-edited file has to declare what it is, and serialization must keep that declaration. A missing `kind` is `missing-field` at `$.kind`; a `kind` that does not equal the requested kind (or is not one of the six) is `invalid-field` at `$.kind`.
    - Record shapes, all canonical with fixed key order: descriptor `{ schema, kind: "descriptor", repository_id, generation, epoch, predecessor, created_at, updated_at }` where `repository_id` is a `sha256:<hex>` identity, `generation` is a non-negative integer, `epoch` is a UUID, `predecessor` is a `sha256:` digest or null, and `created_at`/`updated_at` are ISO instants; claim `{ schema, kind: "claim", capability_id, session_id, acquired_at, lease }`; heartbeat `{ schema, kind: "heartbeat", session_id, pid, incarnation, beat_at }`; session binding `{ schema, kind: "session-binding", session_id, pid, incarnation, workspace_root, bound_at }`; blocker `{ schema, kind: "blocker", capability_id, reason, raised_by, raised_at, resolved_at?, resolution? }`; readiness receipt `{ schema, kind: "readiness-receipt", capability_id, issued_at, verified, evidence, authority: "none" }`.
    - Field rules that are easy to leave ambiguous: identifiers are non-empty strings; `pid` is a positive integer; `incarnation` is a UUID; every instant is validated with the existing `isIsoInstant` predicate rather than a second date check; `verified` is a non-empty array of unique non-empty strings and `evidence` is an array of unique non-empty strings; `repository_id`/`predecessor` are `sha256:<hex>`; `generation` is a non-negative integer; `epoch` is a UUID.
    - **Chronological comparisons compare instants, never strings (corrected 2026-09-24 after independent verification falsified the first version)**: `isIsoInstant` accepts offsets and fractional seconds, so a lexicographic comparison of two valid instants is wrong. With `acquired_at = 2026-09-24T12:00:00Z` and `lease.renewal_after = 2026-09-24T13:00:00+02:00`, the string comparison accepts a renewal window that actually starts at 11:00 UTC, one hour before acquisition. The lease order rules therefore compare `Date.parse` values, which is sound because both operands already passed `isIsoInstant`'s calendar check, and the tests must include mixed offsets and fractional seconds, not only uniform `Z` instants.
    - **Diagnostic paths inside the lease carry the prefix**: a missing or unknown `lease` field is reported at `$.lease.<field>`, never at `$.<field>`. The first version reused the top-level helpers and produced `$.renew_by` for a field that lives at `$.lease.renew_by`, which is the same class of inexact path the map schema refuses.
    - **Blocker pairing reports the absent counterpart as missing (doc corrected to match the implementation)**: a blocker with `resolved_at` and no `resolution` reports `missing-field` at `$.resolution`, and one with `resolution` and no `resolved_at` reports `missing-field` at `$.resolved_at`. The first version of this block said `invalid-field`; the implementation's choice is the accurate one (the field really is absent) and the documentation was the imprecise part.
    - **One sanitized resolution feeds both the path and the identity (corrected 2026-09-24)**: `resolveSessionWorktreeWithGit` strips ambient `GIT_*` variables while `resolveCanonicalGitRepositoryIdentitySync` inherits them, so calling both on the same cwd can succeed against different repositories and pin a mismatched `repository_id` into the store. The identity is therefore derived from the same sanitized `commonDir` that composes the path, using the review module's formula, and a test pins equality between the two derivations for the same repository so drift between them fails loudly instead of silently mismatching.
    - **Design refinement, flagged for the user**: there is no standalone lease record. The frozen kind list is exactly `descriptor`, `claim`, `heartbeat`, `session-binding`, `blocker` and `readiness-receipt`; a standalone lease document would duplicate the claim and give the store two sources of truth for the same fact, which is exactly the drift the store exists to prevent. Lease *semantics* (renew, expire, stale recovery) are PM4-3's work and are unchanged by this choice.
    - **Lease contract (fixed 2026-09-24, after the first writer pass refused the ambiguous version)**: `claim.lease` is exactly `{ renewal_after, renew_by }`, both ISO instants. `renewal_after` is the earliest instant at which a renewal is accepted (the 10s cadence, so a holder cannot thrash the store) and `renew_by` is the instant by which the holder must renew or the claim becomes stale and recoverable (the 60s deadline). Validation requires `renewal_after >= acquired_at` and `renew_by > renewal_after`; there is no separate `expires_at`, because a second deadline for the same fact is the duplication this design rejects. PM4-1 only validates the shape and that order; PM4-3 computes the instants from the user's 10s/60s policy.
    - Root resolution: `resolveProjectMapStoreRoot(cwd)` calls the existing `resolveSessionWorktreeWithGit` for the canonical common directory and the existing `resolveCanonicalGitRepositoryIdentitySync` for the clone-stable identity, then composes `join(commonDir, "gentle-ai", "project-map")` and passes it through the existing exported `assertManagedStorePathV1(commonDir, path)`, converting its throw into a diagnostic so the boundary still never throws. If either resolver returns nothing, or the two disagree about whether a repository exists, it refuses with a diagnostic instead of guessing. No local re-implementation of the identity hash: one source of truth, two git invocations.
    - `ensureProjectMapStoreRoot` (the only writer in this slice) creates the directory with `mkdirSync(root, { recursive: true, mode: 0o700 })` and then refuses if the effective mode grants group or other access, so an insecure pre-existing directory is reported rather than silently used. Resolution itself performs no writes.
    - The store is never a tracked path by construction: it lives under the Git common directory, which Git never tracks. A test asserts the composed root is inside the common directory and that nothing under it can be reached through the working tree.
    - Tests, written first and watched fail: `tests/project-map-store-schema.test.ts` covers the frozen vocabulary, migration-safe defaults, version and kind refusals, unknown and missing fields with exact paths, the generation/epoch/predecessor rules, the receipt's `authority: "none"` refusal, invalid JSON versus an unreadable file, and byte-identical serialization independent of insertion order. `tests/project-map-store-root.test.ts` covers two linked worktrees resolving the same root and identity, an unrelated repository resolving a different one, a path outside any repository refusing without throwing, the escape and symlink refusals, and the `0o700` creation versus a world-readable pre-existing directory, using the isolated Git fixture already proven in `tests/session-worktree-registry.test.ts`.
    - Evidence expectation: focused suites green, mutation probes for the version refusal, the escape refusal and the permissions refusal, independent verification, and one native review of the slice's committed range.

- [ ] **PM4-2 — Store engine with compare-and-swap and corruption handling**
  - Atomic install of the store descriptor with monotonic generation, epoch, and predecessor hash chaining.
  - Compare-and-swap: a writer whose observed generation is stale is refused, not merged.
  - Corruption handling as decided: fail-closed on any unreadable or non-canonical store, quarantine with an explicit recovery path, and auto-reset only when a successful read proves the store empty (no claims, no leases, no live heartbeat).
  - Bounded history with pruning.
  - Cover the CAS race, the refusal, the quarantine, the proven-empty reset and the bounded history.

- [ ] **PM4-3 — Claims and leases**
  - Acquire, release, renew and expire a capability claim under CAS, with one live owner per capability and the 60s stale rule.
  - Dead-owner detection following the lock precedent, without stealing a lease that is still being renewed.
  - Cover acquisition, contention, renewal, expiry, recovery of a stale claim, and the refusal to take a live one.

- [ ] **PM4-4 — Heartbeats and session bindings**
  - Heartbeat records per session under the 10s cadence, with session bindings that tie a claim to the session and process that holds it.
  - Prune dead heartbeats without touching live claims, and treat a heartbeat as a heuristic rather than proof of liveness.
  - Cover the freshness window, the prune, and the binding.

- [ ] **PM4-5 — Blockers and readiness receipts**
  - Blocker records with an owner and a resolution path, and readiness receipts that record what was verified without granting delivery authority.
  - Cover creation, resolution, and the receipt's explicit lack of authority.

- [ ] **PM4-6 — Cross-worktree end to end**
  - A real fixture with a main worktree and a linked worktree of the same clone, plus an unrelated repository: the siblings share the store, the unrelated one cannot touch it, and a concurrent claim race resolves to one winner.
  - Cover crash recovery (a claim whose owner process is gone) and reload behavior.

## Acceptance criteria
- Two linked worktrees of one clone resolve the same store root and the same repository identity; an unrelated repository resolves a different one and is refused.
- The store is never written inside the working tree, and its root cannot escape the common directory.
- A writer whose observed generation is stale is refused, and a refused write leaves the store byte-identical.
- A generation tuple with an epoch prevents a restarted session from writing as if it were the current holder.
- An unreadable or non-canonical store is refused on read, never interpreted as empty.
- Auto-reset happens only when a successful read proves zero claims, zero leases and no live heartbeat.
- A claim has exactly one live owner; a stale claim is recoverable after its lease expires, and a live one is not stolen.
- A heartbeat older than the policy is not proof of liveness, and pruning it never removes a live claim.
- History is bounded.
- No runtime field is ever written into the versioned map, and the store grants no commit, push, merge or delivery authority.

## Review workload forecast
Estimates: PM4-1 ≈ 380 lines (schema module plus root resolution and their tests), PM4-2 ≈ 380, PM4-3 ≈ 350, PM4-4 ≈ 300, PM4-5 ≈ 250, PM4-6 ≈ 250. Every slice stays under the 400-line review budget, and each is delivered as its own commit and its own native review range. If a slice measures over budget, it is split before it is committed rather than after.

## Progress
- 2026-09-24: Unit planned after a read-only mapping of the surfaces it can reuse (canonical worktree and repository identity, canonical JSON, atomic install, generation with predecessor chaining, lock with dead-owner proof, bounded pruning) and after the user settled four decisions: 10s/60s heartbeat and stale policy, corruption refusal with auto-reset only on proven emptiness, the full PM-4 model in this unit, and the chained-PR publication strategy that already governs this branch. PM4-1 is the next work unit; nothing has been implemented yet.

## Next decision
PM4-1 is the next work unit and is authorized by this plan; it starts with its design fixed before its first source write, as every stage of PM-3 did. The unit's other slices follow in order, each with its own review.

The one decision still open for the user is the refinement recorded above: whether a read error may ever trigger the automatic reset, or whether that stays limited to a provably empty store. The plan implements the limited version and says so in the delivery report, so the user can override it in one line if they want the literal behavior.
