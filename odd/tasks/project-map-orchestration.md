# Project Map Orchestration

## Outcome
Make the whole product continuously visible and operable from Gentle Shell, so users can understand what exists, what is missing, what is blocked, who owns each capability, and which capability can safely start next without reconstructing the project from feature documents or backend-centric task lists.

The Project Map becomes the persistent project-level surface directly below Status. It organizes delivery around vertical product capabilities while showing the Product/UX, Web, API, Data, Security, Operations, and Tests coverage of each capability.

## Primary experience

```text
PROJECT MAP · Example Shop                    6/12

Foundations
✓ Repository and environments
✓ Authentication and merchant authority
◉ Deployment and observability        review

Product capabilities
✓ Merchant invitations       Web · API · DB
◉ Merchant catalog           Web · API · DB    session-42
○ Shopping cart              Web               ready     [Open Pi]
○ Checkout and orders        Web · API · DB    blocked
○ Payments                   Web · API · DB    planned
○ Admin dashboard            Web · API         ready     [Open Pi]

Coverage
Product/UX  45%   Web 35%   API 70%   Data 75%   Ops 25%
```

The actual fullscreen hierarchy is:

```text
Status → Project Map → Agents → TODO
```

`Changes` remains a group inside the unified Status card.

The map is not a post-hoc report. It is the user's project navigation surface:

- selecting a capability reveals its outcome, dependencies, coverage checklist, owner/session, branch/worktree, blockers, contracts, and available next action;
- `[Open Pi]` appears only when a capability is ready and the user explicitly chooses to start isolated work;
- global coverage exposes horizontal imbalance, especially backend/API progress that is not matched by UX, operations, or quality work;
- plan approval approves the map only and never grants implicit source-write, review, delivery, merge, worktree deletion, or destructive authority.

## Problem

Gentle Shell currently shows the active session, captured changes, agents, and task-level TODOs. Those surfaces explain current execution but do not answer project-level questions:

- Which user-facing capabilities make up the product?
- Which foundations and dependencies enable them?
- Which capabilities are done, active, ready, blocked, or merely planned?
- Which technical surfaces does each capability require?
- Is implementation drifting toward one layer while the product remains incomplete?
- Which branch, worktree, and Pi session owns active work?
- Which capability can start in parallel without crossing another writer's scope?

This gap encourages local optimization: an orchestrator can make sustained backend progress while the user loses sight of frontend, UX, operations, deployment, and end-to-end readiness.

## Product decisions

| Area | Decision |
|---|---|
| Planning unit | Vertical product capability, not frontend/backend/database workstreams. |
| Coverage | Product/UX, Web, API, Data, Security, Operations, Tests. |
| Project initialization | Gentle proposes a draft map; the human corrects and approves it before capability execution. |
| Shell placement | A dedicated Project Map card below Status and above Agents/TODO. |
| Authority | One lead orchestrator owns the canonical map, contested boundaries, shared contracts, and integration order. |
| Parallel work | One branch and Git worktree per active capability; never parallel writers in one worktree. |
| Satellites | A satellite orchestrator claims one capability, works within its approved surfaces, proposes shared-contract changes, and reports durable state. |
| Versioned state | Human-reviewed capabilities, dependencies, and coverage declarations live in repository artifacts. |
| Runtime state | Claims, leases, heartbeats, session bindings, and transient blockers live in shared cross-worktree storage under the canonical Git common directory. |
| Open Pi | Explicit user action; provisions or selects an isolated worktree and opens Pi there. Unsupported terminals fall back only through a visible user choice. |
| Integration | The queue orders and verifies readiness; it never authorizes commit, push, PR creation, or merge. |
| Cleanup | Disabling the feature leaves branches/worktrees intact. Cleanup checks dirty state and requires human authorization whenever data may be lost. |

## Current evidence

### Public proposal

- Issue: `Gentleman-Programming/gentle-shell#1257`.
- Public scope is intentionally limited to the visual, session-only preview.
- The issue does not authorize the full initiative described here.

### Visual proof of concept

A separate worktree contains a completed but uncommitted visual prototype:

- Branch: `feat/project-map-visual-demo`.
- Worktree: `/home/facundo/projects/gentle-pi-worktrees/project-map-visual-demo`.
- Command: `/gentle:project-map` toggles the static preview for the current session.
- Default: off; no persistence or functional actions.
- Verification: focused 21/21, related shell 93/93, full suite 2,626 passed/38 skipped, provider contract/runtime harness passed, independent verification passed, native reliability review approved.
- The prototype validates placement, card language, wrapping, session isolation, and visual comprehension only. It is not authority for later phases.

### Planning artifacts

- Canonical SDD exploration/proposal context: `openspec/changes/project-map-orchestration/`.
- This ODD document is the initiative execution map. It supersedes outdated shell-order wording in earlier drafts: `Changes` is inside Status.

## Scope

### Included

- Versioned Project Map definition and validation.
- Draft generation and explicit human approval lifecycle.
- Capability dependencies and seven-surface coverage model.
- Project Map card, detail inspector, filtering/grouping, and live overlays.
- Shared runtime coordination store across linked worktrees.
- Lead/satellite claims, leases, heartbeats, blockers, and contract negotiation.
- Safe branch/worktree provisioning and lifecycle inspection.
- Cross-platform Open Pi launcher with an explicit fallback choice.
- Integration-readiness ordering and verification without delivery authority.
- Documentation, migration, observability, rollback, and end-to-end coverage.

### Excluded

- Autonomous commits, pushes, PRs, merges, releases, or destructive cleanup.
- Multiple writers in one worktree.
- Automatic AST merge-conflict resolution.
- A custom terminal emulator.
- Treating progress percentages as inferred truth without structured evidence.
- Allowing map approval to grant implementation authority.
- Shipping the entire initiative in one PR or one unbounded implementation task.

## Architecture boundaries

### Versioned definition

The repository-owned map describes durable product intent:

- capability ID and outcome;
- foundations and dependencies;
- required coverage surfaces;
- approval state;
- accepted shared contracts;
- feature-document references.

It must be reviewable, diffable, deterministic, and free from ephemeral process state.

### Shared runtime overlay

The Git common directory owns cross-worktree process state:

- lead identity and generation;
- capability claims and leases;
- heartbeat timestamps;
- active session/worktree/branch bindings;
- transient blockers;
- pending contract proposals;
- readiness receipts.

Runtime records must use atomic writes, stale-owner recovery, bounded history, schema validation, and canonical repository identity. They must not silently modify the versioned map.

### Authority model

- The human approves the initial map and all consequential product/boundary decisions.
- The lead coordinates; it does not acquire delivery authority.
- Satellites can propose but cannot unilaterally rewrite shared contracts or another capability's scope.
- A claim grants bounded capability ownership, not repository-wide write access.
- Review evidence remains separate from commit/push/merge decisions.

## Dependency graph

```text
PM-1 Map schema ───────┬──→ PM-2 Draft approval lifecycle
                       └──→ PM-3 Dynamic map + inspector

PM-4 Coordination store ─→ PM-5 Lead/satellite protocol

PM-1 + PM-4 ─────────────→ PM-6 Worktree lifecycle
PM-5 + PM-6 ─────────────→ PM-7 Open Pi launcher
PM-2 + PM-3 + PM-5 ──────→ PM-8 Integration readiness
PM-1..PM-8 ──────────────→ PM-9 Rollout and end-to-end verification
```

## Work units

- [x] **PM-1 — Define and validate the versioned Project Map**
  - Specify capability IDs, outcomes, foundations, dependencies, coverage surfaces, lifecycle states, and feature-document references.
  - Add deterministic parsing, validation, cycle detection, unknown-reference handling, and schema-version behavior.
  - Keep runtime ownership and session fields out of the versioned definition.
  - Provide migration-safe defaults and actionable validation errors.

- [x] **PM-2 — Add draft generation and human plan approval**
  - Generate a draft map from project context without beginning implementation.
  - Present capabilities, dependencies, coverage, assumptions, and omissions for correction.
  - Persist explicit `draft`/`approved` transitions with auditable human intent.
  - Prove that approval grants plan authority only and does not start writers or mutate source.

- [x] **PM-3 — Render the real map and capability inspector**
  - Replace static demo data with the approved versioned definition plus read-only runtime overlay.
  - Preserve `Status → Project Map → Agents → TODO`, width safety, narrow-mode behavior, and independent render digests.
  - Add row selection, grouping/collapse, viewport behavior, coverage explanations, empty/error states, and capability details.
  - Keep actions hidden or disabled unless their own dependencies and authority are available.

- [ ] **PM-4 — Build the shared cross-worktree coordination store**
  - Resolve canonical Git common-directory identity and store runtime state there.
  - Implement schemas, atomic compare/update behavior, generation counters, bounded history, and corruption refusal.
  - Model claims, leases, heartbeats, session bindings, blockers, and readiness receipts.
  - Cover crash recovery, stale leases, sibling worktrees, unrelated repositories, reload, and process exit.

- [ ] **PM-5 — Establish lead/satellite coordination contracts**
  - Define typed events for claim, release, heartbeat, dependency-ready, blocker, contract proposal/acceptance/rejection, and completion.
  - Make the lead the arbiter of map boundaries and shared contracts without creating a delivery authority.
  - Preserve notification+ACK transport as a signal path while durable state remains the source of coordination truth.
  - Detect split-brain leaders, conflicting claims, stale generations, unauthorized scope changes, and unavailable peers.

- [ ] **PM-6 — Provision and manage capability worktrees safely**
  - Derive branch/worktree identity from approved capability IDs.
  - Validate same-clone roots, existing branches, dirty state, collisions, nested repositories, and already-running sessions.
  - Register worktrees with the coordinating Pi session and bind them to claims.
  - Never delete or rewrite worktrees automatically; inspect and request explicit human authorization for risky cleanup.

- [ ] **PM-7 — Implement the explicit Open Pi flow**
  - Show `[Open Pi]` only for capabilities whose dependencies and ownership state permit startup.
  - Open Pi in the capability worktree through bounded host adapters (tmux and supported terminal emulators).
  - Pass a structured handoff: objective, approved surfaces, dependencies, contracts, feature document, parent session, and verification requirements.
  - Offer background-subagent fallback as a visible user choice, never as a silent behavior change.
  - Report launch uncertainty honestly; process spawn or transport ACK does not prove work began.

- [ ] **PM-8 — Add integration-readiness sequencing**
  - Order candidates by dependency and accepted shared-contract state.
  - Verify coverage, tests, map/task consistency, branch freshness, unresolved blockers, and review evidence.
  - Detect likely merge conflicts early without pretending to resolve them automatically.
  - Present the next safe integration action while leaving commit, push, PR, and merge to ordinary repository policy.

- [ ] **PM-9 — Roll out, migrate, document, and verify end to end**
  - Gate the functional system behind an explicit opt-in until schemas and recovery behavior stabilize.
  - Migrate or initialize projects without destroying existing ODD/OpenSpec artifacts.
  - Document project initialization, map review, parallel capability work, failure recovery, disabling, and cleanup.
  - Exercise multi-session/worktree E2E scenarios on Linux, macOS, Windows, tmux, headless fallback, crash recovery, and stale-state cleanup.
  - Verify observability, rollback, package contents, compatibility, and complete suite behavior.

## Working base

All PM units are developed on top of the released tag **v3.7.0** (`59257bff`), never on a moving `main` and never on an older release. `main` runs ahead of the tag with unreleased work, so it is not a stable base; older tags would force new code to target shell surfaces that have already changed.

The tag is the base for the branch, not a ceiling on upstream work: when a newer release is published and a unit needs it, the base moves by rebase before that unit starts, never in the middle of one.

## Per-unit delivery rules

Every PM unit is independently planned before implementation:

1. Explore the exact existing surfaces and freeze a narrow edit boundary.
2. Use strict TDD with the repository-declared runner.
3. Keep one writer per worktree.
4. Keep behavior, tests, and documentation in the same work unit.
5. Forecast changed lines before implementation; split honestly when a unit exceeds the review budget.
6. Run focused checks, type validation, full tests when practical, independent verification, and native review when enabled.
7. Record commit identity only after the user authorizes commit; push and PR remain separate decisions.

A PM identifier is a roadmap unit, not permission to implement all files implied by its description. Each unit may require smaller ODD tasks after exploration.

## Acceptance criteria for the full initiative

- A new project can receive a draft capability map from a high-level product idea and correct it before approval.
- The approved map keeps foundations, vertical capabilities, dependencies, coverage, and progress visible below Status.
- Users can identify done, active, review, ready, blocked, and planned capabilities without reconstructing feature documents.
- Coverage cannot claim completion without structured evidence and clearly explains unknown or partial values.
- Two sessions cannot hold conflicting capability claims in the same repository generation.
- A crashed or stale session can be recovered without silently stealing live work or discarding user changes.
- A ready capability can open an isolated Pi session with a bounded, inspectable handoff.
- Satellites can negotiate shared contracts without independently changing global boundaries.
- Integration readiness is ordered and evidenced, but never treated as delivery authorization.
- Disabling Project Map preserves branches, worktrees, versioned artifacts, and ordinary Gentle Shell behavior.
- All destructive operations remain explicit, scoped, and human-controlled.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Initial map overwhelms users | Draft high-level milestones first; use progressive disclosure and explicit approval. |
| Coverage becomes decorative or stale | Derive it from structured surface checklists and lifecycle evidence; show unknown rather than inventing percentages. |
| Map and feature tasks drift | Reconcile at task transitions and integration readiness; expose mismatches instead of silently overwriting either source. |
| Concurrent leaders create split brain | Canonical repository identity, generation/CAS checks, leases, and explicit reconciliation. |
| Worktrees diverge and conflict late | Shared contracts, dependency ordering, early freshness/conflict checks, and small work units. |
| Terminal launch differs across hosts | Adapter contract, capability detection, visible fallback choice, and platform-specific tests. |
| Runtime state corrupts or outlives sessions | Atomic writes, schema validation, bounded history, heartbeats, stale recovery, and fail-closed reads. |
| Plan approval is mistaken for execution consent | Separate state transitions and UI language; every source-mutating action keeps its own authority gate. |
| One roadmap becomes an oversized PR | One reviewable work unit/PR slice at a time; no monolithic implementation. |

## Rollback

- The static preview and functional system remain opt-in until mature.
- Disabling Project Map removes its UI/runtime behavior but does not delete the versioned map, branches, worktrees, commits, stashes, or review records.
- Runtime-store schema upgrades require backward-readable metadata or an explicit refusal; no silent destructive migration.
- Each PM work unit must be independently revertible without undoing unrelated completed capabilities.
- Worktree cleanup is never part of automatic rollback.

## Progress

- 2026-09-20: Full Product Map concept approved by the user for ODD planning.
- 2026-09-20: Public issue #1257 reframed to request only the visual preview.
- 2026-09-20: Static session-only visual proof of concept completed and verified in a separate worktree; uncommitted and unpublished.
- 2026-09-23: PM-1 completed and closed in `odd/tasks/pm-1-project-map-schema.md`. Work units: `8a346388` (versioned schema and validation, 1,316 insertions), `99f80c9f` (Windows drive-relative feature-document rejection, 23 insertions), `8fa6809f` (commit recording). Native review lineages `review-92fd0478df63a3b3` and `review-f521cbedc02977eb` closed approved and acknowledged. Branch `feat/project-map-orchestration` is pushed to the fork; no pull request exists against upstream.
- 2026-09-23: PM-1 delivered `lib/shell-project-map-schema.ts`, `tests/shell-project-map-schema.test.ts`, and `docs/project-map.md`. The artifact location `openspec/project-map.json` is defined but not yet populated; population belongs to PM-2.
- 2026-09-23: The branch was rebased from its original base v3.1.0 (`459f4fe2`) onto the stable tag v3.7.0 (`59257bff`), 151 commits and 6 releases forward. All five commits were rewritten: `8a346388 99f80c9f 8fa6809f 210f9350 aa9732df` became `0706cd39 2b8515bb 2667fe67 56f9476b b9ec3b0e`. The stable `patch-id` is identical before and after (`b3086602836874c428d104323c02a61ddcc00aea`), so the move changed the base and nothing else. The pre-rebase history survives only in the local branch `backup/project-map-pre-v370`.
- 2026-09-23: The rebased branch is one reviewed candidate: lineage `review-ad14ab396d7b9c21` over base-ref `59257bff`, tier `medium`, one `review-reliability` lens, 2,166 lines, zero correction rounds, approved and acknowledged. The two PM-1 lineages above are invalidated by the base move alone; they no longer apply to any reachable commit.
- 2026-09-23: PM-2 closed in `odd/tasks/pm-2-draft-approval.md`: draft generation, the human approval lifecycle, atomic persistence and the `/gentle:project-map` command surface, with one documented workflow gap — a generated draft declares no surfaces, so approval cannot succeed until they are declared. PM-3 closed the gap rather than leaving it.
- 2026-09-24: PM-3 closed in `odd/tasks/pm-3-render-and-inspector.md` across five independently reviewed stages: PM3-1a/1b (card core, composition, rail slot, descriptor digest, narrow mode), PM3-2 (coverage explanations, grouping, collapse), PM3-3 (row selection, inspector, reveal), PM3-4 (interactive surface declaration, which closes PM-2's gap) and PM3-5 (documentation and verification of the unit). PM-4 through PM-9 remain unstarted and require independent authorization and task planning.

## Next decision

PM-3 is closed and **PM-4 — Build the shared cross-worktree coordination store** is the next unit in the dependency graph. It still requires its own authorization, exploration, and task document; none of that is implied by PM-3's closure, and PM-5 through PM-9 remain behind it.

Two open items outside the unit chain belong to the user. The branch through PM-3 is complete but unpublished over the stable tag v3.7.0: push is a separate decision, and a pull request against upstream is blocked until a maintainer applies `status:approved` to issue #1396, with the chained-PR strategy still unchosen.

PM3-5 recorded two test-coverage gaps it was not authorized to fix (the invalid card's three-diagnostic ceiling and the narrow-mode bottom for an empty or invalid artifact). They are informational and unowned; the user decides whether they deserve a small follow-up work unit.

Maintainer feedback on the visual preview issue is still pending: issue #1257 is open with no comments.
