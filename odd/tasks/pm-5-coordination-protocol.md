# PM-5 — Establish lead/satellite coordination contracts

## Objective

Give the Project Map a coordination protocol: one lead orchestrator per repository, satellites that claim one capability each, shared contracts that are proposed and decided with durable evidence, and a read-only projection that reports who is where, what conflicts, and what the next safe action is. The protocol carries no delivery authority and never writes the versioned map outside one bounded field.

## Problem

PM-4 built the durable store: claims, leases, heartbeats, session bindings, blockers and readiness receipts are files under the canonical Git common directory, with a lock, a generation tuple and bounded history. What does not exist yet is the protocol that uses it. Today a satellite can claim a capability, but nothing says who the lead is, nothing records a shared-contract proposal, nothing detects a conflicting claim or an unavailable peer, and the versioned map's `contracts` field is a list of unresolvable strings — PM-1 recorded that the shared registry "arrives with PM-5".

## Why

The roadmap's authority model splits coordination from delivery: the lead owns the canonical map, contested boundaries and shared contracts, satellites propose but cannot rewrite another capability's scope, and the human approves consequential decisions. A store without a protocol leaves every one of those sentences unenforced and unobservable: the Project Map card cannot show an owner, a contract state or a next action, and PM-6 (worktrees), PM-7 (launch) and PM-8 (integration readiness) all consume a protocol that does not exist yet.

## Decisions (approved by the user, 2026-09-25)

| Question | Options offered | Chosen |
|---|---|---|
| Where does a shared-contract proposal live and what shape does it have? | a new `contract-proposal` store record kind; notification only, no durable record; one record per capability with an embedded decision history | **A new `contract-proposal` record kind in the store** |
| What may the lead write when it accepts a shared contract? | write the map directly; register in the store and let the human apply it | **Write the map directly — scoped to the `contracts` array of an already approved map** (confirmed in a follow-up question, after the conflict with PM-2 and the roadmap was spelled out: capabilities, surfaces, dependencies, foundations and the approval state stay human-gated, and every write is mirrored as durable evidence in the store) |
| Which events are durable records and which are derived or signals? | durable = state transitions, the rest derived; a durable journal of every event; a journal only for contract decisions | **Durable = state transitions; `dependency-ready` and `completion` are derived; notifications are signals** |
| How is the lead identified in the store and how is split-brain avoided? | a claim on a reserved capability id; a dedicated `leader` record; the descriptor epoch owner | **A claim on a reserved capability id** |

The user's second answer is a deliberate change to the authority model the roadmap sketched, and it is recorded as such: the lead gains a bounded write path into the versioned artifact. Everything else in the map — the capability list, their surfaces, dependencies and foundations, and the `draft`/`approved` state — remains the human's, and PM-2's refusal to re-approve an approved map is untouched.

## Scope

### Included

- The `contract-proposal` record kind: propose, decide (accept or reject), read and list, with durable evidence and no overwriting of a decided proposal.
- The lead as a claim on a reserved capability id, with the lease semantics PM-4 already implements (a live lease is never stolen, a stale one is recovered with a visible warning).
- The bounded map write: an accepted contract is applied to the `contracts` array of an already approved map, and nothing else in the artifact moves.
- A read-only coordination projection: lead state, satellite claims, conflicts (unknown capability, undeclared surfaces, unavailable peer, reserved id declared, stale generation), dependency readiness, and the next safe action.
- The smallest command surface that makes the protocol usable by a human and a satellite: lead claim/renew/release/status, and contract propose/accept/reject/list.

### Non-goals

- Worktree provisioning, branch derivation, dirty-state inspection and cleanup (PM-6).
- Opening Pi in a capability worktree, terminal adapters and the handoff payload (PM-7).
- Integration ordering and merge-conflict prediction (PM-8).
- Rendering the coordination state in the Project Map card: PM-5 produces the projection the card will consume, and wiring it into the card belongs to the slice that renders it.
- Any delivery authority: no commit, push, PR, merge or release path, and no readiness receipt that grants one.
- Any write to the versioned map outside the `contracts` array of one capability.
- A durable event journal: the store records are the state, and a second journal would be a second source of truth (the same reasoning PM4-1 used to refuse a standalone lease record).

## Constraints

- TDD mode: strict (`openspec/config.yaml` declares `strict_tdd: true`); runner `node --experimental-strip-types --test tests/<file>.test.ts`.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons. No new runtime dependency.
- Reuse rather than reinvent: the store's lock, readiness gate, digest-not-segment path discipline, canonical serialization and diagnostic vocabulary (`lib/project-map-store-*.ts`); the single authorized map writer `writeProjectMapFile` and the map validator (`lib/shell-project-map-approval.ts`, `lib/shell-project-map-schema.ts`); the read-only projection precedent of `lib/sdd-status.ts`.
- The store records state and does not arbitrate: the store never checks who the lead is. Arbitration ("only the lead decides") lives in the projection and the command layer, where it is testable and visible.
- Runtime fields never enter the versioned map: `PROJECT_MAP_RUNTIME_FIELDS` stays as it is, and applying a contract writes only into the capability's `contracts` array.
- Single writer per worktree; this unit is developed on `feat/project-map-orchestration`.

## Authorized edit surfaces

Slice by slice; no slice may touch a path outside its own list.

- PM5-1 (contract proposals in the store): `lib/project-map-store-contracts.ts` (new), `tests/project-map-store-contracts.test.ts` (new), `lib/project-map-store-schema.ts` for the `contract-proposal` kind and the three contract diagnostic codes only, `tests/project-map-store-schema.test.ts` for the pinned vocabulary and the new record shape
- PM5-2 (the bounded map write): `lib/shell-project-map-contracts.ts` (new), `tests/shell-project-map-contracts.test.ts` (new)
- PM5-3 (coordination projection): `lib/project-map-coordination-state.ts` (new), `tests/project-map-coordination-state.test.ts` (new)
- PM5-4 (command surface): `extensions/gentle-project-map.ts`, `tests/gentle-project-map.test.ts`, and `tests/gentle-project-map-contracts.test.ts` (new) if the slice is split
- PM5-5 (documentation and verification): this document and `odd/tasks/project-map-orchestration.md`
- This document and `odd/tasks/project-map-orchestration.md` for bookkeeping at any point

## Task list

- [ ] **PM5-1 — Contract proposals in the store**
  - Design, fixed before the source write (2026-09-25):
    - **Layout**: `contracts/<sha256(capability_id)>/<sha256(contract_id)>.json`, the same digest-not-segment discipline as claims and blockers, one directory level per capability so a capability's contracts stay together.
    - **Record shape, one new kind in the store vocabulary**: `{ schema, kind: "contract-proposal", capability_id, contract_id, title, digest, proposed_by, proposed_at, state, decided_by?, decided_at?, rationale? }` where `state` is `"proposed" | "accepted" | "rejected"`. `title` is a non-empty human label, `digest` is a `sha256:` digest of the contract body — the body itself stays out of the store, because a store that carries documents stops being a store — and `proposed_by`/`decided_by` are session ids.
    - **The state pairing rule mirrors the blocker's**: `state` other than `"proposed"` requires `decided_by`, `decided_at` and `rationale`, and `state: "proposed"` forbids them, so a record can never claim a decision it does not carry. The paired absence is reported as `missing-field` at the absent field's path, exactly as the blocker pairing does.
    - **`superseded` was dropped from the shape the user approved, and this is a recorded refinement**: a decided record is never rewritten, so a revision is a new `contract_id` (for example `billing-v2`) and the map cleans up the old id through an explicit `supersedes` argument on the apply operation. Keeping a `superseded` state would have meant rewriting a decided record — the one thing this store never does.
    - **Operations**, mirroring the blockers module's structure (a private readiness gate, a lock wrapper, functions that never throw):
      - `proposeProjectMapContract({ root, capabilityId, contractId, title, digest, sessionId, now })` refuses an invalid `now` and a store that is not `ready`, runs under the store lock, refuses with `contract-exists` when the file already exists and leaves the bytes untouched, and otherwise writes the canonical record with `state: "proposed"`.
      - `decideProjectMapContract({ root, capabilityId, contractId, decision, rationale, sessionId, now })` refuses `contract-absent` when there is no file, `contract-already-decided` when a decision is already recorded — a decision is evidence and a second one may not overwrite the first — and otherwise rewrites the record with `state`, `decided_by`, `decided_at` and `rationale`, keeping every other field identical.
      - `readProjectMapContract({ root, capabilityId, contractId })` is lock-free and returns `{ contract, status, diagnostics }` with `free`, `proposed`, `accepted`, `rejected`, `corrupted` or `unreadable`; the status comes from the recorded state, never from comparing instants. Canonical bytes and both declared ids are verified against the requested pair, and a mismatch is `store-corrupted` at the offending path.
      - `listProjectMapContracts({ root, capabilityId, includeDecided })` enumerates only that capability's directory, sorts chronologically by `Date.parse(proposed_at)` with a code-unit `contract_id` tie-break — never `localeCompare`, the defect this unit fixed twice — excludes corrupt entries and reports them as `store-corrupted`.
    - **Three new diagnostic codes**: `contract-exists`, `contract-absent` and `contract-already-decided`. Unparsable, non-canonical or mismatched records reuse `unreadable-store` and `store-corrupted`; no existing code changes meaning.
    - **The store does not arbitrate who may decide**: `decideProjectMapContract` records the deciding session but never checks it against the lead. Enforcing "only the lead decides" is PM5-3's and PM5-4's job, where the lead claim is visible.
    - Tests, written first and watched fail: two contracts proposed for one capability and both readable by id; a second proposal of the same id refused with `contract-exists` and byte-identical storage; an accept that records state, decider, instant and rationale while keeping the proposal's own fields; a reject that does the same with the other state; a second decision refused with `contract-already-decided` and the first decision preserved byte-for-byte; a decision on an absent contract reporting `contract-absent`; a list that honours `includeDecided` and orders chronologically across mixed ISO offsets; a valid-but-non-canonical record, a mismatched capability id and a mismatched contract id each classified `corrupted`; a decision missing its rationale classified `corrupted` through the pairing rule; every operation on an uninitialized store refused with nothing written; and an adversarial capability id and contract id (`../` segments) landing inside `contracts/` with nothing outside it.
    - Evidence expectation: RED before GREEN, mutation probes on the exists-refusal, the already-decided refusal and the mismatch classifications, the four gates (focused, neighbours, full suite, `check-types`), independent verification and one native review.

- [ ] **PM5-2 — Apply an accepted contract to the approved map**
  - Design, fixed before the source write (2026-09-25):
    - **One bounded writer, one bounded field**: `lib/shell-project-map-contracts.ts` exports `applyProjectMapContract({ path, capabilityId, contractId, supersedes?, now })`, which reads `openspec/project-map.json`, requires `approval.state === "approved"`, requires the capability to exist, adds `contractId` to that capability's `contracts` array, optionally removes `supersedes`, re-validates the whole map with `validateProjectMap` and writes it through `writeProjectMapFile` — the single authorized writer. Nothing else in the artifact is touched: not the approval block, not capabilities, surfaces, dependencies or foundations, and no runtime field is ever added.
    - **Why this exists at all**: the user's decision gives the lead a direct write path for shared contracts, and the roadmap's own sentence assigns the lead ownership of the canonical map and shared contracts. Scoping it to `contracts` is what keeps the human's approval the gate for every boundary decision.
    - **A draft map is refused**: contracts are applied to an approved map only, because on a draft the human is still authoring and PM-2's `declare` and `approve` are the operations that matter. The refusal reuses the map vocabulary's `invalid-field` at `$.approval.state` rather than inventing a store code, since this is not a store record.
    - **Idempotent and honest about it**: applying an id that is already present writes nothing and returns `applied: false`; a `supersedes` id that is not present returns `removed: false`. Both are visible in the result instead of being silent no-ops, and the return carries the resulting map so the caller can report it.
    - **Deterministic artifact**: the array keeps its existing order and appends new ids, `supersedes` is removed wherever it appears, and applying the same set twice leaves the bytes identical. A test pins that.
    - **The caller is responsible for the evidence**: applying a contract is not a store operation, so this module does not write a record. The command layer (PM5-4) applies a contract only after the store holds its accepted decision, which is what makes the pair auditable.
    - Tests, written first and watched fail: applying an accepted id to an approved map adds exactly that id and leaves every other byte of the artifact identical; a second apply is a no-op reporting `applied: false` with identical bytes; `supersedes` removes the old id and adds the new one in one write; a draft map is refused and the file is untouched; an unknown capability is refused; an empty or whitespace-only contract id is refused; a map that fails validation is never written; and applying to a missing or corrupt artifact fails closed without creating anything.
    - Evidence expectation: RED before GREEN, mutation probes on the approval gate, the `supersedes` removal and the no-op path, the four gates, independent verification and one native review.

- [ ] **PM5-3 — Coordination projection**
  - Design, fixed before the source write (2026-09-25):
    - **Read-only, no authority, one exported reader**: `lib/project-map-coordination-state.ts` exports `PROJECT_MAP_LEAD_CAPABILITY_ID = "__lead"` and `readProjectMapCoordinationState({ root, mapPath, now, expectedGeneration? })`, which returns a projection and never writes. It mirrors `lib/sdd-status.ts`: the projection reports ground truth, and no caller may fabricate readiness from it.
    - **The lead is a claim, not a new record kind**: the projection reads the claim on the reserved id and reports `{ sessionId, lease: { renewal_after, renew_by }, status: "free" | "live" | "stale" }`. Split-brain is impossible while a lease is live (PM4-3 refuses to steal one), and a dead lead is recovered after 60 seconds with the `stale-claim-recovered` warning PM4-3 already emits, which the projection surfaces as a recorded fact rather than a silent takeover.
    - **Satellites**: every claim in `claims/` is projected with its capability, session and lease state. A claim whose capability is not declared in the map is a `unknown-capability` conflict; a claim on the reserved lead id is never reported as a satellite.
    - **The conflicts it can honestly detect, and the one it cannot**: `unknown-capability` (a claim the map does not declare), `undeclared-surfaces` (a claim on a capability whose surface list is empty — the advisory scope signal, because file-level enforcement needs PM-6's worktree-to-capability binding and pretending otherwise would be a lie), `unavailable-peer` (a live claim whose session has no fresh heartbeat), `reserved-capability-declared` (the map declaring `__lead` as a capability, which would make the reserved id ambiguous), and `stale-generation` (when the caller passes `expectedGeneration` and the descriptor has moved on). Each conflict carries the evidence that produced it: the capability id, the session id and the instant.
    - **`dependency-ready` and `completion` are derived, never stored**: a capability is dependency-ready when every id in its `dependsOn` exists in the map and is not `blocked` and has at least one readiness receipt; a capability is complete when it has a readiness receipt. Both are computed in the projection from the map plus `receipts/`, which is exactly the user's decision: durable state transitions are records, everything else is derived.
    - **Next safe action, bounded and never a delivery action**: each capability gets one of `claim`, `wait-for-dependency`, `resolve-blocker`, `decide-contract`, `integrate`, `done` or `blocked`, chosen from the projected facts in a documented order, and the projection never suggests commit, push, PR or merge.
    - **A corrupt store is a refusal, not an empty projection**: when the descriptor is not `ready` or a record is corrupt, the projection returns its diagnostics and marks the affected part unknown rather than reporting "no claims" — the fail-closed rule this store already follows.
    - Tests, written first and watched fail: a free store projects no lead and no satellites; a live lead claim projects its session and lease; a stale lead claim is reported as stale with its previous holder named; two capabilities claimed by two sessions both appear; an unknown capability claim is a conflict; a claim on a capability with empty surfaces is an `undeclared-surfaces` conflict; a claim whose session has no heartbeat is `unavailable-peer`; a map declaring `__lead` is `reserved-capability-declared`; a moved generation is `stale-generation` when expected; dependency readiness follows the map's `dependsOn` states plus receipts; completion follows a readiness receipt; every next-safe-action branch is reached by a fixture; a corrupt descriptor or corrupt claim yields diagnostics and unknown parts instead of an empty projection; and the projection writes nothing (the store bytes before and after are identical).
    - Evidence expectation: RED before GREEN, mutation probes on the lead resolution, the conflict branches and the fail-closed path, the four gates, independent verification and one native review.

- [ ] **PM5-4 — Command surface**
  - Design, fixed before the source write (2026-09-25):
    - **The smallest wiring that makes the protocol usable**: sub-actions on the existing `/gentle:project-map` command — `lead claim|renew|release|status` and `contract propose|accept|reject|list`. No new command, no new rendering: the card and inspector keep rendering what they render today.
    - **`lead claim` is the only way to become the lead**: it acquires the claim on `PROJECT_MAP_LEAD_CAPABILITY_ID` for the current session, `renew` refreshes it on the PM4-3 cadence, `release` gives it up, and `status` reads the projection. A second session's `claim` is refused with `claim-held` and says so in the user's words.
    - **Only the lead decides, and the command enforces it**: `contract accept` and `contract reject` first check the projection's lead state, require a live lead claim whose session is the caller's, and refuse with a clear message otherwise. This is the arbitration the store deliberately does not do.
    - **`contract accept` writes the map only after the decision is durable**: it records the accepted decision in the store first and applies it to the approved map second, so a failed map write leaves the durable decision intact and the user can retry the apply. `contract propose` takes the contract body's path and computes the `sha256:` digest of its bytes, so the human never types a digest.
    - **Refusals are the store's own codes**: the command reports `contract-exists`, `contract-absent`, `contract-already-decided`, `claim-held` and the map refusals by name, without inventing a parallel vocabulary.
    - Tests, written first and watched fail: a lead claim from one session and its refusal from another; accept refused when the caller is not the lead; accept recorded in the store and applied to the map; a rejected proposal never touches the map; propose refusing a missing contract body file; list showing proposed and decided contracts; release making the lead free; and every refusal surfaced with its store code.
    - Evidence expectation: RED before GREEN, mutation probes on the lead gate and the apply-after-decision order, the four gates, independent verification and one native review. If the slice measures over the review budget it is split into `lead` and `contract` halves before it is committed.

- [ ] **PM5-5 — Documentation and verification**
  - Document the protocol where a human meets it: the roadmap pointer, the command usage, what a satellite may and may not do, and how the lead's bounded write path interacts with the human's approval.
  - Verify the unit: the acceptance criteria below, the full suite, the type gate, and a written record of what was verified versus what was not.

## Acceptance criteria

- A shared-contract proposal is a canonical durable record with a digest of its body, and a decided proposal is never overwritten.
- A second decision on the same contract is refused and the first decision survives byte-for-byte.
- The lead is a claim on a reserved capability id: a second lead is refused while a lease is live, and a stale lead is recovered with a visible warning.
- Only the session holding the lead claim can accept or reject a contract, and that check lives in the command and the projection, never in the store.
- An accepted contract reaches the versioned map through a write that touches only that capability's `contracts` array; the approval block, capabilities, surfaces, dependencies and foundations are byte-identical before and after.
- A draft map is refused, and the artifact is never written when validation fails.
- The coordination projection reports lead, satellites, the five detectable conflicts, dependency readiness, completion and a next safe action, writes nothing, and reports corrupt state as unknown instead of empty.
- `dependency-ready` and `completion` are derived from the map and the receipts; no journal duplicates the store.
- No runtime field ever enters the versioned map, and nothing in PM-5 grants commit, push, PR, merge or release authority.
- The transport stays a signal path: no coordination fact exists only in a notification.

## Review workload forecast

Estimates: PM5-1 ≈ 350 lines (the store module plus its tests, the new record kind and three codes), PM5-2 ≈ 220, PM5-3 ≈ 350, PM5-4 ≈ 300, PM5-5 ≈ 150. Every slice stays under the 400-line review budget, and each is delivered as its own commit and its own native review. If a slice measures over budget, it is split before it is committed rather than after.

## Progress

- 2026-09-25: unit planned after a read-only surface map (what PM-4 already gives, what the versioned map does and does not model — `contracts` is still an unresolved `string[]` — the PM-2 approval lifecycle and its single authorized writer, the two notification transports and their zero durability, and the card's hardcoded `Runtime overlay: unavailable`). The user settled the four open product decisions and, in a follow-up, scoped the lead's direct write to the `contracts` array of an already approved map. Nothing has been implemented yet; PM5-1 is the next work unit.

## Next decision

PM5-1 (contract proposals in the store) is the next work unit and is authorized by this plan; its design is frozen above and it starts with the tests written first. Then PM5-2 (the bounded map write), PM5-3 (the coordination projection), PM5-4 (the command surface) and PM5-5 (documentation and verification), which closes the unit. After PM-5, the roadmap continues with PM-6 through PM-9.

One consequence of the user's decision is worth stating where a later reader will find it: the lead now has a write path into the versioned artifact, scoped to `contracts`. If that ever needs to be narrowed or widened, the place to change is `applyProjectMapContract` and the acceptance criteria above, and the change is a product decision rather than a bug fix.
