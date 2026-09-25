# PM-7 — Implement the explicit Open Pi flow

## Objective

Let a ready capability start its own isolated Pi session, explicitly: show `[Open Pi]` only when dependencies, ownership and workspace permit startup, open a Pi session in that capability's worktree through one bounded host adapter, hand the new session a structured brief, offer the background-subagent fallback as a visible human choice, and report launch uncertainty honestly. Nothing in this unit commits, pushes, merges, or deletes anything.

## Problem

PM-1 to PM-6 built the whole chain before the launch: an approved versioned map, a draft/approval lifecycle, a rendered map and inspector, a cross-worktree coordination store, the lead/satellite protocol over it, and capability worktrees with a durable binding. What does not exist is the act itself. A capability can be approved, ready and claimed, with a clean worktree bound to it, and there is still no way to start work in it from the shell: the renderer deliberately omits the action (`odd/tasks/pm-3-render-and-inspector.md:33`: "A ready capability is rendered as ready; the action is absent, not disabled by a guess"), and the repository contains **no host adapter of any kind** — no `tmux` code, no terminal-emulator code, no WSL detection, only `process.platform` checks.

## Why

This is the unit where the Project Map stops being a report and becomes an operable surface, and it is the last dependency of everything after it: PM-8 orders integration for branches that must first exist as work, and the deferred orchestrator-tabs layer needs launched sessions bound to capabilities before it has anything to navigate. It is also the first unit that starts an interactive process outside the current one, so its honesty properties matter more than its features: a spawn ACK is not evidence that work began, and the fallback must never happen silently.

## Decisions (approved by the user, 2026-09-25)

| Question | Options offered | Chosen |
|---|---|---|
| Host adapter scope in v1 | `tmux` only, deterministic and verifiable; `tmux` plus a terminal-emulator whitelist (`wt.exe`, Ghostty, iTerm2, …), better desktop UX but unverifiable in CI | **`tmux` only.** Terminal emulators are an explicit non-goal of this unit and a candidate later slice, when desktop behaviour can be verified for real (PM-9's territory) |
| What gets launched | `gentle-shell` in the capability worktree (full chrome, extension loaded, child is a first-class orchestrator that can claim, heartbeat and bind); bare `pi` with the extension; bare `pi` with only a handoff prompt | **`gentle-shell` in the capability worktree**, so the child can write its own `session-binding`/`heartbeat` — which is also the only honest proof that it started |
| Handoff delivery | argv / initial prompt (small, no footprint, no new store record kind, worktree stays clean); durable file inside the worktree (**would make it dirty**, which PM-6's next plan reports as `Dirty: yes`); durable file under the Git common dir | **argv / initial prompt.** Durability of the launch lives in the existing `worktree-binding` (PM-6) and the child's own `session-binding`/`heartbeat` (PM-4), not in a handoff file |
| Fallback shape when the host is unavailable | visible confirmation in the moment (`ctx.ui.confirm` preceded by a printed plan, the PM-6 pattern); error notification with manual instructions | **Visible confirmation.** The roadmap already requires a visible user choice and forbids a silent behaviour change; the choice is only about its shape, and the confirmation keeps continuity without branching into an error path |
| Session identity | the parent passes the capability (and its own session) through env/args and the child records it; rely on native child hooks and derive identity from the worktree path | **Parent passes it.** Path-derived identity is the same heuristic already rejected for the tabs layer: identity is declared, never guessed |
| How the action is triggered | command surface (`/gentle:project-map open <capability-id>`) with the card showing the `[Open Pi]` affordance; clickable row in the rail | **Command-driven**, following the unit's own precedent (`lead`, `contract`, `worktree` are all commands) and PM-3's rule that the rail's affordance must not be a guess. The rail keeps doing selection and collapse only |

## Scope

### Included

- A read-only readiness predicate that answers, for one capability, whether startup is permitted, and why not when it is not.
- The `[Open Pi]` affordance in the inspector, present only when permitted and absent otherwise — never rendered disabled.
- A pure, testable launch plan: the exact host command, its cwd, its environment and the handoff text, with no process started.
- One bounded host adapter for `tmux`: create a detached session in the capability worktree running `gentle-shell`, with the handoff passed as the initial prompt.
- A single visible confirmation before any launch, printing what will run.
- The background-subagent fallback as a visible choice when the host is unavailable or the user picks it.
- Honest two-state launch reporting: `launched (unconfirmed)` until the child's own binding or heartbeat is observed, and `confirmed` only when it is.
- Documentation and the acceptance record.

### Non-goals

- Terminal emulators of any kind (`wt.exe`, Ghostty, iTerm2, Kitty, WezTerm, `x-terminal-emulator`); v1 is `tmux`-only by decision.
- Any commit, push, PR, merge or release authority, and any worktree deletion.
- A new coordination-store record kind. The handoff travels by argv and the durable evidence is the existing `worktree-binding` plus the child's `session-binding`/`heartbeat`; adding a record kind would force the schema, canonicalizer and emptiness-proof ceremony that PM4-5a and PM6-3 already paid for once.
- Writing any file inside the capability worktree, so PM-6's dirtiness report keeps meaning what it means.
- Clickable launch from the rail; selection and collapse remain the rail's only interactions.
- The orchestrator-tabs layer (deferred, planned after this unit).

## Constraints

- **The child must be able to identify itself.** Launching `gentle-shell` in the worktree only produces a discoverable session if the extension writes the child's own `session-binding`/`heartbeat`; if the child cannot, `confirmed` is unreachable and the honest report stays `unconfirmed` forever. PM7-2 must prove the child-side write actually happens, not assume it.
- **The readiness predicate composes existing truth, it does not re-derive it.** It consults approval state, dependency readiness, open blockers, proposed contracts, the worktree plan's diagnostics, the declared-state gate, and the host probe. Ownership comes from the worktree plan's forwarded claim diagnostics; `nextSafeAction` is not consulted because its proxy was removed.
- **No unresolved host state may become a silent success.** An absent `tmux`, a failed `new-session`, or a session that never heartbeats are three different, separately reported outcomes.
- **An unreliable store fails closed.** `projectMapOpenPiReadiness` forwards root and coordination-store diagnostics, so an unreadable or corrupt record denies opening even when it belongs to another capability. Coordination conflicts are not forwarded and do not deny readiness; fail-closed applies to diagnostics, not every coordination conflict. PM-6's worktree plan independently applies the live-claim gate for every capability status; PM7-1 therefore removes the redundant `nextSafeAction === "claim"` proxy, which could disagree with a stale coordination projection. Recorded debt: a malformed store record names its hashed record filename but not the capability identity or a structured path. Store-module work must improve that fidelity; this slice deliberately does not change it.
- **"Read-only" means no writes and no mutating process, not "no subprocess".** Bounded read-only probes are allowed and expected, matching PM-6's inspection precedent; mutating commands, shells and session launches are not. Every subprocess runs with the repository's sanitized environment.
- **Security posture matches PM-6.** No shell interpolation of capability-derived values into a command string: the adapter builds an argv array (the `planSpawn`/`buildPiInvocation` shape), and the handoff text is passed as an argument, never concatenated into a shell line.
- **Review budget: 400 lines per commit**, with the standing rule that an overage is reported and decided by the user rather than hidden.

## Authorized edit surfaces

Slice by slice; no slice may touch a path outside its own list.

- PM7-1 (readiness predicate, read-only): `lib/project-map-open-pi.ts` (new), `tests/project-map-open-pi.test.ts` (new), `lib/shell-project-map-view.ts` and `tests/shell-project-map-view.test.ts` for the `[Open Pi]` affordance line only
- PM7-2 (launch through the tmux adapter, and the affordance wiring): `lib/project-map-open-pi.ts`, `tests/project-map-open-pi.test.ts`, `extensions/gentle-project-map.ts` for the `open` sub-action and the render-time readiness call, `lib/shell-project-map-card.ts` plus `tests/shell-project-map-card.test.ts` for passing the decision into the rail, and `tests/gentle-project-map-open-pi.test.ts` (new)
- PM7-3 (visible fallback): `lib/project-map-open-pi.ts`, `tests/project-map-open-pi.test.ts`, `extensions/gentle-project-map.ts`, `tests/gentle-project-map-open-pi.test.ts`
- PM7-4 (honest reporting, docs, verification): `lib/project-map-open-pi.ts`, `extensions/gentle-project-map.ts`, their tests, this document, `odd/tasks/project-map-orchestration.md`, `docs/project-map.md`, `docs/gentle-shell.md`, `README.md`
- This document and `odd/tasks/project-map-orchestration.md` for bookkeeping at any point

## Task list

- [x] **PM7-1 — Readiness predicate and the `[Open Pi]` affordance (read-only)**
  - Design, fixed before the source write:
    - **One predicate, one reason list**: `projectMapOpenPiReadiness({ cwd, capabilityId, sessionId, now, host })` returns `{ permitted: boolean, capability, claim, worktree, host, diagnostics }`, where every disqualifier is a named diagnostic rather than a boolean. **Read-only here means no writes and no mutating process**: the predicate writes nothing (no store record, no lock, no file, no directory, no branch, no worktree) and starts no session; its only subprocesses are the bounded read-only ones it inherits from PM-6's inspection (`git show-ref`, `git status`, `git worktree list`), which PM-6 already proved read-only. An earlier wording of this document said "no process", which contradicted the host probe below and was unachievable while reusing that inspection; the operative rule is the one in this line.
    - **The disqualifiers, each a named code**: capability not found, not approved, or not declared `ready`; dependencies not ready; an open blocker; a proposed contract awaiting a decision; no live claim; a live claim held by another session that is neither this session nor the live lead; a worktree that cannot be planned (`reuse` or `create` refused, reusing PM-6's existing codes rather than inventing copies); a target already occupied by a live session; and the host unavailable (`tmux` missing). Existing codes are reused wherever they already exist; only genuinely new conditions get new codes.
    - **Declared state is human authority**: only `ready` permits opening. A capability declared `active` whose session died cannot reopen until a human returns it to `ready`; that friction is deliberate because PM7 does not infer a declaration is stale. The alternative, permitting both `ready` and `active`, is rejected for this slice so a later change must make that trade-off explicitly.
    - **The host probe is its own function, so the predicate cannot spawn it**: `probeProjectMapOpenPiHost({ env, timeoutMs })` is the single place that runs the bounded `tmux -V` check (`execFileSync`, sanitized environment, explicit timeout) and returns `{ available, version }`. `projectMapOpenPiReadiness` receives that result as the `host` **input** instead of performing it, which keeps the predicate's tests deterministic and free of the real `tmux` binary. The probe ships in PM7-1 with its own tests; the composition `probe → predicate → plan` is PM7-2's command, and PM7-2 is the first slice that may start a session.
    - **The affordance is absent, not disabled**: `lib/shell-project-map-view.ts`'s inspector emits an `[Open Pi]` line only when the predicate permits it, and the row rendering is unchanged. A test pins both directions.
    - **The render functions stay pure and the live wiring lands in PM7-2**: the inspector, body, descriptor, and digest are pure functions of their inputs and receive the readiness decision as an injected value (an optional parameter carrying `permitted` plus the disqualifying diagnostic). `projectMapCardState` reads the artifact through `readProjectMapFile` and did so before PM7-1; this slice introduces no new filesystem, store, clock, or environment reads. PM7-1 therefore ships the predicate and the renderable line with its tests; wiring the decision into the live rail — which happens in `extensions/gentle-project-map.ts:753` through `lib/shell-project-map-card.ts` — belongs to PM7-2, the slice that owns the command and the readiness call at render time.
    - Tests, written first and watched fail: each disqualifier produces its own code and `permitted: false`; a fully ready capability produces `permitted: true` with an empty diagnostics list; the inspector shows the line when permitted and omits it otherwise; and a whole-sandbox snapshot proves the predicate wrote nothing.
    - Evidence expectation: RED before GREEN, mutation probes on each disqualifier and on the affordance's absence, the four gates (focused, neighbours, full suite, `check-types`), independent verification and one native review.

- [ ] **PM7-2 — The launch plan and the tmux adapter**
  - Design, fixed before the source write:
    - **Plan and execute are two functions**: `planProjectMapOpenPi({ cwd, capabilityId, sessionId, now, host })` returns the readiness result plus `{ decision: "open" | "refuse", argv, cwd, env, handoff, diagnostics }` and starts nothing; `openProjectMapPi(...)` executes exactly the planned argv after the confirmation. No shell is involved: `argv` is an array handed to the spawner, and the handoff is one element of it. The fallback decision belongs to PM7-3 and is not represented here.
    - **The handoff is the structured brief, as text**: objective, approved surfaces, dependencies and their states, accepted contracts, the capability's feature documents, the parent session id, and the verification requirements — assembled from the approved map and the coordination projection, never retyped by hand. The shape is pinned by a test, so a later field addition is deliberate.
    - **The child is identified explicitly**: the parent passes the capability id and its own session through the child's environment, and the launched `gentle-shell` therefore starts in the capability worktree with the extension loaded. PM7-2 must demonstrate the child-side write (`session-binding`/`heartbeat`) with a real, headless child or state plainly that it could not and leave the report at `unconfirmed`.
    - **The command surface grows one sub-action**: `open` joins `PROJECT_MAP_SUB_ACTIONS` (`extensions/gentle-project-map.ts:61`), prints the plan (capability, branch, path, host, the exact argv, and what will be opened), asks once, then launches. A plan that already refuses is never confirmed — the PM-6 rule, reused.
    - Tests, written first and watched fail: the argv and handoff are pinned for a ready capability; the display order is plan → confirm → launch, asserted with a fake confirm that captures notifications at the time they happen; a refusing plan never reaches the spawner; a spawn failure is reported as a failure, not as a launch; and a headless `tmux` integration test runs when `tmux` is present and skips itself when it is not (`tmux 3.6` is installed on the development machine; CI portability is preserved by the skip).
    - Evidence expectation: RED before GREEN, mutation probes on the argv construction, the no-confirm-on-refusal rule and the failure path, the four gates, independent verification and one native review.

- [ ] **PM7-3 — The visible fallback to a background subagent**
  - Design, fixed before the source write:
    - **The fallback is offered, never taken silently**: when the host is unavailable, or the user chooses it at the confirmation, the command offers the background-subagent path as an explicit, visible choice and only proceeds on an affirmative answer. Declining leaves everything untouched.
    - **The subagent path reuses the existing runner**: the launch goes through `lib/agents-runner.ts`'s existing spawn contract (`pi --mode rpc`, `childArguments`), with the same handoff text and the capability worktree as `cwd`. No second runner is written.
    - **The two paths are reported differently and truthfully**: a subagent run has a different lifecycle from an interactive session, and the report says which one ran. Neither is claimed to be working until there is evidence.
    - Tests, written first and watched fail: an absent host produces a visible choice rather than a silent fallback or a bare error; picking the fallback uses the runner and the worktree `cwd`; declining spawns nothing; and the report distinguishes the two paths.
    - Evidence expectation: RED before GREEN, mutation probes on the silent-fallback boundary (the important one: no code path may reach the runner without an affirmative answer), the four gates, independent verification and one native review.

- [ ] **PM7-4 — Honest launch uncertainty, documentation and verification**
  - Design, fixed before the source write:
    - **Two states, and the second one is earned**: the launch reports `launched (unconfirmed)` at spawn time and `confirmed` only when the child's own `session-binding` or a fresh `heartbeat` for the capability is observed. A timeout without that evidence stays `unconfirmed` and says so; there is no third state that means "probably fine".
    - **The acceptance criteria below are traced one by one** to the test that pins each, and anything not verified is written down as not verified rather than implied.
    - Documentation: the Open Pi flow, its readiness prerequisites, the absent-not-disabled rule, the `tmux`-only scope, the handoff shape, the fallback, and the launch-uncertainty semantics in `docs/project-map.md`; the card/inspector behaviour and the confirmation in `docs/gentle-shell.md`; the roadmap entry checked off with its slice records.
    - Evidence expectation: the four gates including the full suite, the type gate with no regressions, `git diff --check`, an independent verification of the acceptance record, and one native review.

## Acceptance criteria

Traced in PM7-4 to the test that pins each; none may be claimed without one.

1. `[Open Pi]` appears only for a capability whose dependencies, ownership state and workspace permit startup.
2. It is absent — not disabled — when any precondition fails, and the refusal names the failed precondition.
3. A Pi session opens in the capability worktree, never in the lead's checkout, through exactly one bounded host adapter.
4. No capability-derived value is ever interpolated into a shell string.
5. The new session receives the structured handoff: objective, approved surfaces, dependencies, contracts, feature documents, parent session and verification requirements.
6. A missing or unusable host produces a visible user choice, never a silent fallback and never a silent failure.
7. A spawn or transport ACK is never reported as "work began"; `confirmed` requires the child's own durable evidence.
8. Nothing in this unit commits, pushes, creates a PR, merges, or deletes a branch or worktree.
9. The launched session is discoverable afterwards through its own binding, which is what the deferred tabs layer will read.

## Review workload forecast

Estimates: PM7-1 ≈ 320 lines (the predicate, the diagnostics and their fixtures), PM7-2 ≈ 350, PM7-3 ≈ 250, PM7-4 ≈ 150. Every slice stays under the 400-line review budget, and each is delivered as its own commit. If a slice measures over budget, it is split before it is committed rather than after.

The PM-6 lesson applies and is budgeted here rather than discovered again: a slice that introduces a human gate and a durable record costs about its estimate **plus one audit round**, and the audit round is the half that keeps being underestimated. PM7-2 is the slice where that is most likely, because it is the only one that starts a process.

## Review disposition (user's decision, 2026-09-25)

RDD is **off** for this clone (`clone-local: off`, inheriting nothing from `global: on`), and this unit is implemented under that setting, as PM-4, PM-5 and PM-6 were. The unit therefore carries parent verification plus independent audits; the deferred native review pass runs when the unit closes, one candidate per slice, from a worktree pinned at that slice's tip with `baseRef` set to the previous slice's tip, with RDD enabled for the pass and returned to off afterwards. An unreviewed-candidate reminder during implementation is answered by reporting this disposition; no review is started mid-unit and never against a tree with a writer still running.

## Progress

- 2026-09-25: **unit planned.** Read-only surface map first. Its central finding: no host adapter of any kind exists in the repository, so PM-7 introduces the first interactive process launched outside the current one; `[Open Pi]` exists only in design documents; and PM-3 already froze the rule that the action is absent rather than disabled. The user settled the six decisions above and the plan is frozen. Nothing has been implemented yet; PM7-1 is the next work unit.
- 2026-09-25: **PM7-1 corrective round verified.** The parent's `proxy:claim-required-statement` mutation survived, confirming PM-6 owns the claim gate; the parent's `forward:store-diagnostics` mutation also survived because the suite lacked an unreliable-store fixture. This round removed the proxy, added a deterministic unrelated corrupt-record fixture, and pinned fail-closed forwarding: removing the consolidated store-diagnostics forwarding line makes readiness incorrectly permit the otherwise-ready capability. The store diagnostic-fidelity gap is recorded above as out-of-slice debt.
- 2026-09-25: **PM7-1 delivered** (`e0c1089f`, 274 diff lines: 231 new across the predicate and its tests, plus the affordance and this document). Readiness composes approval, the declared state, dependencies, blockers, contracts, the worktree plan's diagnostics and the host probe, and the inspector renders `[Open Pi]` only when the injected decision permits it. Verified in two independent read-only passes: the second found the missing declared-state gate and an overstated debt statement, and both were closed in the second corrective round. Closure evidence: the parent's fifteen-probe mutation matrix with **zero survivors** and a byte-for-byte restore for every probe (sha256 identical before and after), focused 6, neighbours 80, full suite **3,808 (3,770 passed, 38 skipped, 0 failed)**, type gate **195** with no regressions, and the provider contract, runtime harness and `git diff --check` all exiting 0. Deliberately not verified: the four readiness coverage limits listed below, the store diagnostic-fidelity debt, and the live-rail wiring that belongs to PM7-2.
- PM7-2 owns the readiness coverage limits: there is no stale-claim readiness fixture, risking an unpinned stale-claim denial path.
- PM7-2 owns the readiness coverage limits: there is no live-lead exception fixture, risking an unpinned lead-held claim allowance.
- PM7-2 owns the readiness coverage limits: there are no separate nested-repository, foreign-clone, or path-escape readiness fixtures, risking regressions in repository-boundary handling.
- PM7-2 owns the readiness coverage limits: there is no test for the returned `claim` field when the lead holds the claim, risking an unpinned caller-facing ownership result.

PM7-2 records an owed product decision: the versioned map has no per-capability verification-requirements field. Its handoff therefore says `Verification requirements: not declared by the map.`; PM-8 owns deciding whether the schema grows that field, and this honest content remains until then.

PM7-2 closure limit: the receiver's durable `session-binding` and `heartbeat` writes are proven only at the handler level with fakes, not end-to-end against a real launched `gentle-shell` child. Therefore `confirmed` remains unproven; PM7-4's acceptance record must carry that criterion as **not verified**, not imply it from a tmux spawn acknowledgement.

## Next decision

PM7-1 is the next work unit: the readiness predicate, the host probe and the affordance, all read-only, with no session started and nothing written. It is the slice that makes the map honest about what can start, before anything actually starts.
