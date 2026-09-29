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

A project declares its roadmap in `openspec/config.yaml` with the canonical nested form:

```yaml
project_map:
  roadmap: <repository-relative .md path>
```

The dotted `project_map.roadmap: <path>` spelling is also accepted. When a declaration is repeated, the last usable declaration wins, and a blank value leaves an earlier declaration standing. The declared document is the only capability source and may live outside `odd/tasks/`; the other task documents are still read for reference but contribute no capability. Without the key, every top-level work unit of every `odd/tasks/*.md` remains a capability source, and the generated map records that fallback and its potentially mixed granularity in its assumptions.

A project can also map its own repository paths to the frozen surface vocabulary:

```yaml
project_map:
  surfaces:
    web: apps/web/
    api: apps/api/, packages/contracts/
    data: packages/database/, supabase/migrations/
    operations: docs/operations/
    tests: tests/
```

Each value is a comma-separated list of path prefixes; that string form is the declared shape. A YAML flow list such as `[]` is not parsed as a list: it is one literal prefix, so declared paths do not match it and are reported as unmatched. When this mapping contains at least one usable prefix, the generator reads each capability's body and finds the first line that, after an optional list marker is stripped, begins with the bold `**Allowed edit surfaces:**` marker. The marker accepts its colon inside or immediately after the closing bold marker. Only backticked spans on that line are paths; prose is ignored. Each path maps to the surface with the longest matching prefix, and the resulting unique surfaces use the schema's canonical order. A capability without that line keeps `surfaces: []`; the generator never guesses. An unmatched path is reported once per capability with every unmatched path. Every unsupported `project_map.surfaces.*` key the reader recognises is reported whether it has a value or is bare, and every known lowercase surface with no usable value — a bare key or an empty quoted value — is reported as blank; a camel-cased name such as `productUx` must carry a value to be seen at all, because a bare key is a nesting level to the configuration reader. A fully matched declaration produces no surface-specific omission. Without a usable mapping, derivation is off and surfaces remain empty.

Two rules keep a generated draft honest:

- A foundation is `done` only when its named structured source carries a well-formed declaration of it, so `done` means declared, never verified. A declared script must be a usable command string, not merely a key.
- The generator never invents a capability. It derives one only from a work unit a supplied ODD document actually declares, and it reports the absence of capabilities as an omission. A document whose path is not repository-relative is skipped with an omission rather than recorded as a feature document.

When ODD task documents are supplied, every top-level, unindented line of the form `- [ ] **ID — Title**`, `- [x] **ID — Title**`, `- [X] **ID — Title**`, or `- [~] **ID — Title**` becomes a capability. Text after the closing `**` is read as part of the same work unit. The markers mean `planned`, `done`, `done`, and `active` respectively; the checkbox is a declaration of completion, not verified progress. `outcome` keeps the complete bold label as the document wrote it, with whitespace collapsed, while `id` normalizes the title after the first `—` (or the whole label when there is no separator). A normalized title longer than 64 characters is truncated at a word boundary when at least two words fit; otherwise it falls back to at most its first 64 characters, trimming a trailing separator so the result remains a valid identifier rather than being dropped. The declaring document becomes the feature document. Documents are processed in path order, so a repeated capability identifier keeps its first declaration and reports the collision. A document that declares no readable work unit, a title that cannot become an identifier, and a top-level checkbox with a bold label the generator cannot read are all reported as omissions. Indented checkboxes are not work units and are not read.

Without a usable `project_map.surfaces` mapping, a generated capability leaves its surface list empty and the draft relies on the approval contract allowing that absence before approval. With a mapping, the body declaration above supplies the list instead.

Every generated map is a draft. The generator never marks a map approved, and it returns a canonicalized draft, so the map it hands a caller is exactly what `validateProjectMap` returns for it.

## Command surface

`/gentle:project-map` (`extensions/gentle-project-map.ts`) is the human entry point, with thirteen validated sub-actions:

- `ensure` is the **default**: an empty argument routes here, and it is also typeable by name. With a valid artifact it makes the card visible for this session and reports the map; without one it runs the generation flow below. It is the one gesture the feature is named after, so a bare command is the default rather than a usage error.
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
- `translate` reports what the Spanish explanation still needs, with the body hash to copy and the exact shape to write, as described under *Explaining a capability*; it writes nothing.

An unknown sub-action lists the valid ones and writes nothing. **Every sub-action that acts outside the artifact is gated behind an explicit opt-in.** `worktree provision`, `open`, `lead claim`, `lead renew`, `contract propose`, `contract accept`, `contract reject` and `integrate` (it issues a `readiness-receipt`, and a receipt is a store write) are refused with `project-map/executable-disabled` until `GENTLE_PI_PROJECT_MAP=1` — or `true`, or `on` — is set; the refusal names the switch and its accepted values, and quotes an unrecognized value back instead of ignoring it. Reads (`status`, `show`, `hide`, `translate`, `worktree inspect`, `worktree list`, `lead status`, `contract list`) and `lead release` are never gated: refusing to release a claim while the switch is off would strand the very state the switch protects. The gate is a single predicate (`projectMapExecutableEnabled`) in `lib/shell-project-map-gate.ts`; a sub-action's own usage error is still reported first, so the gate never masks a typo, and the check sits before any work, so a refusal writes nothing. **The report carries one flag, and it means one thing: something durable changed.** `wrote` is `true` for the map artifact on the planning routes, for the shared store on the coordination routes (`lead claim|renew|release`, `contract propose|accept|reject`) and for the worktree and its binding on `worktree provision`. A refusal, a decline, a cadence refusal, a no-op apply and a read all report `wrote: false`. The distinction matters on the recovery path: a stale claim recovered by the next session reports `wrote: true` **and** its `stale-claim-recovered` warning, because the claim did move — a report that says nothing happened while the store changed hands is worse than no report.

An approval without an actor is refused, because an approval nobody can attribute is not auditable. A declaration refuses an unknown or repeated surface and names the frozen vocabulary; it also refuses an approved map, because declaration is a draft-time action and no plan-preserving return to draft exists. The transition takes its timestamp as an argument rather than reading the clock, so the tests inject it; the command is what supplies the current time. Every artifact-writing sub-action re-reads the artifact after its confirmation: when the file changed while the decision was pending, the write is refused and the change reported instead of clobbering the other writer.

**Generating the plan shows what it is about to write, and asks through the same confirmation every other write in this command uses.** Both entries that generate — `ensure` when no usable map exists, and `draft` — print the derived plan first (the project, its counts, the assumptions and the omissions) and then ask with a two-option dialog: the human accepts or rejects the write rather than typing an answer, and a dialog that is dismissed is not an acceptance. When an artifact exists but does not parse, the summary names it and its diagnostics before offering to replace it, because that is the difference between a regeneration the human asked for and a silent overwrite. A missing artifact is the first-run case and needs no warning. Without a UI the answer is never an acceptance, so the feature never writes itself. `worktree provision` writes no artifact; it re-inspects the plan's compared facts under the store lock and refuses when they changed.

## Sidebar card

The Project Map card is a read-only rendering of the artifact. It distinguishes an empty artifact, an invalid artifact, a draft map, and an approved map; draft and approved are visible in the subtitle so a draft never reads as approved. A missing or unreadable artifact renders empty, while a malformed JSON artifact renders invalid with its diagnostic: the card shows the first three diagnostics and then points at `/gentle:project-map status` for the full report, so a long list cannot crowd out the map. Ready maps group Foundations (when declared) and Product capabilities. Each group header shows its done/total indicator and state: `▾ Foundations 2/3` is expanded and `▸ Product capabilities 6/12` is collapsed. Each capability row paints the label the document wrote (`outcome`), carries its lifecycle glyph and declared surfaces, and shows `—` when it declares none — the same absence vocabulary Coverage uses, because undeclared is never a zero. It also carries a **`?` marker left of that glyph**, which explains the capability (below), and — when the capability can be opened right now — a **`✿` between the `?` and the glyph**, which opens it (below). The identifier (`id`) remains the key for selection and the launchable set.

Coverage counts every capability that declares a surface in its denominator, and only the `done` ones in its numerator. Each declared value explains the contributing capabilities and their glyphs by identifier, for example `Web 67% (2/3): auth ✓, search ✓, billing ✕`. With `project_map.surfaces`, Coverage therefore shows a share for every surface the roadmap declares. A surface that no capability declares renders as unknown (`—`), never `0%`: undeclared is an absence of evidence, not evidence of absence.

In fullscreen, clicking a group header toggles that group alone. Clicking a capability selects it; clicking the selected row clears it. **A capability row is built as one truncated line and is never wrapped by choice**; below the markers' own floor it can still exceed the available width, and its measurement is characters rather than terminal cells. The identifier remains in the row's click metadata and the `?` explanation prints it in full. The selected row replaces its two-space indent with `▸ ` while preserving its lifecycle glyph. `alt+m` folds both groups when either is expanded and unfolds both when they are already folded. Set `GENTLE_PI_PROJECT_MAP_KEY` to bind a different shortcut; an empty value uses `alt+m` and `off` disables the shortcut. `alt+j` and `alt+k` move the capability selection forward and backward without wrapping, expanding a collapsed capabilities group when the selection moves onto a row it would hide; set `GENTLE_PI_PROJECT_MAP_NEXT_KEY` or `GENTLE_PI_PROJECT_MAP_PREV_KEY` to rebind them, with the same empty-value and `off` behavior. The collapse key is shown in the card top rule when it fits.

### Explaining a capability

**A capability's `outcome` is its complete bold work-unit label**, with whitespace collapsed, while its `id` normalizes the title after the first `—` (or the whole label when there is no separator). The label ends at the first closing `**`: internal emphasis therefore keeps only the head, which is the reader's own boundary. The identifier may be truncated at a word boundary when at least two words fit, or fall back to at most its first 64 characters with a trailing separator trimmed otherwise, so the outcome preserves the document's own functional-point label even when the id is shorter. What a capability *is* lives in the document it came from, as the indented body under its top-level, unindented work unit's checkbox line, which the generator reads past. Text after that line's closing `**` remains part of the work unit; an otherwise unreadable top-level checkbox with a bold label is reported as an omission rather than silently ignored.

The `?` marker on each row answers that. **Clicking it explains the capability**, and `alt+e` explains the selected one without a mouse — set `GENTLE_PI_PROJECT_MAP_HELP_KEY` to rebind it, with the same empty-value and `off` behavior as the other keys. The marker has its own click target: explaining a capability is not selecting it, and a click that lands on the marker leaves the selection where it was.

**The explanation is an overlay, and it speaks Spanish.** It carries the facts the map declares (state, surfaces, foundations, dependencies, contracts, documents, and the **static blockers** the retired Inspector alone used to show) and then what the document says, wrapped rather than truncated, scrollable with the arrow and page keys and closed with `esc`, `enter` or `ctrl+c`. It opens centered at the command palette's own 70% when no rail owns the host; with the fullscreen rail active it anchors left and reserves the rail's columns, so explaining a row never covers the card that row lives in. Its own words are Spanish and the state next to the id is translated for display only; the map keeps its frozen English values everywhere else. The outcome is left out only when it normalizes to the capability's own id, which remains true for a plain label without a prefix. A document the map names but that declares no matching work unit, or declares one with no body, is stated as such instead of being papered over.

**The description can be Spanish without the document being rewritten, because the translation is made once and stored.** The extension cannot translate — the overlay opens from a synchronous path and an extension has no model call — so `/gentle:project-map translate` reports the work instead of doing it: for every capability whose body has no current translation it prints the capability id, the document, and the **hash of the body the reader extracted**, plus the exact shape to write. An agent reads those documents, translates each work unit's title and body, and writes `openspec/project-map.es.json`. The explanation then shows the translation, translated title included, and never shows a stale one: the hash identifies the body that was translated, so a body that moved falls back to the document's own words. **The label's head survives the substitution**: the functional point's code stays in front of the translated title, and a stored title that already carries that code, in any spacing, is not given it twice. An English paragraph in the Spanish frame is explained rather than mysterious — the modal states `Traducción: no generada` or `Traducción: desactualizada, el documento cambió` and names the command. Nothing about the map, the artifact or the store changes: the translation is a sidecar, and the file is deliberately not part of the artifact's schema.

The overlay opens on a **click**, not on hover, for two reasons. The card lives inside the rail and its pointer handler is synchronous: it can paint, but the overlay is an awaited host call it cannot make. And a modal that opened on hover would stay open after the pointer left the row, because nothing on the card can close it. A hover treatment for the marker — highlighting it, and previewing the description on one line inside the card — is **not implemented**; it is recorded as follow-up work in the unit document, and it would only ever paint where pi-tui delivers a plain move event, which `tmux`, `zellij` and `screen` do not: the same platform limitation every other hover in this shell has, and clicking works there exactly as before.

**The card has no Inspector.** It used to append one after Coverage for the selected capability, thirteen lines at the very bottom of a rail whose viewport shows far fewer, so it was effectively invisible and almost entirely a duplicate of the `?` explanation. It was retired, and the one fact only it carried — the static blockers: the capability's own `blocked` declaration plus the foundations and dependencies it references that are not `done` — now travels with the explanation. Retiring it also removed the card's most expensive work: the real readiness predicate it alone needed on every selection change. When selection changes, the fullscreen rail reveals the selected rendered row only if it is outside the current viewport.

The rail digest is derived from the rendered descriptor (title, subtitle, tone, and body), so it moves when the descriptor moves, including on a collapse, a selection, or a change in which capabilities can be launched. Width-dependent clipping happens inside `renderCard`, with width already part of the section cache key. In fullscreen, the card occupies the `project-map` rail slot; the reserved rail order is `footer` → `agents` → `todo` → `project-map`, and the `agents` slot is omitted while nothing is registered there, which is why the visible rail reads Status → Todos → Project Map. The card paints the theme's own card frame — the rose look Status and Todos use — and carries its approval state in the subtitle, so the frame never has to encode it. Below the sidebar breakpoint and in regular mode, the same card appears collapsed below the editor as a single line: the `done/total foundations · done/total capabilities` summary when the artifact is ready, and otherwise the first body line, collapsed with an ellipsis when the body has more than one line. An empty artifact therefore still announces `No Project Map at openspec/project-map.json.`, and an invalid one still announces `The Project Map artifact is not valid:` rather than vanishing with the rail; both are clipped to the available width, and the diagnostics themselves stay in the fullscreen card and in `/gentle:project-map status`.

Visibility, collapse, and selection have no persisted setting. A ready artifact is visible by default; an empty or invalid one stays out of the rail until `show`. `show` and `hide` apply only to the current session, and the next session recomputes visibility from the current artifact.

### Opening a capability from the card

A capability row carries a `✿` between the `?` and its lifecycle glyph **exactly when the capability can be opened right now**, and the row is byte-identical to today's when it cannot: no disabled state, no placeholder column. The marker is painted with the theme's `accent` role — the same glyph and role the shell's brand and prompt petal use — so it follows the configured theme and needs no patched font. Clicking it reports the capability and the extension runs `open <capability-id>` unchanged: the same plan, the same single confirmation, the same launch. The click does not select the capability, exactly like the `?` marker, so the selection stays where it was. The set behind the marker is read once for the whole card, memoized for the same two-second window the session-tab row uses, and a stale window can only show or hide a marker; the click always re-runs the real plan.

### Surface declaration loop

Without a usable `project_map.surfaces` mapping, a generated draft declares no surfaces and the approval gate requires them. A declared mapping derives the roadmap's surfaces before this manual loop. Complete any remaining draft gap before approval through the command:

1. Run `/gentle:project-map` (or `/gentle:project-map draft`) and accept the confirmation.
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

`open <capability-id>` starts one session in the capability worktree and nothing else. It is the only sub-action that starts a session, and it does not commit, push, create a PR, merge, delete a branch or worktree, or write an artifact.

`projectMapOpenPiReadiness` composes the readiness gate and names every disqualifier as a diagnostic instead of returning a boolean: `capability-not-found`, `capability-not-approved`, `capability-done`, `capability-blocked`, `dependencies-not-ready`, `open-blocker`, `proposed-contract`, `host-unavailable`, and `worktree-not-provisioned`, alongside the refusals the worktree plan already names. Two refusals live in the plan rather than in readiness, because they are properties of the transport and not of the capability: an unresolvable launcher (`launcher-unavailable`) and an occupied session name (`session-name-occupied`). **Launchability is derived from evidence, not declared:** the map's `state` only refuses when it says `done` or `blocked`, and a `planned`, `active` or `review` capability is openable as soon as its dependencies are ready, it has no open blocker and no proposed contract awaiting decision, and its worktree exists. That is what makes the executable half reachable at all, because no sub-action writes `state` and the generator only ever produces `planned` or `done`. The launch target must exist: a worktree plan of `create` means provisioning has not happened yet, so the action stays absent until `worktree provision` runs. The card's `✿` marker is the cheap projection of the same predicate — one coordination read plus the worktree bindings, without the git re-verification the plan performs — so it can over-report by one provisioning detail, and the click always re-runs the real plan and reports its reasons.

The card's `✿` marker is the offer, and it is absent rather than disabled, so the map never shows an action that a guess says will fail. `projectMapOpenPiDecision` is what makes the gate part of that guess: while the opt-in is off the capability is not in the launchable set, and clicking a marker always re-runs the real predicate, which names `project-map-open-pi/executable-disabled` with the same message the command prints.

A launch forwards the opt-in to the child explicitly, through the same `tmux -e` door the launch identity uses, because tmux forwards no client variable of its own. The child session therefore starts with the executable half enabled in the capability worktree — which is the only place it can be reached, since `open` is itself refused while the gate is off.

`probeProjectMapOpenPiHost` is the one place that runs a subprocess for availability — a bounded `tmux -V` with a sanitized environment — and returns the version; the predicate receives that result as input, which keeps the predicate deterministic and free of the real binary. The host is `tmux` in this version; desktop terminal emulators are an explicit non-goal until their behaviour can be verified for real, and the tmux integration tests skip themselves where the binary is missing.

`planProjectMapOpenPi` builds an inert request and starts nothing. It carries the exact `argv` array (never a shell string, so no capability-derived value can be interpolated), the capability worktree as `cwd`, the structured handoff, the named `project-map-open-pi-<capability-id>` session, the printed attach command, and the launcher resolution: the package-local `bin/gentle-shell.mjs` through the running Node first, a `PATH` entry whose file exists on disk second, and a named `launcher-unavailable` refusal when neither exists. An occupied session name is refused rather than reused.

The handoff is assembled from the approved map and the coordination projection, never retyped by hand: capability and outcome, approved surfaces, dependencies with their projected readiness, accepted contracts, feature documents, the parent session, and the verification requirements. The versioned map does not model per-capability verification requirements yet, so the handoff says `Verification requirements: not declared by the map.` rather than inventing a list.

`open` prints that plan and asks exactly once; a plan that already refuses is never confirmed. Two launch paths exist and the choice is visible, never a silent behaviour change: `Open in tmux (interactive session)` and `Start a background subagent instead`. When `tmux` is unusable, the background path is offered through its own affirmative confirmation that names the real refusal, and declining — or dismissing the prompt — leaves everything untouched. A context with no UI refuses rather than guessing, and a rejected dialog is reported as not confirmed rather than as a decline, because the user was never asked.

The fallback reuses the runner's argument construction (`childArguments`) instead of writing a second runner, with one deliberate change: the `--mode rpc` pair becomes `--print`. An rpc child is driven, and with no driver it reads EOF on standard input and exits without running a turn, so a detached background child runs its own one-shot turn and the handoff is appended as that turn's message; every other argument still comes from the shared contract. The child receives its capability and parent session explicitly. On the interactive path the identity travels as a `tmux new-session -e` argument, because `tmux` does not forward a new client variable to a session it creates — measured against tmux 3.6, where an exported parent variable is reported as unknown inside a session created from that parent — and that argument is what lets the child's receiver write its own binding. The consequence to know is that the tmux child inherits the tmux server's environment, not the parent process's, so a variable that exists only in the parent does not reach it; the fallback child does receive the parent's sanitized environment, with the interactive-host signal stripped the way every subagent child gets it.

A launch is reported in two states and the second one is earned. At spawn time the report says the work is not confirmed. `confirmed` requires the child's own durable evidence: a canonical `session-binding` for exactly this worktree, written at or after this launch instant (compared as instants, not as strings, so an offset timestamp cannot slip through), with a fresh heartbeat written by the same pid. Where the host reports the launched child's pid — the background path does, the tmux wrapper does not — the binding must carry that pid, so the evidence is that child's; on the tmux path the evidence identifies the worktree, and the observation says exactly that instead of implying an identity it cannot establish. A window that ends without that evidence is reported as `stayed unconfirmed`, with what was looked for and for how much polling. Because a heartbeat is only fresh while its process lives, the confirmation is observable while the child is running, and the observation window has to cover the child's boot. The observation runs detached from the command, because waiting for a child boot would freeze the command surface for an unbounded time, so the confirmation arrives as a later notification after the launch request on both paths.

The end-to-end path was observed with real children on 2026-09-26: a background `pi --print` child whose binding pid matched the spawned pid, and a tmux session whose `gentle-shell` child wrote its own binding and heartbeat after its identity arrived through `-e`. Those observations are one-off evidence rather than suite coverage, because the suite starts no real model call; the identity delivery itself is pinned by a skip-guarded integration test that runs the real plan against a real tmux server, and the evidence filter is pinned deterministically.

Three limits belong here rather than in a footnote. The fallback is a detached one-shot launch, not `AgentRunner`: it installs no child markers, no IPC channel and no lifecycle supervision, because a runner-owned marker without a runner would misdescribe the process. `confirmed` on the tmux path used to prove only that a live session bound itself to this worktree at or after the launch; it now also proves it is **this launch's** child, because each launch generates a nonce, the child writes it into its own binding, and the confirmation accepts only a binding carrying exactly that nonce. The field is optional in the schema so no binding written before it existed is reported as corrupted, and a launch that expects a nonce treats a binding without one as no evidence at all. And the worktree-path comparison is lexical (`resolve`), so a symlinked alias of the same worktree stays unconfirmed instead of wrongly confirmed.

## Orchestrator session tabs

While the card is mounted, the map extension contributes one header row naming every session this repository has working, and clicking a capability in that row paints its read-only detail below the card in the rail. The layer only reads: it holds no claim, no lease and no heartbeat of its own, and it adds no field to the map or to the store.

**A tab exists because the store ties a session to a capability of this repository.** The sources are the coordination projection (capability, session, lease status, heartbeat freshness, open blockers, next safe action), the `worktree-binding` records (branch and worktree root) and the approved map (objective, declared surfaces, declared state). Ambient presence never creates a tab. A capability the approved map does not declare is dropped and named as a warning rather than rendered without surfaces.

**Liveness has one precedence rule.** Presence is authoritative when it is available — a session present on this machine is `live`, one that is absent is `stale` — and the store's own lease status decides when presence is unavailable. Presence keys a session by `sha256(sessionId)`, so that hashing lives in the adapter that knows the format and never in the projection.

**The row is grouped by the map's surfaces, and only live surfaces get a section.** A capability appears under each surface it declares, in the schema's own surface order, and a surface renders while at least one session bound to one of its capabilities is live. A surface whose only sessions are stale renders no section, so the row shows what is running rather than everything that ever ran. Inside a rendered section a stale session stays visible and marked, because dropping it would make a dead session indistinguishable from a live one. Two sessions on one capability collapse into one item carrying `×2`; the detail folds the same capability's per-surface repetitions back into one session list. The row is composed and then measured with `truncateToWidth`, so a narrow terminal drops its tail with an ellipsis instead of wrapping, and a click is resolved against the columns actually painted — the dropped tail is not clickable, while the visible head of a partially shown item still is.

**The row and the detail reach the screen through two different doors, because neither surface accepts a second owner.** The header region is single-owner (`sidebarHeader` replaces whatever was there), so the extension registers a **header contributor** instead of a part, and the owner paints the contributed rows above its own, folds their digests into the header digest, and routes a click by the row group it landed in — a contribution that paints nothing leaves the header's own rows, and the `usage` segment's click, exactly where they were. The rail is worse: its sections are a closed list, so a second card cannot register at all. The detail therefore lends its rows to the map card through an optional `ProjectMapCardDetail`: read-only lines painted below the card, folded into the rail digest, and never given a click, which is why the card's own hit indices keep their meaning.

**The store is read at most once per two-second window, not per frame.** A coordination read scans a directory per record kind and one per capability, and presence pages are bounded in megabytes, which is far heavier than the single artifact the card itself re-reads on every render. A read that fails becomes an unavailable row with a diagnostic instead of an exception escaping into a render, and a store root that cannot be resolved leaves the row and the detail absent rather than failing the card. Hiding the card releases both: the contribution is disposed with it.

Selecting a tab never moves you out of your own session. Nothing in this layer focuses a window, attaches to another session, resumes one, or writes into another worktree.

## Integration readiness

`integrate` answers the question a user has at the end of parallel work — which capability can be integrated next, and what is the evidence? It orders the capabilities that are not `done` so that a dependency always precedes the capability depending on it, breaking ties by id, and reports every one of them with what verified, what mismatched and what stayed unverified. It never writes to the repository, the map or a branch: every Git call is a query, nothing is staged, merged or resolved, and the report's last line says that readiness grants nothing.

**The checks are nine, seven of them gate, and two are reported.** `dependencies`, `contracts`, `blockers` and `coverage` come from the coordination projection; `verification` is the project's own test command read from `openspec/config.yaml`, accepting both shapes a project may declare it in — the nested OpenSpec rule block this repository's own `sdd-init` writes (`rules.apply.test_command`) and a flat top-level `apply.test_command` — with the nested path winning when both are present, because that is the one the project writes; `freshness` and `conflicts` come from Git; `tasks` compares the feature document's checkboxes against the declared state; and `review` is reported but **never gates**, because review evidence is evidence and not authorization. **`coverage` is reported and never gates either, because it is this run's own output**: it states whether a readiness receipt already exists, and gating on it made the first receipt unreachable from inside the product — the only issuer of a receipt is the run that would have had to satisfy it. A check is `verified`, `mismatched` or `unverified`, and **nothing absent is ever read as verified**: a candidate nobody verified is not ready, and an unverified check prints the reason it is unverified. The report prints the gating set's `verified` and `mismatch` lines and then the evidence line, `coverage: a readiness receipt already covers it` or `coverage: no readiness receipt recorded yet`.

**Freshness separates *old*, *diverged* and *unanswerable*.** The integration target is the branch the main worktree is on — the first entry of `git worktree list`, the primary checkout. A branch base the target no longer contains means the branch has diverged and is a mismatch; a base that is merely behind is verified, and the report names how far behind it is. A query that could not run is neither: `git merge-base --is-ancestor` exits `1` for a genuine non-ancestor but fails just as loudly when the revision or the object is unreadable, so only exit code `1` is read as divergence and every other failure stays `unverified` with its reason, because reporting a broken query as divergence would claim something Git never said. A detached main worktree, or a list that cannot be read, leaves the target unknown, and everything that depends on it stays unverified rather than guessing.

**Likely conflicts are changed-path overlap between candidates, measured against the target's merge base**, and the label is exact: `mismatched` on that check means *a likely conflict was detected*, never *a conflict was proven*. The shared paths are named and sorted. Real conflict probing — a scratch worktree, `merge-tree` — is deliberately out of scope: it writes, and the question here is which candidate to look at first, not to decide for the human.

**Map/task drift is reported and never corrected, in either direction.** A capability declared `done` whose document still has open tasks is a mismatch, and so is a document whose every task is done while the map does not declare it done. A capability in flight with some tasks done agrees, because that is what in flight looks like. A declared feature document that cannot be read is a mismatch rather than a silent pass, and a capability that declares no document stays unverified with the reason named.

**A ready candidate earns a `readiness-receipt`, and the record carries `authority: "none"`.** The first receipt is issued by the first `integrate` run that finds a candidate ready, so a fresh store is not a dead end; each later run records its own evidence, and the receipts accumulate because the record is append-only. The notification repeats that a receipt is evidence, not permission: commit, push, PR and merge stay ordinary repository policy.

**One limit is worth stating plainly: review evidence cannot be attributed to a capability today.** The review store records candidates — trees, lineages, revisions — and nothing in it links a lineage to a branch or a capability. Rather than invent a mapping, the review check stays `unverified` for every capability and the report prints exactly why. Attributing review evidence to a capability would need either a field in that store or a convention, and that is a decision nobody has taken yet.

## Rollout, recovery and cleanup

**A project opts in by acquiring a map, one artifact at a time.** `/gentle:project-map` with no argument is enough: it generates the plan when there is none, shows it, and writes `openspec/project-map.json` only after you accept the confirmation dialog — creating the `openspec/` directory when it does not exist. The generation reads `package.json`, `openspec/config.yaml` and `odd/tasks/*.md`, shows what it assumed and what it could not resolve, and is the same flow `draft` runs on its own. `declare <capability-id> <surface>...` then completes each capability and `approve <actor>` moves the map to `approved`; neither is needed to see the card, because a draft renders in full. Measured against real temporary projects, the delta of that whole loop is one file: `openspec/config.yaml`, existing `odd/tasks/*.md` documents, `docs/`, and an already-initialized coordination store are byte-identical afterwards. Regenerating the draft replaces the artifact and returns a draft, so a previous approval does not survive it.

**The executable half is opt-in, and disabling it undoes nothing.** `GENTLE_PI_PROJECT_MAP=1` — or `true`, or `on` — enables worktree provisioning, opening Pi, and every write to the coordination store; without it those routes are refused with `project-map/executable-disabled`, and the message names the switch and its accepted values. Turning it back off is the entire rollback for the runtime half: no file is deleted, no branch or worktree is removed, and the artifact, the store records and every worktree stay exactly where they were. Reads (`status`, `show`, `hide`, `worktree inspect`, `worktree list`, `lead status`, `contract list`) and `lead release` never need the switch, so a claim taken while it was on can always be released while it is off.

**Turning the feature off is two independent choices, and neither is destructive.** Stop providing the artifact and the card has nothing to render — a missing artifact is an empty state, not an error — while the command surface stays available for initializing one later. Leave the artifact and the map stays a readable plan. The coordination store lives under the Git common directory (`<common dir>/gentle-ai/project-map/`), never inside the working tree, so `git status` never shows it and removing a worktree does not touch it.

**Recovery: what to do when a session died.**

1. `lead status`, `contract list`, `worktree list` and the card's tabs row say what state the repository is in; a heartbeat older than 60 seconds marks a session stale, and a claim whose `renew_by` has passed is stale too.
2. Nothing has to be repaired by hand. The lease expires and the next `lead claim` takes the claim over, reported as a recovery with the `project-map-store/stale-claim-recovered` warning naming the previous holder and its `renew_by`. Recovery replaces the claim and deletes nothing: the store keeps every record it held.
3. A record that rotted — a claim, a contract, a blocker, a heartbeat, or the store descriptor — is refused on read with `project-map-store/store-corrupted` and preserved byte for byte. Nothing repairs it in place. Quarantine is an explicit operation (`quarantineProjectMapStore`), and re-initializing over a store requires the emptiness proof rather than an assumption.
4. A worktree left behind is named by `worktree list` and re-planned by `worktree inspect <capability-id>`. Removing it stays a human decision (`git worktree remove`), never an automatic one.

**Observability is the report, the receipts and the store.** `status` gives the approval state and counts; `integrate` prints every candidate with each check's state and its reason and names the next safe action; a verified candidate's `readiness-receipt` records which checks were verified and carries `authority: "none"`; and the store's records carry the generation tuple, the claims, the leases and the heartbeats a human would otherwise reconstruct from memory. The feature adds no telemetry lane of its own.

**Known limitations before stabilization.** Both defects found by the PM-9 end-to-end pass are closed, each by its own candidate: the readiness gate could not produce its first receipt from inside the product (fixed by moving `coverage` out of the gating set, since it is the run's own output), and a successful stale-claim takeover was reported as a refusal with `wrote: false` while the store had already changed hands. Both scenarios in `tests/project-map-e2e.test.ts` that pinned them are now their regression guards. The remaining debt in this area is informational: review evidence still cannot be attributed to a capability, because the review store records candidates rather than capabilities.

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
