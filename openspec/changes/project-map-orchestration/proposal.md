# Proposal: Project Map Orchestration & Multi-Worktree Capability System

## Problem & Current-State Gap

When developers use `gentle-pi` on multi-faceted projects, the harness lacks an end-to-end project-level architecture map. Currently:
1. **No Project Map in Shell:** Gentle Shell presents Status, Captured Changes, and TODO cards, but lacks a global map of project capabilities, their dependencies, or their coverage completeness across domains.
2. **Horizontal Drift & Invisible Surfaces:** In broad greenfield projects, planning and execution drift toward whichever surface is worked on first (such as backend/API), leaving frontend, UX, operations, data migration, security, and tests out of sight until integration breakdowns occur.
3. **Transient Orchestration Transport:** Existing orchestrator communication (`orchestrator_session_id`, `orchestrator_list`, and `orchestrator_send_message`) operates strictly as ephemeral local-profile notification-and-ACK transport. It offers no offline queue, retries, broadcast, durable capability claims, dependency queries, contract proposal/acceptance, or verifiable completion guarantees.
4. **Isolated Subagents vs. Real Worktrees:** While `subagent_run.workspace_root` can run a single child subagent in a given worktree and `/gentle:changes` can display dirty worktrees, there is no cohesive system to launch interactive Pi terminals in isolated Git capability worktrees, track live capability ownership across linked worktrees, or coordinate changes safely.

---

## Primary User Experience: The Project Map

The primary operational interface in Gentle Shell places the Project Map prominently between real-time session status and underlying change tracking:

$$\text{Shell Layout Order: } \mathbf{Status} \rightarrow \mathbf{Project\ Map} \rightarrow \mathbf{Changes} \rightarrow \mathbf{TODO}$$

The Project Map is not merely a static status report or post-hoc dashboard; it is the operator's persistent navigation and execution surface for the entire project lifecycle.

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
*(Progress Note: The `6/12` header indicator is an illustrative project milestone progress summary showing overall capability completion across all 12 items in the project, while the rows above represent the active viewport/scrollable slice of the full map.)*

### Visual Breakdown & Operating Semantics

1. **Foundations:** Dedicated category for enabling project-level infrastructure and prerequisites (e.g., repository tooling, CI/CD, base environment setups, core merchant authentication). Foundations enable multiple product capabilities rather than delivering single isolated end-user features.
2. **Product Capabilities:** Vertical slices of end-to-end user value (e.g., Merchant catalog, Shopping cart, Payments) rather than horizontal architectural layers.
3. **Surface Tags (`Web · API · DB`):** Clear indicators revealing exactly which architecture surfaces a capability spans, making cross-surface scope visible at a glance.
4. **Status & Ownership Tokens:** Distinct icons and state labels show exact capability lifecycle state:
   - `✓` **Done:** Verified and integrated capability.
   - `◉` **Active / Review:** In progress under an active satellite session (e.g., `session-42`) or awaiting integration review (`review`).
   - `○` **Ready / Blocked / Planned:** Not yet executing; explicitly indicates whether dependencies are satisfied (`ready`), unresolved (`blocked`), or scheduled for subsequent iterations (`planned`).
5. **Interactive Launch Action (`[Open Pi]`):** Appears strictly on capabilities in the `ready` state. Selecting `[Open Pi]` triggers the isolated Git worktree provisioning and interactive session flow. Invoking `[Open Pi]` is an explicit operator action; approving the Project Map plan does not grant implicit mutation or execution authority.
6. **Global Coverage Rollup:** Cross-cutting percentage metrics across Product/UX, Web, API, Data, Security, and Operations. These rollups immediately expose system-wide delivery imbalance and prevent backend/API tunnel vision where server implementation races ahead of user experience and operational infrastructure.
7. **Detail Drill-Down on Row Selection:** Selecting or focusing any capability row opens a detailed inspector pane containing:
   - **Target Outcome:** User value summary and acceptance scope.
   - **Dependencies:** Prerequisite and downstream capability relationships.
   - **Coverage Checklist:** 7-dimension status breakdown (Product/UX, Web, API, Data, Security, Operations, Tests).
   - **Owner / Session:** Active session identifier and claiming orchestrator.
   - **Branch & Worktree:** Dedicated Git branch and worktree directory path.
   - **Blockers & Contracts:** Unresolved contracts, missing dependencies, or boundary disputes.
   - **Next Available Action:** Contextual options (e.g., launch `[Open Pi]`, view diff, review contract, inspect integration readiness).
8. **Layered Versioned & Live State:** The visible map overlays the versioned, human-reviewed capability definitions (stored in repository source control) with live, dynamic runtime state (claims, leases, heartbeats, active sessions, and transient blockers) queried from the cross-worktree shared coordination store.

---

## Product Outcome & Intent

Introduce **Project Map Orchestration**, a cohesive capability-driven coordination system for Gentle AI.

Instead of horizontal technical silos or ephemeral agent pings:
- **Vertical Product Capabilities:** Work is organized into end-to-end vertical product capabilities (e.g., "User Authentication", "Order Checkout", "Catalog Search").
- **Cross-Surface Coverage Matrix:** Each capability tracks explicit coverage across core dimensions: Product/UX, Web, API, Data, Security, Operations, and Tests.
- **Draft + Human Approval Workflow:** When initiating a new project or major milestone, Gentle analyzes the project and proposes a draft Capability Map (capabilities, dependencies, and coverage matrices). The human operator reviews, refines, and explicitly approves the plan.
- **Strict Scope of Plan Approval:** Approving the draft Project Map approves the plan and breakdown only; it grants no implicit source-write, review, delivery, merge, worktree deletion, or destructive authority.
- **Lead & Satellite Orchestrator Hierarchy:** A clear authority model where the Lead Orchestrator owns the canonical Project Map, boundary adjudication, contract acceptance, and integration sequencing. Satellite orchestrators operate within assigned capability worktrees, propose contracts, execute vertical work, and report state back to the lead.
- **One Branch & Git Worktree per Capability:** Active capabilities are isolated in dedicated branches and Git worktrees to prevent workspace contamination and file contention.
- **"Open Pi" Launcher with Graceful Fallback:** The user or orchestrator can trigger an interactive Pi terminal session directly in the capability's dedicated worktree (e.g., via OS terminal launchers), falling back deterministically to background subagent execution when terminal spawning is unavailable.
- **Architectural Boundary for Storage:** Distinguish between human-reviewable/versioned Project Map definitions (stored in repository workspace) and ephemeral runtime coordination state (claims, leases, heartbeats, ownership, session bindings) which resides in shared cross-worktree storage (preferably under the canonical Git common directory).
- **Integration Queue without Delivery Authority:** An inspection and sequencing queue that orders, prepares, and verifies candidate capabilities against cross-surface checks, while keeping commit, push, PR creation, and merge as explicit user actions under ordinary repository policy.

---

## Scope

### In Scope

- **Project Map Data Model & Schema:** Definition for vertical capabilities, dependency graphs, cross-surface coverage statuses (Product/UX, Web, API, Data, Security, Operations, Tests), ownership claims, and verification states.
- **Interactive Map Proposal & Plan Approval Lifecycle:** New-project drafting flow where Gentle proposes the capability breakdown and dependencies, awaiting explicit user approval before locking the plan.
- **Lead / Satellite Authority Contract:** Rules and protocols defining lead vs. satellite roles, contract negotiation (propose/accept/reject), and cross-capability dependency resolution.
- **Cross-Worktree Shared Runtime Coordination:** Shared runtime state store (using Git common directory / repository-shared storage) for active leases, capability claims, shared contracts, blockers, and milestone receipts across linked worktrees.
- **Capability Worktree Manager:** Provisioning, lifecycle tracking, clean-state verification, and safely guarded removal of capability-dedicated Git branches and worktrees.
- **"Open Pi" Capability Launcher:** Mechanism to spawn a new interactive terminal window running Pi in the capability's worktree directory, with deterministic fallback to background subagent runner (`subagent_run.workspace_root`).
- **Gentle Shell Project Map View:** Extension to Gentle Shell UI rendering active capabilities, surface coverage status, ownership, and quick launch actions.
- **Integration Queue:** Pipeline that sequences capability verification and inspects candidate readiness without bypassing repository merge or delivery policy.

### Non-Goals

- Granting autonomous or automatic merge/push authority; commits, PRs, and merges remain explicit user decisions.
- Granting broad execution or mutation permissions solely upon draft map approval.
- Unconditional or destructive worktree deletion without dirty-state checks and explicit human confirmation.
- Replacing Git merge engines or AST conflict resolvers.
- Building a custom terminal emulator; the launcher invokes existing host terminal utilities or falls back to Pi subagents.
- Implementing the entire system in a single unreviewable monolithic pull request.

---

## Capabilities

### New Capabilities

- `project-map`: The core capability model, schema, and storage representation tracking vertical product capabilities, surface coverage (Product/UX, Web, API, Data, Security, Operations, Tests), dependency links, and human plan approval state.
- `orchestrator-coordination`: The durable lead/satellite coordination engine managing cross-worktree leases, claim heartbeats, contract proposals, blocker tracking, and offline state synchronization.
- `worktree-launcher`: The capability worktree lifecycle manager and "Open Pi" terminal launcher with background subagent fallback.
- `integration-queue`: The staged verification pipeline that checks cross-surface criteria, orders candidates, and reports integration readiness to the user.

### Modified Capabilities

- `gentle-shell`: Extended to render the Project Map view, display surface coverage matrices, and provide interactive actions for capability worktree inspection and terminal launching.
- `gentle-agents`: Augmented with project-scoped coordination tools, extending beyond ephemeral local-profile notifications to query capability status, submit contract proposals, and claim capability work.

---

## Architecture & Technical Approach

### 1. Vertical Capability & Cross-Surface Matrix Model

Capabilities represent end-to-end user value rather than horizontal technical layers. Each capability tracks a 7-point coverage matrix:
- **Product / UX:** User stories, flows, wireframes, user feedback criteria.
- **Web / Frontend:** Client UI components, user interactions, responsive states.
- **API / Interface:** Service endpoints, RPC/HTTP contracts, payloads, validations.
- **Data / Persistence:** Schemas, migrations, relational models, caching policies.
- **Security / Compliance:** Auth, permissions, input sanitization, sensitive data handling.
- **Operations / Infra:** Configuration, environment variables, deployment needs, telemetry.
- **Tests / Quality:** Unit, integration, E2E, and regression verification suite.

### 2. Authority & Orchestration Hierarchy

```
                      ┌──────────────────────────────┐
                      │      Lead Orchestrator       │
                      │   (Map, Leases, Readiness)   │
                      └──────────────┬───────────────┘
                                     │ Git Common Dir / Shared Store
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
 ┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
 │ Satellite Orchestrator│ │Satellite Orchestr.│ │ Satellite Orchestrator│
 │ Capability: Auth      │ │ Capability: Cart  │ │ Capability: Catalog   │
 │ Worktree: .wt/auth    │ │ Worktree: .wt/cart│ │ Worktree: .wt/catalog │
 └───────────────────────┘ └───────────────────┘ └───────────────────────┘
```

- **Lead Orchestrator:** Maintains the single source of truth for the capability dependency graph. Manages capability leases, validates shared contract proposals between satellites, adjudicates boundary conflicts, and verifies integration candidate readiness.
- **Satellite Orchestrators:** Focus on a single vertical capability within its dedicated worktree. Satellites read shared contracts, propose contract adjustments to the lead, and submit completed capability receipts for integration readiness.

### 3. Capability Worktree & "Open Pi" Launcher

1. When a capability transitions to in-progress, a dedicated Git worktree and branch are provisioned.
2. The user or lead can invoke **Open Pi**, which detects the host terminal environment (e.g., Windows Terminal, Ghostty, iTerm2, tmux, xterm, Kitty) and spawns an interactive Pi session in that worktree.
3. If terminal spawning fails or is unsupported in the current headless/container environment, the launcher cleanly degrades to launching a background Pi subagent targeted to the worktree root.

### 4. Storage Architecture Boundary

To ensure correct state sharing across linked Git worktrees without file-visibility friction:
- **Human-Reviewable / Versioned Map Definition:** Project Map definitions, capability specifications, dependency graphs, and coverage declarations reside in the repository workspace where they can be versioned, inspected, and reviewed in source control.
- **Live Ephemeral Runtime Coordination Store:** Ephemeral runtime state—such as active process claims, lease locks, heartbeats, satellite session bindings, and dynamic blocker flags—must reside in a store shared by all linked worktrees, preferably under the canonical Git common directory (e.g., `<git-dir>` / `commondir`). Exact schema and file naming remain a design decision.

### 5. Integration Queue & Delivery Boundaries

- The Integration Queue provides an ordered verification pipeline: it evaluates topological dependencies, runs cross-surface checks, and inspects readiness.
- **No Automatic Delivery Authority:** The queue does not automatically merge branches, create pull requests, or push to remotes.
- All code integration, commits, PR generation, and branch merges remain explicit user decisions governed by repository policy.

---

## Likely Affected Surfaces in gentle-pi

*Note: Specific module names and internal interfaces will be decided during the design phase. The following surfaces represent evidence-based extension points in the existing codebase:*

| Surface Area | Existing Repository Evidence | Expected Evolution |
|---|---|---|
| **Shell UI & Views** | `lib/shell-changes.ts`, `lib/shell-changes-view.ts`, `lib/shell-bar.ts`, `extensions/gentle-shell.ts` | Add Project Map views, capability status badges, cross-surface coverage matrix rendering, and worktree launch controls. |
| **Agent Coordination** | `lib/orchestrator-presence.ts`, `lib/profiles-orchestrator.ts`, `extensions/gentle-agents.ts` | Add cross-worktree lease tracking, contract proposal protocols, and satellite-to-lead status reporting alongside profile presence. |
| **Worktree & Runner** | `lib/agents-runner.ts`, `extensions/gentle-agents.ts` | Add terminal spawning support across host platforms, safe worktree lifecycle operations, and subagent fallback handling. |
| **Core Storage & Validation** | Core library interfaces in `lib/` | Design schemas, validation routines, and cross-worktree shared storage adapters for capability definitions and runtime state. |
| **Orchestrator Prompts & Assets** | `assets/orchestrator.md`, `assets/orchestrator-delegation.md`, `assets/sdd-orchestrator-workflow.md` | Update orchestrator prompt assets to cover capability planning, plan approval gates, cross-surface verification, and lead/satellite division of labor. |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Worktree State Disconnection** | Linked worktrees cannot see local `.gentle/` runtime state located in another worktree folder. | Store live runtime claims, heartbeats, and leases in the shared Git common directory accessible to all worktrees. |
| **Terminal-Launch Portability** | OS terminal spawn commands vary across Linux/macOS/Windows, tmux, and desktop environments. | Implement platform-specific command adapters with strict validation, backed by an immediate fallback to background Pi subagents. |
| **Stale Ownership & Deadlock Leases** | A satellite session terminates abnormally without releasing capability claims, blocking work. | Implement heartbeat timestamps, leasing TTLs, and explicit lead-orchestrator claim reclamation with human confirmation override. |
| **Divergent Code & Merge Friction** | Multiple capability worktrees diverge from trunk during development. | Lead orchestrator enforces topological sequencing, contract locking, and trunk rebase checks before queue verification. |
| **Overreach of Draft Plan Approval** | Approving a map inadvertently triggers autonomous execution, source modification, or worktree deletion. | Strictly enforce that plan approval only approves the plan structure; all write, execution, and delivery actions require explicit policy gates. |
| **Accidental Data Loss on Worktree Cleanup** | Deleting worktrees during rollback or capability cancellation discards uncommitted user changes or stashes. | Never execute unconditional worktree deletion. Enforce clean-state verification and require explicit human confirmation when uncommitted data exists. |
| **Visual Overload in Large Projects** | Projects with dozens of capabilities risk cluttering the shell view and overwhelming the user. | Implement viewport scrolling, milestone/domain grouping, collapsible foundations, and compact summary indicators (e.g., `6/12`). |
| **Stale Derived Coverage** | Global coverage rollups and surface tags fall out of sync with actual codebase state. | Derive coverage status directly from structured checklist artifacts verified during capability lifecycle transitions and integration gates rather than manual estimates. |
| **Map Drift from Feature Task State** | Satellite orchestrator progress in isolated worktrees drifts from the lead orchestrator's canonical Project Map view. | Satellites publish lifecycle events, heartbeats, and contract receipts directly to the shared coordination store, ensuring the shell view reflects live worktree realities. |

---

## Rollback Strategy

1. **Feature Toggle / Progressive Opt-in:** Project Map orchestration features and UI views are gated behind configuration. Disabling the feature leaves Gentle Shell in its standard Status → Changes → TODO mode with existing subagent functionality intact.
2. **Safe Worktree Retention:** Disabling the feature or canceling a capability leaves branches and worktrees completely intact by default.
3. **Guarded Cleanup:** Worktree removal is never performed unconditionally. Any cleanup routine must verify that the worktree has no uncommitted changes, unpushed commits, or stashes, and must require explicit human authorization before removing any workspace.

---

## Dependencies & Prerequisites

- Git worktree capability in the host environment.
- Access to canonical Git common directory (`git rev-parse --git-common-dir`) or repository-shared storage.
- `gentle-shell` UI rendering infrastructure for sidebar and full-view components.
- Existing `subagent_run` runner infrastructure for fallback execution.

---

## Phased Delivery Boundaries (Auto-Chain Plan)

*Note: The phases below define review-sized delivery boundaries (target < 400 lines per PR) for upcoming implementation planning. They do not constitute permission to begin implementation in this phase.*

1. **Phase 1: Project Map Schema, Storage & Draft/Approval Engine**
   - Core data structures for capabilities, dependencies, and the 7 cross-surface coverage dimensions.
   - Versioned map serialization and cross-worktree runtime store adapters.
   - Initial drafting generator and plan-approval state transition logic.

2. **Phase 2: Durable Lead/Satellite Coordination Store & Contracts**
   - Cross-worktree claim/lease mechanism with heartbeats and TTLs in shared storage.
   - Shared contract proposal, review, and acceptance protocol between satellite and lead.
   - Orchestrator tools to query status and claim capability work.

3. **Phase 3: Worktree Manager & "Open Pi" Terminal Launcher**
   - Git worktree lifecycle automation with safety and clean-state verification checks.
   - Multi-platform terminal launcher (Windows Terminal, tmux, macOS/Linux terminals) with background subagent fallback.

4. **Phase 4: Gentle Shell Project Map & Coverage UI**
   - Visual Project Map rendering in Gentle Shell (capabilities, status, cross-surface matrix).
   - Interactive UI controls to view coverage details and trigger "Open Pi" terminal launches.

5. **Phase 5: Integration Queue, Cross-Surface Verification & E2E Validation**
   - Staged integration verification pipeline with topological dependency ordering.
   - Cross-surface check gates reporting integration readiness without autonomous merge/push authority.
   - End-to-end multi-worktree capability coordination test suite.

---

## Measurable Success Criteria

1. **Map Comprehension & Navigation:** A user can immediately identify completed, active, blocked, planned, and ready work plus missing cross-surface coverage at a single glance without reading or reconstructing task documents, and can launch a ready capability directly from the map.
2. **Durable Capability Modeling:** A project can represent vertical capabilities with explicit coverage statuses across all 7 dimensions (Product/UX, Web, API, Data, Security, Operations, Tests) stored on disk.
3. **Strict Plan Approval Gate:** Gentle can generate a proposed capability breakdown from a project prompt and keep it in `draft` until explicit user approval; approval approves the plan only and grants no implicit execution or write authority.
4. **Cross-Worktree Leases:** Ephemeral claims, leases, and heartbeats are stored in a repository-shared store (e.g. Git common directory); two concurrent orchestrator instances cannot claim the same capability worktree simultaneously.
5. **Terminal Spawning & Fallback:** Triggering "Open Pi" on an active capability spawns a dedicated terminal session in that worktree on supported platforms, or starts a background subagent if terminal launching is unavailable.
6. **Cross-Surface Visibility:** Gentle Shell renders the Project Map and clearly flags missing or incomplete coverage surfaces before capability integration readiness.
7. **Delivery & Cleanup Safety:** The Integration Queue verifies candidate readiness without automatic merge authorization, and worktree cleanup strictly checks dirty state before requiring human confirmation.
8. **Review Budget Compliance:** Each delivery phase is decomposed into chained pull requests adhering to the 400-line review budget.
