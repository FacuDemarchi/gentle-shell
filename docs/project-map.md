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

`/gentle:project-map` (`extensions/gentle-project-map.ts`) is the human entry point, with six validated sub-actions:

- `status` reads the artifact and reports its approval state and counts. It never writes.
- `draft` reads the repository sources, generates a draft, shows the assumptions and omissions it could not resolve, and writes only after an explicit confirmation. It replaces whatever the artifact held, an approved map included, so it is not a way to edit an approved plan in place.
- `declare <capability-id> <surface>...` replaces that draft capability's declared surface list with exactly the supplied surfaces, then writes only after an explicit confirmation. With no surface it clears the list back to not yet determined.
- `approve <actor>` reads the artifact, refuses when anything is incomplete, shows what it is about to record, and writes only after an explicit confirmation.
- `show` displays the Project Map card for the current session without writing the artifact.
- `hide` removes the Project Map card for the current session without writing the artifact.

An unknown sub-action lists the valid ones and writes nothing. An approval without an actor is refused, because an approval nobody can attribute is not auditable. A declaration refuses an unknown or repeated surface and names the frozen vocabulary; it also refuses an approved map, because declaration is a draft-time action and no plan-preserving return to draft exists. The transition takes its timestamp as an argument rather than reading the clock, so the tests inject it; the command is what supplies the current time. Every writing sub-action re-reads the artifact after its confirmation: when the file changed while the decision was pending, the write is refused and the change reported instead of clobbering the other writer.

## Sidebar card

The Project Map card is a read-only rendering of the artifact. It distinguishes an empty artifact, an invalid artifact, a draft map, and an approved map; draft and approved are visible in the subtitle so a draft never reads as approved. A missing or unreadable artifact renders empty, while a malformed JSON artifact renders invalid with its diagnostic: the card shows the first three diagnostics and then points at `/gentle:project-map status` for the full report, so a long list cannot crowd out the map. Ready maps group Foundations (when declared) and Product capabilities. Each group header shows its done/total indicator and state: `▾ Foundations 2/3` is expanded and `▸ Product capabilities 6/12` is collapsed. Each capability row carries its lifecycle glyph and declared surfaces.

Coverage counts every capability that declares a surface in its denominator, and only the `done` ones in its numerator. Each declared value explains the contributing capabilities and their glyphs, for example `Web 67% (2/3): auth ✓, search ✓, billing ✕`. A surface that no capability declares renders as unknown (`—`), never `0%`: undeclared is an absence of evidence, not evidence of absence.

In fullscreen, clicking a group header toggles that group alone. Clicking a capability selects it; clicking the selected row clears it. A capability row whose rendered identifier wraps keeps every continuation line as part of its click target, so a long identifier stays selectable as one row. The selected row replaces its two-space indent with `▸ ` while preserving its lifecycle glyph. `alt+m` folds both groups when either is expanded and unfolds both when they are already folded. Set `GENTLE_PI_PROJECT_MAP_KEY` to bind a different shortcut; an empty value uses `alt+m` and `off` disables the shortcut. `alt+j` and `alt+k` move the capability selection forward and backward without wrapping, expanding a collapsed capabilities group when the selection moves onto a row it would hide; set `GENTLE_PI_PROJECT_MAP_NEXT_KEY` or `GENTLE_PI_PROJECT_MAP_PREV_KEY` to rebind them, with the same empty-value and `off` behavior. The collapse key is shown in the card top rule when it fits.

A selected capability appends an Inspector after Coverage. It shows the id and lifecycle state, outcome, declared surfaces, referenced foundations and dependencies with their glyphs, contracts, feature documents, and explicit `none` values for empty lists. Its blockers are static only: its blocked state plus non-done dependencies or foundations. The runtime overlay is explicitly unavailable until PM-4, so the Inspector never manufactures runtime claims, leases, or blockers. When selection changes, the fullscreen rail reveals the selected rendered row only if it is outside the current viewport.

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
