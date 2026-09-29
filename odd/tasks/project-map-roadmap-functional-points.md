# Project Map — the roadmap's functional points are the row

Status: **authorized 2026-09-29** by the maintainer's choice of the model. The user's words: *"no son las capabilities lo que quiero mostrar en el project map, si te fijas en el proyecto junglex, el mapa muestra los fp, funcionalidades en las que hay que ir avanzando, el project map debería de mostrar esas funcionalidades con su explicación en ?, etc. Por eso no te cierra el coverage, porque inicialmente este proyecto era para el desarrollo de funcionalidades separadas, en el caso junglex, la pagina principal, el carrito de compras, la sección para los comercios, etc."*

## Objective

Make a Project Map capability the *functional point the project's roadmap declares*, not every top-level checkbox line of every `odd/tasks/*.md`. The row shows the project's own label for that functional point, the `?` explains it from the roadmap's own body, and Coverage closes from the surfaces the roadmap already declares.

## Problem

Measured against `junglex` at `ffd8dfb`, whose map is `openspec/project-map.json` (draft, 27 capabilities):

1. **The granularity is mixed and the roadmap is the minority.** `readRepositorySources` (`extensions/gentle-project-map.ts:509-517`) hands every `odd/tasks/*.md` to the generator, and `extractWorkUnits` (`lib/shell-project-map-draft.ts:140-166`) turns each top-level checkbox into a capability. In junglex that produced 4 real functional points (`writable-catalog-…`, `real-geocoding-fail-closed`, `pilot-hardening-and-operator-runbook`, `verify-and-close-the-pilot`), plus sub-units of one document (`railway-the-api-service`, `domain-and-dns`, `close-the-gate`, `supabase-project-database-and-identity` = FP-1b.2/1b.3/1b.8/1b.1) and unit titles of feature documents (`DEL-1..5`, `OF-1..6`, `ODD-1..5`).
2. **Most functional points vanish with no omission.** `WORK_UNIT` (`lib/shell-project-map-draft.ts:25`) is `/^-\s\[([ xX])\]\s\*\*(.+?)\*\*\s*$/`: it requires the line to end at the closing `**` and accepts only `[ ]`, `[x]`, `[X]`. The roadmap writes `- [ ] **FP-1b — Provisioning** (blocked on accounts): …`, so FP-0, FP-0b, FP-1b, FP-2 and FP-3 are invisible; and it writes `- [~] **FP-6 — …**`, so FP-6 and FP-7 are invisible too. Seven of the twelve functional points produce no row and no omission line.
3. **A title over 64 characters is dropped.** `normalizeIdentifier` (`lib/shell-project-map-draft.ts:33-45`) returns `null` past `IDENTIFIER_MAX_LENGTH`, and the unit is skipped with an omission. `FP-0b`'s title normalizes to 68 characters.
4. **The row shows a slug, not the functionality.** `capabilityRow` (`lib/shell-project-map-view.ts:295-306`) paints `capability.id` because today `id` is the normalized title and the two are interchangeable. Once the row is a functional point, the project's own label is the thing to show.
5. **Coverage cannot close.** `projectMapCoverage` (`lib/shell-project-map-view.ts:119-126`) reports `declared`/`done` per surface for the capabilities that state the surface; the generator always writes `surfaces: []` (`lib/shell-project-map-draft.ts:160`) and declaring is a manual sub-action. The roadmap already declares which surfaces each functional point edits — `**Allowed edit surfaces:**` appears 9 times in `odd/tasks/first-merchant-pilot.md`, once per functional point — and nothing reads it.

The reader that explains a capability is **not** part of the defect: `readCapabilityDescription` (`lib/project-map-description.ts:40-51`) uses the tolerant `/^(\s*)-\s\[([ xX])\]\s\*\*(.+?)\*\*(.*)$/` and already sees the lines the generator refuses. Once the right rows exist, the `?` resolves them through the roadmap document with no change.

## Why

The map's whole purpose is to be the plan of record for parallel work: a capability is what a human opens a worktree for, declares surfaces for, approves and launches. A list of the roadmap's sub-tasks answers none of those questions — the sub-tasks of one functional point cannot be developed in parallel with each other, and a flat mix of two documents' levels makes "what is left" unreadable. The functional point is the unit that the roadmap already orders, estimates, declares surfaces for and reviews; making it the row is what makes the map true.

## Decisions

**D1 — The roadmap is declared by the project, in `openspec/config.yaml`.** A new additive key `project_map.roadmap: <repository-relative .md path>`. Only that document contributes capabilities. `readSimpleConfigEntries` (`lib/shell-project-map-draft.ts:84-118`) already resolves a nested bare key plus a valued entry to `project_map.roadmap`, and no validator rejects unknown keys in that file, so the key is inert for every project that does not declare it.

**D2 — With no roadmap declared, the generator keeps today's sources and says so.** It reads every top-level work unit of every `odd/tasks/*.md` as it does today and adds an assumption stating that no roadmap is declared, so granularity may be mixed. Rationale: the repository's own rule is that a requirement is never read from an absent declaration, and wiping every existing draft (49 capabilities here, 27 in junglex) on the next `draft` in exchange for nothing would be a destructive default. Adopting the roadmap is opt-in per project.

**D3 — The generator and the reader tolerate the same thing, in both directions.** Text after the closing `**` is read; a run of whitespace between `]` and `**` is read (the pre-slice pattern demanded exactly one space, so a document that wrote two was silently refused); `[~]` maps to `active` (the schema already accepts it, `lib/shell-project-map-schema.ts:9`) **and the reader's pattern accepts `~` too**, because a capability the generator creates from a document must be explainable from that same document. A top-level checkbox carrying a bold label whose marker or title neither can read becomes an omission: silence is the defect being fixed, not a style choice. The reader keeps its tolerance for indentation, which the generator deliberately does not have: the reader explains any work unit in a document, including a nested one, while the generator's row set is only the top level.

**D3b — A marker the line wrote must be visible in both paths.** Independent verification found the asymmetry: the generator accepted `[~]` while `lib/project-map-description.ts` still matched `[ xX]`, so the two active functional points of junglex's roadmap — FP-6 and FP-7, the ones in progress — would have been rows the `?` could not explain. The generator and the reader are one contract, so a marker added to one is added to the other in the same slice.

**D4 — A long title is truncated, not lost.** `normalizeIdentifier` cuts at a word boundary to at most 64 characters instead of returning `null`: whole words are joined while they fit, and the cut falls back to exactly 64 characters when a single word cannot fit or when only one word fits although more remain (otherwise `a-` followed by sixty-three characters would yield the single letter `a`). The reader normalizes the document's own title with the same function, so generator and reader cannot drift. Every identifier of at most 64 characters keeps its exact current value, and with it its translation entry; only titles that were being dropped change. **The project identity is the one exception**: a package name whose normalization exceeds 64 characters still refuses to produce a map, because a truncated project name is a different project and the map's identity must not be guessed by cutting it.

**D5 — `outcome` is the label as the document wrote it.** The whole bolded label with whitespace collapsed, e.g. `FP-0b — Local dev service-worker freshness`. `id` stays the normalized title, so the functional point's code is visible in the row without adding a schema field. The label ends at the first closing `**`, which is exactly the boundary the reader uses, so the generator and the reader agree even when a label carries internal emphasis: such a label keeps its head and the rest is trailing text. That limitation is recorded here rather than claimed away — it is the reader's own long-standing boundary, and no line in either repository's `odd/tasks/*.md` hits it (measured). When the explanation substitutes a stored translation for the label, the label's `PREFIX — ` head is preserved: the translated title must not silently drop the functional point's code.

**D6 — The row shows the functional point.** `capabilityRow` paints `capability.outcome`, middle-truncated to the row's real width. `id` remains the key for selection, the launchable set and Coverage.

**D7 — Surfaces come from what the functional point declares, through a mapping the project declares.** The generator reads the body line `**Allowed edit surfaces:**`, extracts the backticked paths, and applies `project_map.surfaces` (surface → path prefixes) to them. A declared surface with no matching prefix, and a path matching no rule, are omissions. Without `project_map.surfaces` the derivation is off and `surfaces` stays empty. Rationale: the repository's own principle is that an undeclared surface is an absence of evidence, never evidence of absence; a path→surface mapping is a project fact the tool must not invent, and a derived surface is a declaration the human can correct with `declare`.

## Scope

- The extraction rule in `lib/shell-project-map-draft.ts`: tolerance, marker vocabulary, `outcome`, identifier length, roadmap selection, surface derivation.
- The config key the generator reads: `project_map.roadmap`, `project_map.surfaces`.
- The source selector in `extensions/gentle-project-map.ts` so a declared roadmap outside `odd/tasks/` is read at all.
- The row's painted text in `lib/shell-project-map-view.ts`.
- The tests that pin all of the above, and `docs/project-map.md`.

## Non-goals

- Any schema change. The v1 contract is frozen and gains no `code`, `label` or surface-derivation field.
- A writer for `outcome`, `state`, `dependsOn`, `foundationRefs` or `featureDocs`. That is the handoff's open item 1 and it stays open.
- The coordination store, `open`, worktree provisioning, approval, and everything the executable half needs.
- Re-running the translation pass or re-keying `openspec/project-map.es.json`. The identifier rule preserves every identifier of at most 64 characters; the effect on the sidecar is reported, not acted on.
- Writing any project's `openspec/config.yaml`. Declaring the roadmap in junglex is one line and the maintainer's.
- A merge-preserving `draft` (handoff open item 4).

## Constraints

- Strict TDD (`openspec/config.yaml` declares `strict_tdd: true`): RED before GREEN, evidence recorded per slice.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons.
- No new runtime dependency, no new `lib/` file (`scripts/verify-package-files.mjs` and `tests/project-map-rollout.test.ts:168-185` pin the pack list bidirectionally).
- Single writer. One slice at a time; each slice is its own reviewable commit with code, tests and documentation together.
- No commit is pushed. The branch stays `feat/project-map-orchestration`, the initiative's umbrella, which already carries 23 unpushed commits; a separate branch would fragment one review set.

## Authorized edit surfaces

- `lib/shell-project-map-draft.ts`
- `lib/project-map-description.ts`
- `lib/project-map-help-modal.ts`
- `lib/shell-project-map-view.ts`
- `extensions/gentle-project-map.ts`
- `tests/shell-project-map-draft.test.ts`
- `tests/project-map-description.test.ts`
- `tests/shell-project-map-view.test.ts`
- `tests/shell-project-map-card.test.ts`
- `tests/project-map-help-modal.test.ts`
- `tests/gentle-project-map.test.ts`
- `tests/project-map-rollout.test.ts`
- `docs/project-map.md`
- `odd/tasks/project-map-roadmap-functional-points.md`

`lib/project-map-description.ts` and its test were added on 2026-09-29 by the first correction round: the reader is where the `[~]` asymmetry lived, and a slice cannot fix a contract in one half only. `lib/project-map-help-modal.ts` was added by the follow-up to the second round: its two module comments still asserted the pre-slice semantics (`outcome` is the work unit's title, so it repeats the id). Comments only; the component's behaviour is unchanged. `tests/shell-project-map-card.test.ts` was added for PMFP-3: the card composes the same rows the view renders, so a row whose text changes can move an assertion there even though no line of that test is about the map's data.

Any other path, including `lib/shell-project-map-schema.ts` and `scripts/verify-package-files.mjs`, is out of scope: a change there means the design drifted and the slice stops.

## Slices

| Slice | Deliverable | Files | Forecast |
| --- | --- | --- | --- |
| **PMFP-1 — a work unit is read as the document wrote it** | Tolerance for text after `**`, `[~]` → `active`, unknown top-level markers become omissions, `outcome` is the written label, a long title truncates instead of vanishing | `lib/shell-project-map-draft.ts`, `tests/shell-project-map-draft.test.ts`, `docs/project-map.md` | ~250 lines |
| **PMFP-2 — the roadmap is declared** | `project_map.roadmap` selects the only capability source; the declared document is read even outside `odd/tasks/`; no declaration keeps today's sources plus an assumption; a declared-but-unreadable or unsafe path is an omission | `lib/shell-project-map-draft.ts`, `extensions/gentle-project-map.ts`, `tests/shell-project-map-draft.test.ts`, `tests/gentle-project-map.test.ts`, `tests/project-map-rollout.test.ts`, `docs/project-map.md` | ~250 lines |
| **PMFP-3 — the row shows the functional point** | `capabilityRow` paints `outcome`; selection, launch and Coverage stay keyed by `id` | `lib/shell-project-map-view.ts`, `tests/shell-project-map-view.test.ts`, `docs/project-map.md` | ~120 lines |
| **PMFP-4 — Coverage closes from the declared surfaces** | `**Allowed edit surfaces:**` parsed from the functional point's body, `project_map.surfaces` applied, unmatched paths and surfaces reported | `lib/shell-project-map-draft.ts`, `tests/shell-project-map-draft.test.ts`, `docs/project-map.md` | ~280 lines |

## Acceptance criteria

1. With `project_map.roadmap: odd/tasks/first-merchant-pilot.md` over junglex's own documents, the draft declares one capability per functional point the roadmap's `## Tasks` section declares, and none of `railway-the-api-service`, `close-the-gate`, `DEL-*`, `OF-*` or `ODD-*`.
2. FP-0, FP-0b, FP-1b, FP-2 and FP-3, which today produce neither a row nor an omission, produce a row.
3. FP-6 and FP-7 (`[~]`) are extracted with state `active`.
4. No title is dropped for length: a title whose normalization exceeds 64 characters yields a capability whose `id` is at most 64 characters and whose reader lookup by that `id` still resolves.
5. Every top-level checkbox with a bold label that the generator cannot read appears in `omissions`, naming the document and the line's own text.
6. Without `project_map.roadmap`, no capability that is extracted today disappears, and an assumption states that no roadmap is declared.
7. With `project_map.surfaces` declared, each functional point carries the surfaces its own `**Allowed edit surfaces:**` implies, Coverage shows a share instead of `—`, and every path or surface that matched no rule is an omission.
8. A capability row paints the project's own label for the functional point, and clicking it, the `?`, the launch marker and Coverage all still address it by `id`.
9. Gates: `pnpm test` 0 failures, `pnpm run typecheck` at its baseline with no regression, `node scripts/verify-package-files.mjs` 0, `git diff --check` 0.

## Evidence and gates

Per slice: the RED run before the change, the GREEN run after, the focused suite for the touched module, then the full gate. The gates this repository pins are `pnpm test` (which includes `check:provider-contract` and the runtime harness), `pnpm run typecheck`, `node scripts/verify-package-files.mjs`, and `git diff --check`.

## Corrections from independent verification (2026-09-29)

The candidate for PMFP-1 was verified by a separate independent verifier, which returned **refuted**. All four gates reproduced, and these are what it found. Each is either fixed in the correction round or recorded as a deliberate consequence.

| Finding | Disposition |
| --- | --- |
| The reader still matched only `[ xX]`, so `[~]` rows (junglex's FP-6 and FP-7) could not be explained | **Fixed.** The reader accepts the same markers, with a test that resolves an active line by its generated id |
| A run of whitespace between `]` and `**` was refused, by the generator *and* the reader | **Fixed** in both, since D3 now says they tolerate the same thing |
| `- [] **Empty marker**` was silently ignored | **Fixed.** The detector accepts an empty marker, so the line is reported |
| An invalid-title omission named the label but not the line, which acceptance criterion 5 demands | **Fixed.** The omission names the line's own text |
| Truncation was literal only for whole words: one 65-character word was cut mid-word, and `a-` plus sixty-three characters collapsed to `a` | **Fixed** per D4's fallback rule, with the boundary cases pinned |
| `normalizeIdentifier` also governs the project identity, so a 70-character package name silently produced a truncated project id instead of refusing | **Fixed.** The project identity keeps its strict refusal |
| A stored translation replaced the whole `outcome`, dropping the functional point's `PREFIX — ` | **Fixed** in `extensions/gentle-project-map.ts` and pinned |
| `docs/project-map.md` claimed truncation is always at a word boundary, and that `outcome` is always the complete label | **Fixed.** Both sentences state the real rule |
| Checkbox-shaped retrospective prose in a non-roadmap document (`merchant-onboarding.md:123`, `fp-4-writable-catalog.md` several) becomes a capability under the tolerant rule that was invisible before | **Deliberate, recorded.** Under D1 the roadmap document is the only capability source, so these disappear for every project that declares one. In the fallback of D2 they become visible rows with ids cut from a sentence — noisy, and the price of the rule the initiative explicitly wanted: the pre-slice behaviour was the documented worst failure mode, a work unit invisible with no trace. Declaring the roadmap is the remedy, and D2's assumption says so in the map itself |
| `pnpm test` delegates two stages (`check:provider-contract`, `test:harness`) that the authorized Node command does not run | **Closed.** Both were run directly and pass |

## Corrections from the second verification round (2026-09-29)

The corrected candidate was verified again by a fresh independent verifier, which returned **refuted** a second time. All gates reproduced, `git status` was unchanged, and it found these. The first five are corrected; the last two are recorded, with their reproduction, as belonging to another unit.

| Finding | Disposition |
| --- | --- |
| `-  [ ] **X**` — two spaces between the dash and the bracket — is refused by both patterns. The generator tolerates a tab there but not a second space, and the line vanishes with no line-naming omission | **Fixed.** One whitespace character becomes a run in the generator, the omission detector and the reader, the same way D3 already fixed the other side of the marker |
| A stored translation whose title already carries the prefix produces `FP-1 — FP-1 — Traducido`: the head is prepended unconditionally | **Fixed.** The head is prepended only when the translated title does not already start with it |
| A label whose separator is written without spaces around it (`FP-1—Provisioning`) loses its prefix, because the head was derived by searching for the spaced form while the reader derives the title from the bare em dash | **Fixed.** The head is derived from the first `—`, the way the reader derives the title, and it keeps the whitespace that follows the separator |
| `docs/project-map.md` promises a literal cut of 64 characters while the separator trim can return 63 | **Fixed.** The sentence states at most 64 with a trailing separator trimmed |
| A repeated capability identifier inside one document is reported as `declared by both odd/tasks/a.md and odd/tasks/a.md`, and neither collision message carries the line's own text | **Fixed.** The message names the line and says “declared twice in” when both are the same document |
| The translation decoder accepts `title: "   "` with zero diagnostics (reproduced: `readProjectMapTranslations` returns no diagnostic and keeps the whitespace title), so the explanation can show a bare prefix with nothing after it | **Recorded, not fixed.** It is pre-existing — the decoder accepted it before this slice, when the outcome was the title alone, and it lives in `lib/project-map-translations.ts`, which belongs to the translation unit. The generator itself refuses a whitespace-only label with an omission, which is where PMFP-1's responsibility ends |
| Translation freshness hashes the body only, so editing a work unit's title or label keeps the stored translation fresh while its title no longer matches the label the map now shows | **Recorded, not fixed.** Pre-existing and deliberate: extending the hash to the label would invalidate all 49 stored entries and force a full re-run of the translation pass. It belongs to the translation unit, and the number is the reason not to fold it in here |

The verifier also reported that the shell tool itself spooled oversized command output under `/tmp`. That is the harness's own behaviour outside the repository, not a mutation of the candidate; the instruction that promised "no files anywhere" was written too strictly, and no repository state changed.

## Corrections from the third round and what remains open (2026-09-29)

The third round fixed the five findings the second verification raised as work: the whitespace run after the dash in all three patterns, one shared definition of the label's head with no doubled prefix and no loss for an unspaced separator, collision messages that name both lines and say “declared twice in” for one document, and the documentation's statement of the fallback. The comments that still described the old semantics were then corrected in `lib/project-map-description.ts`, `lib/shell-project-map-draft.ts` and `lib/project-map-help-modal.ts`.

Two findings stay open by decision, both in the translation unit and both with the reproduction recorded above:

- **The decoder accepts a whitespace-only or already-prefixed translated title.** The map can therefore show a bare prefix with nothing after it, or a doubled one, from a sidecar nobody validated. The remedy is in `lib/project-map-translations.ts`, which this slice does not own.
- **Freshness hashes the body only**, so a title-only edit keeps a stored translation “fresh” while its title no longer matches the label the map shows. Fixing it means hashing the label too, which would invalidate all 49 stored entries of this repository's own sidecar and force a full re-run of the translation pass. That number is the reason it is not folded in here.

The second verification's remaining refutation is the universal no-loss claim's scope: it holds for both repositories' real documents (225 lines scanned, none silent) and for every boundary shape the verifier constructed except the dash-plus-two-spaces line, which the third round fixed.

## PMFP-2 delivery (2026-09-29)

Committed as `d9a63596`, five files, 309 changed lines. The key is `project_map.roadmap` in `openspec/config.yaml`, canonically nested; the dotted `project_map.roadmap: <path>` spelling is accepted too, which is why the shared config reader's valued-key class gained a dot — that also makes `readConfigTestCommand`'s documented flat `apply.test_command` spelling real instead of dead. A repeated declaration is resolved by its last usable value; a blank value declares nothing and leaves an earlier one standing. The declared document may live outside `odd/tasks/`; the declared path is normalized where it is interpreted, so an alias cannot make the same document be read twice, while `..` and absolute paths stay refused rather than normalized into something safe. With no declaration the sources are unchanged and one added assumption says so.

Two verification rounds returned `refuted` on this slice, and both sets of findings were corrected:

| Finding | Disposition |
| --- | --- |
| The dotted spelling the documentation showed was not parsed at all, so a project could write the declaration and get the fallback with nothing but an assumption to show for it | **Fixed** in the shared reader, which is additive and also revives the flat `apply.test_command`
| An alias such as `odd/./tasks/a.md` made the extension read the same document twice and carry two document entries | **Fixed** by normalizing the declared path where it is interpreted, not in each caller
| The generator claimed a declared document was “not supplied” when it existed and could not be read | **Fixed** by rewording the omission to claim neither absence nor readability; the command-level message filtering that had hidden it was removed, because production logic must not exist to deduplicate text
| A declared roadmap inside `odd/tasks/` that failed to read was attempted twice, yielding two identical extension omissions and three in total | **Fixed** by remembering attempted paths instead of successfully collected documents: one read, two omissions
| `docs/project-map.md` stated the last declaration wins, unqualified, while a blank value leaves an earlier one standing | **Fixed** in the sentence
| The injectable filesystem seam added for the earlier tests was judged a production API expansion that existed only for tests | **Removed**, and the tests now observe the returned document list and omission counts instead; the verifier judged that containment acceptable, with the honest caveat that it depends on serial test execution

What the verifier confirmed and what the slice rests on: with no declaration the capability list, the **serialized map** and the omissions are byte-identical to the previous slice on both this repository and junglex, the only difference being the added assumption; declaring the roadmap yields junglex's thirteen functional points and this repository's nine PM units with no capability from any other document and no line omitted; and every benign alias normalizes to one read while every unsafe path stays refused, including the four shapes the verifier chose.

## Recorded, not fixed

- **A malformed sequence under `project_map:` is still read as a mapping.** Under
  ```yaml
  project_map:
    - other: x
      roadmap: x.md
  ```
  the simple reader skips the list marker and resolves `roadmap: x.md` as `project_map.roadmap`. That is the documented leniency for shapes it does not interpret, and it is recorded rather than fixed: tightening it is the parser's subject, not this unit's.
- **The test instrumentation patches `node:fs` process-wide for the duration of one helper.** It restores in `finally` and resynchronizes ESM exports, and the verifier found no order dependence under serial execution, but enabling the test runner's concurrency would require reconsidering it.
- **The third correction round's RED transcript was lost to context compaction** and is not reproducible. Its behaviour is pinned by tests and was verified independently by behaviour instead; it is recorded here because a claim of strict-TDD evidence that cannot be produced is not evidence.
- **A process error of the orchestrator's, recorded so it is not repeated:** a correction order was once sent to the read-only verifier instead of to the writer. The task was cancelled immediately and the working tree was confirmed unchanged before anything else happened. Verifier and writer sessions are not interchangeable, and the write authority that accompanies a correction belongs only to a writer.

## Not done, and why

- **junglex's own map is not regenerated.** The tool change lands here; declaring `project_map.roadmap` and the surface map in junglex's `openspec/config.yaml` is the maintainer's decision, and the map there is shared with other running sessions.
- **The translation sidecar is not re-keyed.** `openspec/project-map.es.json` is untracked and keyed by capability id; the identifier rule in D4 keeps every id of at most 64 characters, and the pass for the ids that do change is the documented batch job, not this unit.
- **`outcome` and `state` still have no writer.** A functional point's state comes from its checkbox and its label from its line; the command surface still cannot set either, which is the handoff's open item 1.
