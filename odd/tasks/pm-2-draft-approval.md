# PM-2 — Draft generation and human plan approval

## Objective
Turn the versioned Project Map from a contract nobody can fill into one a project can actually obtain: generate a draft map deterministically from repository context, let the human correct and explicitly approve it, and persist both transitions so that approval is auditable and grants plan authority only.

This is the second work unit of the initiative roadmap recorded in `odd/tasks/project-map-orchestration.md`. It builds on PM-1's schema and validator, and it replaces nothing.

## Problem
PM-1 defined the shape of an approved map and the diagnostics that reject a bad one, but nothing can produce a map. `openspec/project-map.json` is defined and unpopulated. A human would have to hand-write a large JSON artifact whose validation rules are only discoverable by failing them, and nothing records whether the resulting map was ever reviewed or who approved it.

## Why
The roadmap's first acceptance criterion is that a new project can receive a draft capability map from a high-level product idea and correct it before approval. Without a generator, the map only ever exists for projects that already had one. Without a persisted approval transition, "approved" is an assertion no one can audit, and the roadmap's exclusion that "map approval grants implementation authority" cannot be demonstrated at all.

## Decisions (approved by the user)
- **Approval state lives in the versioned artifact.** A top-level `approval` block on `ProjectMapV1`, not a companion file. The roadmap already assigns "approval state" to the versioned definition; PM-1 simply omitted it. One artifact stays diffable and cannot drift from the map it describes.
- **Draft generation is deterministic.** It reads only structured sources and reports what it could not determine as explicit omissions. No model call, so the generator is reproducible and pinnable under strict TDD. The roadmap excludes treating inferred progress as truth; a heuristic extractor that invents coverage would violate that.
- **The human enters through a library API plus a command.** `/gentle:project-map` with validated sub-actions, following the `gentle:review-mode` precedent. The interactive card belongs to PM-3 and is not pulled forward.
- **`surfaces` is relaxed for drafts and required for approval.** `surfaces: []` is valid only while `approval.state === "draft"`; an approved map requires a non-empty surface list on every capability. A deterministic extractor cannot infer seven-surface coverage from structured sources, and inventing it is forbidden. Completeness is therefore enforced at the moment that matters — approval — instead of being faked earlier. This amends PM-1's unconditional non-empty rule (`lib/shell-project-map-schema.ts:255`) and is the only PM-1 invariant this unit changes.

## Scope
- The `approval` contract: state vocabulary, required audit fields, fail-safe default, canonical position, and validation.
- The exported artifact path constant, which PM-1 documented but never exported.
- Deterministic draft generation from structured repository sources, with an explicit assumptions and omissions report.
- The approval transition and atomic persistence of the artifact.
- The `/gentle:project-map` command surface with `draft`, `approve`, and `status`.
- Documentation of the draft and approval lifecycle.

## Non-goals
- Rendering, the shell card, the capability inspector, or any TUI presentation (PM-3).
- Claims, leases, heartbeats, blockers, or the shared runtime store (PM-4).
- Any model-assisted or subagent-driven generation.
- Any source mutation, worktree provisioning, or writer startup as a consequence of approval.
- Commit, push, PR, or release.

## Constraints
- TDD mode: strict (`openspec/config.yaml` declares `strict_tdd: true`); runner `node --experimental-strip-types --test tests/<file>.test.ts`.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons.
- No new runtime dependency. In particular, `openspec/config.yaml` must be read without a YAML library, so only simple top-level `key: value` lines may be interpreted; anything else becomes an omission.
- Reuse PM-1's existing diagnostic codes (`MISSING_FIELD`, `INVALID_FIELD`, `UNKNOWN_FIELD`) rather than inventing new ones.
- Single writer; no parallel writes.
- `pnpm` and `node_modules` are absent in this worktree, so the full suite and the typecheck gate cannot run here; focused `node --test` runs and an explicit limitation note are the substitute evidence.

## Authorized edit surfaces
- `odd/tasks/pm-2-draft-approval.md`
- `lib/shell-project-map-schema.ts`
- `tests/shell-project-map-schema.test.ts`
- `lib/shell-project-map-draft.ts` (new)
- `tests/shell-project-map-draft.test.ts` (new)
- `lib/shell-project-map-approval.ts` (new)
- `tests/shell-project-map-approval.test.ts` (new)
- `extensions/gentle-project-map.ts` (new)
- `tests/gentle-project-map.test.ts` (new)
- `docs/project-map.md`

Verified as not required: `package.json` declares `pi.extensions: ["./extensions"]`, so the new extension is discovered without a registration list, and `scripts/verify-package-files.mjs` enforces presence of a minimum set rather than rejecting unlisted files outside `contracts/`. Registering the new extension in `scripts/test-packed-runner.mjs` is a coverage improvement, not a requirement, and is deferred to PM-2e as a decision.

## Contract addition

```text
approval?: {
  state: "draft" | "approved"
  approvedAt?: string   // ISO-8601 instant, required when state === "approved"
  approvedBy?: string   // non-empty actor identity, required when state === "approved"
}
```

- Absent `approval` defaults to `{ "state": "draft" }`. The default is fail-safe: a map is never approved by omission.
- `state: "approved"` without a valid `approvedAt` or a non-empty `approvedBy` is an error (`MISSING_FIELD`).
- `state: "draft"` carrying `approvedAt` or `approvedBy` is an error (`INVALID_FIELD`): an approval record on a draft is self-contradictory.
- Canonical key order becomes `version`, `project`, `approval`, `foundations`, `capabilities`.
- `PROJECT_MAP_ARTIFACT_PATH = "openspec/project-map.json"` is exported from the schema module as the single source of truth for the location.

## Tasks

- [ ] **PM2-1 — Approval contract in the versioned map**
  - Export the approval state vocabulary, the `ProjectMapApprovalV1` type, and `PROJECT_MAP_ARTIFACT_PATH`.
  - Add `approval` to `ProjectMapV1`, `canonicalizeProjectMap`, and `serializeProjectMap` in canonical position, with the fail-safe `draft` default.
  - Reject an approved map without audit fields, and a draft carrying them, with exact `$`-rooted paths.
  - Relax `surfaces` to allow an empty list only while `approval.state === "draft"`; require a non-empty list on every capability once approved.
  - Pin the amendment in the existing schema test file so the previous unconditional rule cannot silently return.

- [ ] **PM2-2 — Deterministic draft generation from structured sources**
  - Read `package.json` and `openspec/config.yaml`, interpreting only the simple top-level `key: value` lines of the latter.
  - Assemble a `ProjectMapV1` that is always `approval.state === "draft"`, with capabilities as `planned` unless structured evidence says otherwise.
  - Return `{ map, assumptions, omissions }`, where omissions name every source that could not be interpreted and every required field the generator could not fill.
  - Guarantee determinism: identical input produces byte-identical serialized output.

- [ ] **PM2-3 — ODD work-unit extraction**
  - Extract capability candidates from the roadmap's `- [ ] **PM-N — Title**` work units and from `odd/tasks/*.md` headings.
  - Map a checked box to `done` and an unchecked box to `planned`, and record the mapping as an assumption rather than as verified progress.
  - Resolve `featureDocs` against the repository and report a missing document as an omission rather than as a fatal diagnostic.
  - Report every prose-only source that cannot be interpreted as an explicit omission.

- [ ] **PM2-4 — Approval transition and atomic persistence**
  - Implement the `draft` to `approved` transition with injected actor identity and timestamp, refusing an already-approved map, an invalid map, and an incomplete surface list.
  - Persist through `serializeProjectMap` and `writeJsonFileAtomicallySync` (`lib/agent-profiles.ts:521`); never write a partial artifact.
  - Prove that approval touches exactly one path — the artifact — and starts no writer, worktree, or source mutation.
  - Fail closed: a write failure leaves the previous artifact intact and reports the failure instead of claiming approval.

- [ ] **PM2-5 — Command surface**
  - Register `/gentle:project-map` with validated sub-actions `draft`, `approve`, and `status`; reject an unknown sub-action by listing the valid ones.
  - Show capabilities, coverage, assumptions, and omissions before asking for confirmation, and write only after an explicit confirmation.
  - Report a declined confirmation and a failed write honestly; never claim a transition that did not happen.
  - Cover the handler with a mocked `ExtensionContext`; never instantiate the interactive TUI.

- [ ] **PM2-6 — Documentation and verification**
  - Document the approval block, the draft and approved lifecycles, the artifact path constant, and the assumptions and omissions report in `docs/project-map.md`.
  - Focused test files green; full suite and typecheck attempted and their unavailability recorded honestly.

## Acceptance criteria
- A map without an `approval` block validates and canonicalizes to `{ "state": "draft" }`.
- An approved map without `approvedAt` or `approvedBy` is rejected with `MISSING_FIELD` at the exact path; a draft carrying either is rejected with `INVALID_FIELD`.
- A capability with an empty surface list validates while the map is a draft and is rejected once the map is approved.
- Canonical serialization places `approval` between `project` and `foundations`, and the same logical map always produces the same bytes.
- Draft generation from fixed input is deterministic and reports every uninterpretable source as an omission rather than guessing.
- A generated draft never marks a capability `done` without structured evidence.
- Approval refuses an incomplete or already-approved map, writes exactly one path, and leaves the previous artifact intact on failure.
- No code path in this unit mutates a source file, creates a worktree, or starts a writer.
- `/gentle:project-map` with an unknown sub-action lists the valid ones and writes nothing.
- Validation never throws on malformed input; it returns diagnostics.

## Review workload forecast
Measured correction-round estimates: PM-2a ≈ 200 lines (schema and its tests), PM-2b ≈ 330, PM-2c ≈ 250, PM-2d ≈ 300, PM-2e ≈ 330, documentation ≈ 90. The unit total exceeds the 400-line review budget by a wide margin, so it is implemented and reviewed as five separate work-unit commits, each reporting its own measured diff size. A stage that measures over 400 lines is split further rather than merged into its neighbour.

## Progress
- 2026-09-23: Unit planned after read-only exploration of PM-1's public API, the repository's existing approval and human-intent patterns, the available draft-generation sources, the extension test conventions, and the packaging constraints. Decisions on approval location, generation strategy, entry surface, and the `surfaces` invariant accepted by the user as recommended. Task document created before the first source write. PM2-1 through PM2-6 pending.
- 2026-09-23: PM2-1 delivered the approval contract (244 changed lines). Reviewed as lineage `review-d3c7ecbb0f8ad658`, approved and acknowledged with zero correction rounds. One informational finding, `R3-invalid-calendar-date`, reports that the ISO-8601 check accepts rolled-over calendar dates such as `2026-02-30` because `Date.parse` normalizes them; it is non-blocking and is deferred to a follow-up commit.
- 2026-09-23: PM2-2 delivered deterministic draft generation from structured sources. **Deviation from the plan:** `openspec/changes/*/state.yaml` was dropped as an input. Only 2 of 16 changes carry that file, and its content is a process ledger of SDD phases (`proposal` through `archive`), not product capability state, so mapping it to capabilities would invent meaning the source does not carry. Capabilities therefore arrive with PM2-3 or from the human, and the generator reports the gap as an omission.

## Next decision
Implementation of PM2-1 may begin. Commit, push, and PR remain separate decisions and require explicit authorization; native review remains a separate user-owned choice.
