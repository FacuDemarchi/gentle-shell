# Project Map

A Project Map is a versioned, machine-readable definition of a project's foundations and capabilities. It records intended outcomes, coverage, dependencies, and links to feature documents without embedding mutable execution state.

The artifact path is exported as `PROJECT_MAP_ARTIFACT_PATH` (`"openspec/project-map.json"`) so callers stop repeating the literal. Version 1 uses `"gentle-shell.project-map/v1"`.

## Fields

```ts
{
	version: "gentle-shell.project-map/v1";
	project: { id: string; name: string };
	approval?: {
		state: "draft" | "approved";
		approvedAt?: string;
		approvedBy?: string;
	};
	foundations?: Array<{
		id: string;
		outcome: string;
		state: ProjectMapState;
		evidence?: string[];
	}>;
	capabilities: Array<{
		id: string;
		outcome: string;
		foundationRefs?: string[];
		dependsOn?: string[];
		contracts?: string[];
		featureDocs?: string[];
		surfaces: ProjectMapSurface[];
		state: ProjectMapState;
	}>;
}
```

`version`, `project`, `project.id`, `project.name`, `capabilities`, and every capability's `id`, `outcome`, `surfaces`, and `state` are required. Foundations, `foundationRefs`, `dependsOn`, `contracts`, and `featureDocs` default to empty arrays. `evidence` is optional.

## Draft generation

`generateProjectMapDraft` (`lib/shell-project-map-draft.ts`) builds a draft from structured repository sources. It is deterministic: identical input produces byte-identical serialization, and it performs no filesystem access and no model call. It returns `{ map, assumptions, omissions }`, where `map` is `null` only when the project identity cannot be derived at all.

The generator reads the package manifest for project identity and the repository tooling foundation, and `openspec/config.yaml` for the quality gates foundation. Only the simple `key: value` shape of the configuration is interpreted, including one level of nesting. A block scalar body is skipped by indentation, so a `key: value` line inside it is never read as configuration; lists, comments, and multi-line values are not interpreted either, and a configuration the generator cannot interpret is reported as an omission.
Two rules keep a generated draft honest:

- A foundation is `done` only when its named structured source carries a well-formed declaration of it, so `done` means declared, never verified. A declared script must be a usable command string, not merely a key.
- The generator never invents a capability. It derives one only from a work unit a supplied ODD document actually declares, and it reports the absence of capabilities as an omission. A document whose path is not repository-relative is skipped with an omission rather than recorded as a feature document.

When ODD task documents are supplied, every line of the form `- [ ] **ID — Title**` or `- [x] **ID — Title**` becomes a capability: the title becomes the identifier and outcome, the declaring document becomes its feature document, and the checkbox becomes `planned` or `done`. The checkbox is a declaration of completion, not verified progress. Documents are processed in path order, so a repeated capability identifier keeps its first declaration and reports the collision. A document that declares no readable work unit, and a title that cannot become an identifier, are both reported as omissions.

A generated capability leaves its surface list empty, because no structured source states which product surfaces it touches; the draft therefore relies on the approval contract allowing an empty list before approval.

Every generated map is a draft. The generator never marks a map approved, and it returns a canonicalized draft, so the map it hands a caller is exactly what `validateProjectMap` returns for it.

## Command surface

`/gentle:project-map` (`extensions/gentle-project-map.ts`) is the human entry point, with ten validated sub-actions:

- `status` reads the artifact and reports its approval state and counts. It never writes.
- `draft` reads the repository sources, generates a draft, shows the assumptions and omissions it could not resolve, and writes only after an explicit confirmation. It replaces whatever the artifact held, an approved map included, so it is not a way to edit an approved plan in place.
- `declare <capability-id> <surface>...` replaces that draft capability's declared surface list with exactly the supplied surfaces, then writes only after an explicit confirmation. With no surface it clears the list back to not yet determined.
- `approve <actor>` reads the artifact, refuses when anything is incomplete, shows what it is about to record, and writes only after an explicit confirmation.
- `show` displays the Project Map card for the current session without writing the artifact.
- `hide` removes the Project Map card for the current session without writing the artifact.
- `lead claim|renew|release|status` manages the reserved lead claim for the current session. The session identity comes from the command's own session manager, never from a free-text argument, and a session that cannot be identified is refused rather than guessed.
- `contract propose|accept|reject|list ...` drives the shared-contract protocol described below; `accept` is the only one of them that writes the artifact.
- `worktree inspect|provision|list ...` plans, provisions, or lists capability worktrees as described below; only `provision` can write.
- `open <capability-id>` plans an Open Pi launch, shows the plan, asks once, and starts one session in the capability worktree as described below; it writes no artifact.

An unknown sub-action lists the valid ones and writes nothing. An approval without an actor is refused, because an approval nobody can attribute is not auditable. A declaration refuses an unknown or repeated surface and names the frozen vocabulary; it also refuses an approved map, because declaration is a draft-time action and no plan-preserving return to draft exists. The transition takes its timestamp as an argument rather than reading the clock, so the tests inject it; the command is what supplies the current time. Every artifact-writing sub-action re-reads the artifact after its confirmation: when the file changed while the decision was pending, the write is refused and the change reported instead of clobbering the other writer. `worktree provision` writes no artifact; it re-inspects the plan's compared facts under the store lock and refuses when they changed.

## Sidebar card

The Project Map card is a read-only rendering of the artifact. It distinguishes an empty artifact, an invalid artifact, a draft map, and an approved map; draft and approved are visible in the subtitle so a draft never reads as approved. A missing or unreadable artifact renders empty, while a malformed JSON artifact renders invalid with its diagnostic: the card shows the first three diagnostics and then points at `/gentle:project-map status` for the full report, so a long list cannot crowd out the map. Ready maps group Foundations (when declared) and Product capabilities. Each group header shows its done/total indicator and state: `▾ Foundations 2/3` is expanded and `▸ Product capabilities 6/12` is collapsed. Each capability row carries its lifecycle glyph and declared surfaces.

Coverage counts every capability that declares a surface in its denominator, and only the `done` ones in its numerator. Each declared value explains the contributing capabilities and their glyphs, for example `Web 67% (2/3): auth ✓, search ✓, billing ✕`. A surface that no capability declares renders as unknown (`—`), never `0%`: undeclared is an absence of evidence, not evidence of absence.

In fullscreen, clicking a group header toggles that group alone. Clicking a capability selects it; clicking the selected row clears it. A capability row whose rendered identifier wraps keeps every continuation line as part of its click target, so a long identifier stays selectable as one row. The selected row replaces its two-space indent with `▸ ` while preserving its lifecycle glyph. `alt+m` folds both groups when either is expanded and unfolds both when they are already folded. Set `GENTLE_PI_PROJECT_MAP_KEY` to bind a different shortcut; an empty value uses `alt+m` and `off` disables the shortcut. `alt+j` and `alt+k` move the capability selection forward and backward without wrapping, expanding a collapsed capabilities group when the selection moves onto a row it would hide; set `GENTLE_PI_PROJECT_MAP_NEXT_KEY` or `GENTLE_PI_PROJECT_MAP_PREV_KEY` to rebind them, with the same empty-value and `off` behavior. The collapse key is shown in the card top rule when it fits.

A selected capability appends an Inspector after Coverage. It shows the id and lifecycle state, outcome, declared surfaces, referenced foundations and dependencies with their glyphs, contracts, feature documents, and explicit `none` values for empty lists. Its blockers are static only: its blocked state plus non-done dependencies or foundations. The runtime overlay is not wired into the card yet — the coordination store exists (PM-4) and the protocol that reads it exists (PM-5), but the card still renders no runtime claims, leases, or blockers rather than fabricating them. When selection changes, the fullscreen rail reveals the selected rendered row only if it is outside the current viewport.

The rail digest is derived from the rendered descriptor (title, subtitle, tone, and body), so it moves when the descriptor moves, including on a collapse, selection, or inspector-content change. Width-dependent clipping happens inside `renderCard`, with width already part of the section cache key. In fullscreen, the card occupies the `project-map` rail slot; the reserved rail order is `footer` → `project-map` → `agents` → `todo`, and the `agents` slot is omitted while nothing is registered there, which is why the visible rail reads Status → Project Map → TODO. Below the sidebar breakpoint and in regular mode, the same card appears collapsed below the editor as a single line: the `done/total foundations · done/total capabilities` summary when the artifact is ready, and otherwise the first body line, collapsed with an ellipsis when the body has more than one line. An empty artifact therefore still announces `No Project Map at openspec/project-map.json.`, and an invalid one still announces `The Project Map artifact is not valid:` rather than vanishing with the rail; both are clipped to the available width, and the diagnostics themselves stay in the fullscreen card and in `/gentle:project-map status`.

Visibility, collapse, and selection have no persisted setting. A ready artifact is visible by default; an empty or invalid one stays out of the rail until `show`. `show` and `hide` apply only to the current session, and the next session recomputes visibility from the current artifact.

### Surface declaration loop

A generated draft always declares no surfaces, because the generator never infers them, and the approval gate requires them. Complete the draft before approval by declaring each capability through the command:

1. Run `/gentle:project-map draft` and confirm the draft.
2. Run `/gentle:project-map declare <capability-id> <surface>...` for every capability, confirm each resulting replacement, and use only the frozen surface vocabulary.
3. Run `/gentle:project-map approve <actor>` once every capability has a declared surface.

A declaration is set semantics: one invocation replaces the whole list, so there is no additive mode, removal operator, or `undeclare`. `/gentle:project-map declare <capability-id>` with no surface deliberately clears the list back to not yet determined, which a draft permits. Unknown and repeated surfaces are refused rather than silently deduplicated, and a declaration against an approved map is refused before any write. No plan-preserving return to draft exists: regenerating the draft is the only path back, and it replaces the plan the map had approved rather than reopening it. The approval refusal still names the exact incomplete path (`$.capabilities[n].surfaces`); the gap remains deliberate rather than hidden, because inferring surfaces would manufacture the coverage the map exists to report honestly.

## Approval transitions and persistence

`approveProjectMap` (`lib/shell-project-map-approval.ts`) moves a draft to approved. It performs no I/O and mutates nothing: it returns a new canonical map or a refusal. It refuses an already-approved map, because approval is not repeatable; it refuses an empty actor or a timestamp that is not a real ISO-8601 instant; and it refuses a map the validator rejects, which is where the completeness gate lands — a capability that still declares no surface cannot be approved.

`writeProjectMapFile` persists a map through `writeJsonFileAtomicallySync`, so the artifact is only ever swapped for a complete document and a failed write leaves whatever the artifact already held untouched. It validates before writing, which means a draft is persisted as a draft and an invalid map is never written at all. Writing a document whose bytes already match is a no-op rather than mtime churn.

Approval is a declaration of plan authority only. It starts no writer, creates no worktree, touches no source file, and authorizes no commit, push, merge, or release.

## Coordination protocol

The versioned artifact is the plan. The coordination protocol is the runtime side that lets several worktrees of one clone work on that plan without contradicting each other, and it lives outside the artifact in the shared store under the canonical Git common directory (`<commonDir>/gentle-ai/project-map`). Nothing in it is plan authority: a claim, a lease, a heartbeat, a blocker or an accepted contract changes no source file and authorizes no commit, push, PR, merge or release.

The durable records are the state transitions, and there is no separate event journal, because a second source of truth is a second thing to keep in sync:

| Record | Lives at | Meaning |
| --- | --- | --- |
| descriptor | `store.json` | the store's identity, generation and predecessor chain |
| claim | `claims/<sha256(capability-id)>.json` | one session's bounded ownership of one capability, with a 10s renewal cadence and a 60s deadline |
| heartbeat | `heartbeats/<sha256(session-id)>.json` | a heuristic of liveness, never a proof, refreshed every 10s |
| session binding | `sessions/<sha256(session-id)>.json` | which process and workspace a session is, so a dead owner can be proved dead |
| blocker | `blockers/<sha256(capability-id)>/<sha256(blocker-id)>.json` | an obstacle with an owner and a resolution path |
| readiness receipt | `receipts/<sha256(capability-id)>/...` | what was verified, and `authority: "none"` |
| contract proposal | `contracts/<sha256(capability-id)>/<sha256(contract-id)>.json` | a shared-contract proposal, its body digest, and its decision |
| worktree binding | `worktrees/<sha256(capability-id)>.json` | one capability's branch, worktree root, session and audited base commit |

A store that is not `ready`, a non-canonical record, or an unreadable file is refused rather than interpreted, and the emptiness proof that guards initialization counts every record directory, including `worktrees/`, so a store holding live state can never be initialized over.

### The lead and its satellites

One session per repository is the lead, and it is simply a claim on the reserved capability id `__lead`. Two consequences follow from reusing claims instead of inventing a leader record: a second lead is refused while the first lease is live, and a lead whose process died is recovered after its deadline with a visible `stale-claim-recovered` warning rather than by a silent takeover. A satellite claims one capability and works inside the surfaces that capability declares.

### Shared contracts

A shared contract is proposed, decided and then applied, in that order, and each step is a different durable fact:

1. `contract propose <capability-id> <contract-id> <title> <body-path>` records the proposal with the `sha256` digest of the body file. The body itself stays out of the store.
2. `contract accept` or `contract reject` records the decision with its rationale. A decision is evidence: a second decision on the same contract is refused, and the first one survives byte-for-byte.
3. Only `contract accept` then writes the artifact, adding the contract id to that capability's `contracts` array and nothing else. The approval block, the capabilities, their surfaces, dependencies and foundations are untouched, and no runtime field is ever added.

Only the session holding a live lead claim may decide, and that check lives in the command rather than in the store: the store records who decided and never arbitrates. Acceptance records the durable decision before it touches the artifact, so a failed artifact write leaves the decision intact and the apply can be retried. This is the one place where the protocol writes the versioned map, and it is deliberately narrow: the lead owns shared contracts, while the capability list, the surfaces, the dependencies, the foundations and the `draft`/`approved` state stay the human's.

### What a satellite may and may not do

A satellite may claim a capability, renew and release it, report blockers, issue readiness receipts, propose a shared contract, and read the coordination state. It may not decide a contract, declare surfaces, approve the map, or write the artifact; every one of those is refused with a named diagnostic rather than silently ignored.

### Conflicts the projection reports

`readProjectMapCoordinationState` is read-only and reports the facts a coordinator needs: the lead, the satellites, the derived dependency readiness and completion, a next safe action per capability, and five conflicts it can honestly detect — a claim on a capability the map does not declare, a claim on a capability with no declared surfaces, a live claim whose session has no fresh heartbeat, a map that declares the reserved `__lead` id, and a store generation that moved past the one the caller expected. File-level enforcement of declared surfaces is deliberately not claimed. The worktree-to-capability binding now records that association, but it does not detect or prevent an out-of-surface edit; that enforcement is later work, so the projection reports the signal instead of pretending to prevent it. `dependency-ready` and `completion` are derived from the map plus the receipts, never stored, and the projection writes nothing at all.

### Commands

- `lead claim|renew|release|status` manages the lead claim for the current session.
- `contract propose <capability-id> <contract-id> <title> <body-path>` records a proposal, computing the digest from the body file so nobody types one.
- `contract accept <capability-id> <contract-id> <rationale>` asks for confirmation, records the accepted decision, and then applies it to the approved artifact.
- `contract reject <capability-id> <contract-id> <rationale>` records the rejection and never touches the artifact.
- `contract list [capability-id]` lists proposals and decisions, for one capability or for every capability the map declares.

Every refusal keeps the store's own diagnostic code — `claim-held`, `renewal-too-early`, `contract-exists`, `contract-absent`, `contract-already-decided`, `unreadable-store`, `store-locked` — so a caller can branch on the reason instead of parsing a message.

## Capability worktrees

A capability worktree has a pure, deterministic identity derived from the approved capability id: its branch is `feat/<capability-id>` and its path is `<parent-of-repo>/<repo>-worktrees/<capability-id>`. `deriveProjectMapWorktreeIdentity` derives those values from the canonical repository root and the id; it does not inspect Git, the filesystem, or the clock.

`inspectProjectMapWorktreeTarget` is read-only. It reports the derived identity; repository root, Git common directory and same-clone fact; branch existence and whether that branch is current; target directory existence and emptiness; nested-repository and common-directory containment facts; the capability claim; and store-derived target occupancy with the occupant's heartbeat state. It writes no branch, directory, lock, or store record.

`planProjectMapWorktree` turns that inspection into `create`, `reuse`, or `refuse`. The plan carries the exact command it would run, `git worktree add -b <branch> <path> <base>`, where `<base>` is the resolved `HEAD` recorded by the plan, and the printed plan shows that command together with the decision, the branch, the path, the base commit and whether the worktree is dirty. A live capability claim is required: the caller may hold it, or the caller may be the live lead while another live session holds it; any other holder refuses with the existing `claim-held` code. Nothing here validates that the id belongs to this repository's approved map — the id is the caller's input and the enforced gate is a live claim, so a claim on an id the map does not declare is possible, and the coordination projection reports it as a conflict.

Provisioning acquires the store lock and re-inspects before acting. When a new worktree has to be created, a missing base is created with mode `0o700`, and a pre-existing symlinked or non-directory base is refused; a reuse creates no base and does not run that check, so a same-clone worktree reached through a symlinked base can still be reused. Git runs `git worktree add -b <branch> <path> <base>` with the sanitized Git environment. After Git returns, the target is revalidated as a real directory at the derived path, in the same clone and outside the common directory, on the expected branch and base commit. A detected divergence is `uncertain`, never success.

Reuse is only for a worktree at the derived path whose root belongs to this clone and whose expected branch exists and is current. It creates nothing and reports `created: false`. A dirty but otherwise correct worktree is reported as dirty in the plan the human confirms rather than refused; a plan approved while clean but found dirty under the lock is refused because the displayed plan no longer matches.

The named refusals are `worktree-claim-required` for no live claim, `worktree-target-not-empty` for content that is not a reusable target, `worktree-nested-repository` when the target sits inside another Git working tree, `worktree-foreign-clone` when the target belongs to a different clone, `worktree-occupied` when the store finds a live session binding for it, and `worktree-path-escapes` for common-directory containment or an unsafe worktree base or target path. A refusal creates neither branch nor directory; pre-existing objects remain in place rather than being removed.

The durable binding is one `worktree-binding` record per capability at `worktrees/<sha256(capability-id)>.json`. It contains `schema`, `kind`, `capability_id`, `branch`, `worktree_root`, `session_id`, `base_commit`, and `created_at`. Rebinding is idempotent only when the five binding facts — capability, branch, worktree root, session, and base commit — match. `created_at` is first-write metadata and is deliberately excluded, so a legitimate later re-provisioning does not conflict. Any other difference refuses with `worktree-already-bound` and never overwrites the first record. The store records bindings; it does not arbitrate claims.

The command is `worktree inspect|provision|list <capability-id>` (`list` takes no capability id). `inspect` prints the plan and writes nothing. `provision` prints that plan and, unless it already refuses, asks exactly once through the UI confirmation; it provisions with the displayed plan, so a change to the compared facts — the decision, the branch, the path, the base commit, the dirtiness, the command or the inspected state — is refused rather than re-planned. `list` prints the durable bindings. An unverifiable result registers and binds nothing. A session-registration failure is a warning on an otherwise successful provision.

Nothing deletes, prunes, or rewrites a worktree or branch automatically. Cleanup only inspects and asks. Provisioning a worktree or creating a branch grants no commit, push, PR, merge, or release authority.

The sibling layout keeps the path-race boundary decided on 2026-09-25. Before creating a new worktree, a pre-existing symlinked base is refused, and a missing base is created `0o700` without unchecked recursive symlink traversal; identity and containment are revalidated after Git runs. This guarantee assumes the repository's parent directory is not concurrently replaced by an uncooperative filesystem actor. Node pathname checks followed by `git worktree add` cannot atomically exclude that actor, so this protocol claims no atomic protection from a hostile path race.

## Open Pi

`open <capability-id>` starts one session in the capability worktree and nothing else. It is the only sub-action that starts a process, and it commits, pushes, creates a PR, merges, deletes no branch or worktree, and writes no artifact.

`projectMapOpenPiReadiness` composes the whole launch gate and names every disqualifier as a diagnostic instead of returning a boolean: `capability-not-found`, `capability-not-approved`, `capability-not-ready`, `dependencies-not-ready`, `open-blocker`, `proposed-contract`, `host-unavailable`, and `worktree-not-provisioned`, alongside the refusals the worktree plan already names. Only a capability declared `ready` may be opened; a capability declared `active` whose session died keeps that friction until a human returns it to `ready`, because the map does not infer that a declaration is stale. The launch target must exist: a worktree plan of `create` means provisioning has not happened yet, so the action stays absent until `worktree provision` runs.

The inspector renders `[Open Pi]` only for a capability the runtime gate permits. The line is absent rather than disabled, so the map never offers an action that a guess says will fail.

`probeProjectMapOpenPiHost` is the one place that runs a subprocess for availability — a bounded `tmux -V` with a sanitized environment — and returns the version; the predicate receives that result as input, which keeps the predicate deterministic and free of the real binary. The host is `tmux` in this version; desktop terminal emulators are an explicit non-goal until their behaviour can be verified for real, and the tmux integration tests skip themselves where the binary is missing.

`planProjectMapOpenPi` builds an inert request and starts nothing. It carries the exact `argv` array (never a shell string, so no capability-derived value can be interpolated), the capability worktree as `cwd`, the structured handoff, the named `project-map-open-pi-<capability-id>` session, the printed attach command, and the launcher resolution: the package-local `bin/gentle-shell.mjs` through the running Node first, a verified `PATH` entry second, and a named `launcher-unavailable` refusal when neither exists. An occupied session name is refused rather than reused.

The handoff is assembled from the approved map and the coordination projection, never retyped by hand: capability and outcome, approved surfaces, dependencies with their projected readiness, accepted contracts, feature documents, the parent session, and the verification requirements. The versioned map does not model per-capability verification requirements yet, so the handoff says `Verification requirements: not declared by the map.` rather than inventing a list.

`open` prints that plan and asks exactly once; a plan that already refuses is never confirmed. Two launch paths exist and the choice is visible, never a silent behaviour change: `Open in tmux (interactive session)` and `Start a background subagent instead`. When `tmux` is unusable, the background path is offered through its own affirmative confirmation that names the real refusal, and declining — or dismissing the prompt — leaves everything untouched. A context with no UI refuses rather than guessing, and a rejected dialog is reported as not confirmed rather than as a decline, because the user was never asked.

The fallback reuses the runner's argument construction (`childArguments`) instead of writing a second runner, with one deliberate change: the `--mode rpc` pair becomes `--print`. An rpc child is driven, and with no driver it reads EOF on standard input and exits without running a turn, so a detached background child runs its own one-shot turn and the handoff is appended as that turn's message; every other argument still comes from the shared contract. The child receives its capability and parent session through the environment, keeps the capability worktree as `cwd`, gets the parent's interactive-host signal stripped the way every subagent child does, and loads this extension so the receiver can write its own binding.

A launch is reported in two states and the second one is earned. At spawn time the report says the work is not confirmed. `confirmed` requires the child's own durable evidence: a canonical `session-binding` for exactly this worktree, written after this launch, with a fresh heartbeat. Nothing else confirms it — not a tmux session that exists, not a successful spawn, not a PID. A window that ends without that evidence is reported as `stayed unconfirmed`, with what was looked for and for how long. The observation runs detached from the command, because waiting for a child boot would freeze the command surface for an unbounded time, so the confirmation arrives as a later notification after the launch request on both paths.

Two limits belong here rather than in a footnote. The fallback is a detached one-shot launch, not `AgentRunner`: it installs no child markers, no IPC channel and no lifecycle supervision, because a runner-owned marker without a runner would misdescribe the process. And no real `pi` or `gentle-shell` child has been observed writing its binding in the test suite yet — the receiver is proven at the handler level and the evidence filter deterministically — so the end-to-end `confirmed` path stays unverified rather than implied.

## Approval

A map that omits `approval` is a draft: validation defaults the block to `{ "state": "draft" }`. The default is deliberately fail-safe, because a map must never become approved by omission.

`state: "approved"` requires both `approvedAt`, an ISO-8601 instant, and `approvedBy`, a non-empty actor identity. An approved map that omits either is a `missing-field` error, and one that supplies an unusable value is an `invalid-field` error. A `draft` map that carries `approvedAt` or `approvedBy` is an `invalid-field` error, because an approval record on a draft contradicts itself.

The approval state is the completeness gate for coverage. A capability's `surfaces` array may be empty while the map is a draft and must be non-empty once the map is approved. The `surfaces` field itself is always required, so a draft may declare "not yet determined" with an empty list but may not omit the field.

Approval is a declaration of plan authority only. It grants no source-write, review, delivery, merge, or destructive authority, and it starts no writer.

Identifiers are lowercase kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`) and no longer than 64 characters. Foundation and capability identifiers have independent namespaces. Identifiers must be unique within their namespace.

## Vocabulary

Lifecycle states, in their frozen v1 order:

- `done`
- `active`
- `review`
- `ready`
- `blocked`
- `planned`

Coverage surfaces, in their frozen v1 order:

- `productUx`
- `web`
- `api`
- `data`
- `security`
- `operations`
- `tests`

A capability must cover at least one surface once its map is approved, and cannot repeat a surface. A draft map may leave a capability's surface list empty. String-reference arrays cannot contain empty or duplicate entries. `foundationRefs` must resolve to a foundation, and `dependsOn` must resolve to a capability with no dependency cycle; each cyclic dependency group is reported once. Its diagnostic names every member of the group alongside one observed path inside it. That path is a witness for the group, so validate a repair by re-running validation rather than trusting the named path alone. `contracts` entries are structural in v1 and are not resolved.

## Feature-document references

`featureDocs` entries are repository-relative paths. POSIX absolute paths, Windows drive paths, Windows drive-relative paths such as `C:doc.md`, Windows UNC paths, rooted backslash paths, and paths containing a `..` segment are rejected before any filesystem access. A caller may provide a document-existence callback. Missing documents are errors by default, or warnings when `strictFeatureDocs: false` is selected.

## Canonical form

A valid map is canonicalized before it is returned or serialized, so the serialized bytes are independent of input key order. Root keys are ordered as `version`, `project`, `approval`, `foundations`, `capabilities`; project keys as `id`, `name`; approval keys as `state`, `approvedAt`, `approvedBy`; foundation keys as `id`, `outcome`, `state`, `evidence`; and capability keys as `id`, `outcome`, `foundationRefs`, `dependsOn`, `contracts`, `featureDocs`, `surfaces`, `state`. Foundations and capabilities sort by identifier. Coverage surfaces use the frozen surface order. `foundationRefs`, `dependsOn`, `contracts`, `featureDocs`, and foundation `evidence` sort lexicographically.

`validateProjectMap`, `parseProjectMap`, and `readProjectMapFile` never throw and form the malformed-input boundary. `canonicalizeProjectMap` and `serializeProjectMap` require an already valid `ProjectMapV1`.

Two predicates are exported so callers share one definition instead of restating the rules:

- `isIsoInstant` reports whether a string is a real ISO-8601 instant. It range-checks every component against the calendar the value claims to be in, because `Date.parse` alone normalizes rolled-over dates such as `2026-02-30` into March.
- `isSafeFeatureDocumentPath` reports whether a string is a safe repository-relative feature-document path, rejecting absolute, drive, UNC, rooted, and parent-escaping forms.

Serialization is exactly:

```ts
`${JSON.stringify(canonicalizeProjectMap(map), null, 2)}\n`
```

## Forbidden runtime fields

The versioned artifact must not contain mutable runtime-coordination fields. These fields are forbidden at every object level:

`session`, `sessionId`, `session_id`, `worktree`, `branch`, `lease`, `leases`, `heartbeat`, `heartbeats`, `claim`, `claims`, `blockers`, and `generation`.

## Diagnostics

| Code | Condition |
| --- | --- |
| `project-map/unsupported-schema-version` | `version` is a string other than the frozen v1 version. |
| `project-map/unknown-field` | An object contains a key outside its documented contract. |
| `project-map/forbidden-runtime-field` | An object contains a forbidden runtime-coordination field. |
| `project-map/missing-field` | A required field is absent, including an audit field on an approved map. |
| `project-map/invalid-field` | A value has the wrong type, fails its field rules, duplicates an array entry, uses an unsafe feature-document path, carries audit fields on a draft, or leaves an approved capability without a surface. |
| `project-map/duplicate-id` | A foundation or capability repeats an identifier in its own namespace. |
| `project-map/unknown-reference` | A foundation or capability dependency reference cannot be resolved. |
| `project-map/dependency-cycle` | Capability dependencies contain a cycle. |
| `project-map/missing-feature-document` | The supplied existence callback cannot find a referenced feature document. |
| `project-map/invalid-json` | Project Map text cannot be parsed as JSON. |
| `project-map/unreadable-artifact` | The Project Map artifact cannot be read from disk. |
