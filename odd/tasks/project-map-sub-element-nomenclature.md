# Project Map — the document declares which functional point it belongs to

Status: **authorized 2026-09-29** by the maintainer's choice among four designs. The user's words: *"creo que deberíamos formalizar al orquestador con una forma de nombrar las subtareas para que esto pueda extenderse a otros proyectos"*, and then, choosing the design: **"Que el documento diga su fila"**. T1 is committed as `50c8bd5d`; T2 carries the contract clause in `assets/orchestrator-memory.md` and `docs/readme-reference.md`; the three independent verification rounds and what they refuted are recorded under *Corrections*.

## Objective

Make a functional point's sub-elements **declared** instead of inferred, by giving the harness contract one line per task document: the document names the row it belongs to, and with a readable declaration naming a row the map declares, every work unit in it other than a row is that row's sub-element, with repeated coded entries listed once. The Project Map reads that line, so the structure travels to every project the orchestrator writes without any configuration key for the association — while the association still requires the existing `project_map.delegable` convention and an extracted parent row to have anything to attach to.

## Problem

The ownership relation is derived from the shape of the code. `collectProjectMapSteps` (`lib/shell-project-map-draft.ts:127-147`, the guard at line 139) reads a unit as a sub-element of a row when its code starts with the row's code, is longer, and the next character is a letter or a dot. Measured on junglex's 22 documents on 2026-09-29:

| Measure | Value |
| --- | --- |
| Documents read | 22 |
| Checkbox lines, all indentations | 180 |
| Level-0 work units | 132 |
| Rows (`FP-` plus `^\d+(?:-\d+)*$`) | 10 (`FP-0` … `FP-9`) |
| Non-row units | 122 |
| Units the code rule reaches, any indentation | **22** — and all of them are in the `FP-0`/`FP-1` family (`FP-0b`, `FP-1a` with its six steps, `FP-1b` with its thirteen) |
| Level-0 units associated with nothing | **109** |

The 109 are not noise: the steps of `FP-5` are written `F5-1` … `F5-5` in `fp-5-geocoding.md`, the steps of `FP-5b` are `F5b-1` … `F5b-5`, `FP-6`'s are `F6-1` … `F6-7`, `FP-7`'s are `F7-1a` … `F7-1e`, and 28 more units carry no code at all (bold prose labels in `fp-4-writable-catalog.md` and `merchant-onboarding.md`). So `FP-5`, `FP-6` and `FP-7` show an empty explanation while their documents are full. `F5-1` does not extend `FP-5` — it is not a typo, it is a different code family the project chose — and no grammar over codes can ever reach a unit that has no code.

The project already declares the relation by hand: the roadmap writes `Tracker: \`odd/tasks/fp-6-notifications.md\`` for `FP-6`, the same for `FP-7`, and `FP-4`'s body names `odd/tasks/fp-4-writable-catalog.md`. The map ignores those lines, because its current rule is not to infer ownership from a document or a title (`docs/project-map.md:127`).

## Why

The two rules fail differently, and only the second one is fragile. Which unit is a **row** is already declared (`project_map.delegable` plus a remainder of digits and hyphens, disjoint from the extension rule by construction). Which row **owns** a unit is guessed, and the guess only works while every project codes its sub-tasks as an extension of the row's code — which junglex does not, and which no project must.

Reading a declared line is not the same as inferring from a document: the sentence that forbids inference stays true, because the map still associates a unit with a row only when the document says so. One line per document is also the cheapest declaration that reaches the uncoded units, and it is the only one that needs no re-coding of existing work.

Making it part of the harness contract rather than a project configuration is what makes it standard: the orchestrator writes `odd/tasks/<feature-name>.md` in every feature, so every project it writes carries the line from the first day, and the map never needs a project to declare anything for a new feature.

## Decisions

**D1 — The standard is one line in the document.** A task document declares the row it belongs to with a body line whose bold marker is `**Belongs to:**`, followed by exactly one backticked code: `**Belongs to:** \`FP-5\``. The marker follows the shape already documented for `**Allowed edit surfaces:**`: the colon may sit inside or immediately after the closing bold marker, and only backticked spans on the line are read. The line's documented place is before the first work unit, beside the document's title.

**D2 — The reader is tolerant but deterministic.** The declaration is read from the document's raw text at any indentation, after the same optional list marker the description reader strips. The **first readable declaration wins**; a later one is ignored. A declaration naming two or more codes is unreadable: it associates nothing, reports exactly one omission for that document, and the reader continues to the next readable declaration. **An unreadable declaration is not an absent one:** the document keeps declaring, so its units are never handed back to the code-extension fallback and the omission is the only visible report. An unreadable marker is reported **wherever it appears in the document**, not only before the declaration that won, because a conflicting declaration the maintainer wrote is exactly what must not pass unseen; a marker that is unreadable and followed by a readable one uses the readable one, and the omission must say exactly that rather than claiming the document was left unassociated.

**D3 — The declaration covers every work unit in its own document.** With a readable declaration naming a row the map declares, every work-unit line of that document — coded or uncoded, top-level or indented — is a sub-element of the declared row. Three exclusions: a unit that is itself a row under `project_map.delegable` is never a sub-element; a document whose declaration is unreadable, or names a row the map does not declare, associates nothing at all (D6); and a repeated coded entry is listed once, keeping the first declaration. The declaration never reaches another document.

**D4 — Declared beats derived.** Inside a declaring document, a unit whose code extends a *different* row belongs to the declared row. The code-extension rule stays the fallback for documents that declare nothing.

**D5 — An uncoded sub-element has no code to show.** When `splitWorkUnitLabel` finds no separator, the unit has no head: its sub-element entry keeps its title and state, carries an empty code, and renders at one level of depth. A coded sub-element keeps the depth it has today: its number of dots plus one. The list keeps the card's state glyphs and the code/title order the previous unit established.

**D6 — A declaration the map cannot honour is reported, not swallowed.** The declared code must be a row **the map declares**: the configured prefix, a remainder of digits and hyphens, *and* a row the extraction actually produced. **The collector validates the code's shape only; the generator performs the retained-row check.** When any of the three fails — no prefix configured, a malformed remainder, or a well-shaped code that no retained row declares — the document's units are associated with nothing and the generator reports exactly one omission for that document, naming the cause it actually is: a project that declares no delegable convention at all, or a code that is not a functional point this map declares. **An unreadable marker is reported separately and does not mean the units were lost:** when a later readable declaration took effect the document keeps its association, and the omission says the marker was ignored and names the declaration used; a document with no readable declaration at all is the unassociated case, reported without naming a code. The explanation keeps its existing plain statement for an empty list.

**D7 — No declaration at all changes nothing.** Without any marker the behaviour is byte-identical to today, including the assumptions, the omissions and the serialized map. An unreadable or unusable declaration deliberately does **not** fall back to the code rule: it is a declaration that failed, and D2 and D6 make it visible instead of silently guessing again. The reader still never infers ownership from a path, a filename or a title, and the document name (`fp-5b-…`) is never read as a declaration.

**D8 — The contract carries the standard.** `assets/orchestrator-memory.md`'s feature-document contract gains the requirement, so every document the orchestrator creates or updates from now on declares its row, and `docs/readme-reference.md` states the same for the human reader. The contract requires it for new documents; the map's fallback keeps old documents working.

**D9 — Nothing else moves.** The description, the translation hash, the artifact and the schema do not change. The marker line is not filtered out of a body it happens to sit in: the documented place is before the first work unit, where no description reads it, and a marker written inside a work unit is part of that body and changes its hash, which the documentation must say.

## Scope

- The reader in the generator: per-document declared parent, with its unusable-declaration omission.
- The collector: the declared association, the row guard, and the uncoded entry.
- The explanation's rendering of an entry without a code.
- The harness contract asset and the two public documents.
- The tests that pin all of it.

## Non-goals

- **No configuration key for this.** A project does not declare its documents' parents in `openspec/config.yaml`; the declaration lives in the document, where the orchestrator already writes. `project_map.delegable`, `project_map.roadmap` and `project_map.surfaces` are unchanged, and no fourth key is added.
- **No grammar for codes.** The codes are not validated, transformed or required to extend anything. Declaring the parent is what makes the code irrelevant.
- **No inference from the filename.** `fp-5b-geocoding-truth-up.md` is not read as a declaration, and neither is the roadmap's prose `Tracker:` line. One mechanism, explicit.
- **No schema change and no artifact change.** Sub-elements stay in the explanation; the map records only rows.
- **No upstream canon change in this unit.** The always-on ODD block is canonical in `gentle-ai` (`internal/components/agentguidance/routing.go`) and mirrored here behind `tests/odd-routing-canonical-ratchet.test.ts`; changing it is its own work and needs a local gentle-ai checkout, which this machine does not have.
- **No curation of long lists.** `fp-4-writable-catalog.md` declares 42 units, and a declaration shows all of them. Filtering, grouping or capping them is a presentation decision that belongs to its own unit.

## Constraints

- Strict TDD, the repository's style, no new dependency and no new `lib/` file.
- The collector stays pure and deterministic: document path order, then written order, first declaration wins.
- The fallback path must not change a byte when no document declares anything.
- Single writer, one commit per work unit, no push.

## Authorized edit surfaces

Task T1 (the reader, the collector and the explanation):

- `lib/shell-project-map-draft.ts`
- `lib/project-map-help-modal.ts`
- `extensions/gentle-project-map.ts`
- `tests/shell-project-map-draft.test.ts`
- `tests/project-map-help-modal.test.ts`
- `tests/gentle-project-map.test.ts`
- `docs/project-map.md`

Task T2 (the contract and the public documents):

- `assets/orchestrator-memory.md`
- `docs/readme-reference.md`

Task T3 is verification only and edits nothing (read-only).

## Tasks

- **T1 — Read the declared parent and show it.** Add the declaration reader, associate a declaring document's units with its row (D1–D4, D6), render an entry with no code (D5), keep the no-declaration path byte-identical (D7), and pin it with tests. Update `docs/project-map.md`.
- **T2 — Write the standard into the harness contract.** Extend `assets/orchestrator-memory.md`'s feature-document contract with the requirement (D8) and state the same in `docs/readme-reference.md`, keeping the tests that read both assets green.
- **T3 — Independent verification.** A read-only verifier tries to falsify T1 and T2 against this document's decisions and acceptance criteria, and reports what it found.

## Acceptance criteria

1. **Delegation.** A fixture document that declares `FP-5` and holds `F5b-1` (coded), a bare prose unit (uncoded) and an indented unit contributes all three to `FP-5`'s explanation, in written order, with each state glyph resolved from its checkbox.
2. **Codes stop mattering.** In that same fixture, `F5b-1` is a sub-element of `FP-5` although its code does not extend `FP-5`, and the uncoded unit is one too, rendered with its title and state and no code.
3. **Precedence.** A unit coded `FP-7x` inside a document that declares `FP-5` belongs to `FP-5` and not to `FP-7`, and a unit coded `FP-1b.0` in that document belongs to `FP-5` as well.
4. **Rows stay rows.** A unit that is itself a row (`FP-9`) inside a declaring document is never a sub-element of that document's declared row.
5. **Unusable declarations are reported once, and truthfully.** A document declaring two codes reports exactly one omission and still uses the next readable declaration; a document declaring a code the map cannot see as a row reports exactly one omission and associates nothing; a document whose project declares no delegable convention says so instead of blaming the code; and a document that *was* associated by a later readable declaration does not report that it was left unassociated. An unreadable marker written **after** the declaration that won is reported too, exactly once. A declaration whose code is well shaped but names a row no extraction produced reports one omission as well.
6. **The fallback is untouched.** A document with no marker at all produces the same steps, assumptions, omissions and serialized map as HEAD, checked over a corpus that includes an extending code, a non-extending code and an uncoded unit. Adding an unreadable marker is *not* that case: it removes the derived step and reports one omission, and a test must pin that too.
7. **The junglex shape works once declared, in the shape junglex actually writes.** The real documents write their steps as `- [x] **F5-1**` followed by the prose *after* the closing bold marker, so the map reads the bold label as the whole title and finds no code at all; `fp-4-writable-catalog.md` mixes 33 units with no separator and 9 whose bold label already carries an em dash inside prose. A fixture built from those exact shapes produces: `FP-5` with five entries titled `F5-1` … `F5-5` and no code column; `FP-6` with seven entries titled `F6-1` … `F6-7`; `FP-7` with five entries titled `F7-1a` … `F7-1e`; and `FP-4` with its 42 entries, 33 of them title-only and 9 split by the em dash already inside the label. No unit appears under a row that did not declare its document.
8. **The contract says it.** `assets/orchestrator-memory.md` and `docs/readme-reference.md` both state that a task document declares the functional point it belongs to and that its work units are that point's sub-elements, in the language boundary those documents already follow, and every test that reads them passes.
9. **Gates.** The full suite, `pnpm run typecheck` at its baseline with no regression, `node scripts/verify-package-files.mjs`, and `git diff --check` reported by its **exit code**, not by its silence.

## Corrections

**Round 1 — the independent verification of T1 (2026-09-29) refuted four points and the unit document was corrected before the code was.**

1. **D7's wording was false, not the code.** It promised byte-identical behaviour "without a readable declaration", while the implementation treats any marker as a declaration: an unreadable marker removes the previously derived step and adds one omission. D2 and D6 intend exactly that, so D7 now says "without any marker" and states the no-fallback consequence explicitly. `docs/project-map.md` already said "no declaration" and needed only the explicit sentence that an unreadable marker does not fall back either.
2. **The omission message lied after a successful recovery.** A document whose first marker named two codes and whose second was readable *was* associated, yet the omission said its units "were associated with no functional-point row". D6 now requires the message to state which of the two situations happened, and T1's correction implements and tests both.
3. **AC7's fixture was not faithful.** The verification reproduced `collectProjectMapSteps` over the real junglex documents with the declaration prepended in memory: `fp-5-geocoding.md`, `fp-6-notifications.md` and `fp-7-customer-truth-up.md` write their steps as `**F5-1**` plus trailing prose, so every entry arrives with an **empty code** and the code as its title — not as `**F5-1 — title**`; and `fp-4-writable-catalog.md` yields 42 entries of which 33 are uncoded and **9** carry a prose fragment before an em dash already inside the bold label. AC7 was rewritten to those measured shapes and the fixtures must mirror them.
4. **"Row the map declares" was only shape-validated.** A declared `FP-999` with no such row produced associated steps and no omission, so the units vanished silently. D6 now requires row existence and T1's correction reports it.

Verified in the same round, and unchanged by the correction: the precedence and row-guard behaviour, the uncoded rendering, the untouched description and translation hash, the documentation's remaining statements, and the gates (focused suites 76/76, 12/12, 66/66; `node scripts/check-types.mjs` at 195 recorded diagnostics with no regressions; `git diff --check` exit 0).

**Round 2 — the independent verification of T2 (2026-09-29) refuted two sentences of the contract clause before it was committed.** The clause as first written said that every work unit of a declaring document *is that point's sub-element, regardless of its code*, which overstates the reader: a unit that is itself a row is excluded, an unreadable or unusable declaration associates nothing, and a repeated coded entry is displayed once. It also said that *projects need no structure configuration*, which can be read as retiring `project_map.delegable`, `project_map.roadmap` and `project_map.surfaces`; the declaration adds no **additional** configuration for the association and changes none of those keys. Both sentences were rewritten in `assets/orchestrator-memory.md` and `docs/readme-reference.md`. Verified unchanged by the same round: the canonical marker spelling and first-readable-wins, the marker-in-a-body hash consequence (stated in `docs/project-map.md:127`), the clause's placement and English voice, the untouched mirrored canon and always-on core (ratchet 7/7), and every asset-reading suite (12 files, 0 failures).

**Round 3 — the final independent verification of T1 and T2 (2026-09-29) refuted one remaining overclaim in the clause and four statements in this document.** The clause's *every work unit other than a row* still omitted that repeated coded entries are listed once, and its *needs no further configuration* did not survive a project that configures no `project_map.delegable` at all: the association requires that convention and an extracted parent row, and adds no configuration key. This document's objective and D3 repeated both overclaims; D6 listed a recovered unreadable marker among the explanations for units associated with nothing, which it is not — recovery keeps the association; Round 1 said "three points" while enumerating four; and the document recorded neither the delivered commit nor its own missing declaration. All of them are corrected here and in both T2 assets. Verified unchanged by the same round: the marker spelling and first-readable precedence, the row guard, document isolation, the uncoded rendering, the untouched description and translation hash, the byte-identical fallback for a document with no marker, the mirrored canon (ratchet 7/7), the gates (4137 tests, 4099 passed, 38 skipped, 0 failed; typecheck at 195 diagnostics with no regressions; `git diff --check` exit 0), and byte-identical preservation of every tracked and untracked file, the maintainer's two entries included.

## Not done, and why

- **junglex's documents are not edited here.** The declaration is a line in the maintainer's own documents; the tool change is what makes writing it worthwhile. Adding `**Belongs to:**` to the 13 declaring documents is the maintainer's edit.
- **The upstream canon is not touched.** See the non-goal above: the always-on block is `gentle-ai`'s, the ratchet only mirrors it, and this machine has no gentle-ai checkout.
- **`Tracker:` prose is not read.** It is the same relation written in the other direction, but reading prose is inference; the declaration is a marker or it is nothing.
- **This document carries no declaration of its own.** D8 requires every feature document to declare the functional point it belongs to, and this repository declares no `project_map.delegable` convention and no roadmap, so there is no row this work could belong to: a declaration here would associate nothing and report an omission. The requirement takes effect where a row exists.
- **The contract requires the declaration even where a project declares no row.** The orchestrator writes the line unconditionally, so a project that never declares `project_map.delegable` carries declarations the map cannot honour, and a draft run there would report one omission per document. The trade-off is deliberate: the line is one sentence, it makes a document self-describing before the map is adopted, and a project that adopts the convention later finds its documents already declared. Making the requirement conditional on the convention is a one-clause change if that cost ever turns out to be noise.
- **A marker inside a fenced code block is still read.** The reader is line-anchored, not Markdown-aware, and making it fence-aware would add a parsing notion the other markers here do not have. The documented position — beside the title, before the first work unit — is what keeps it unambiguous, and a document that quotes the marker at the start of a line declares with it.
- **Trailing prose is not read as a title.** `- [x] **F5-1** RED first: …` gives the entry the code as its title and an empty code column, because the label ends at the closing bold marker. Reading the rest of the line as a title would change what `outcome` means for every capability, so it is not this unit's to change.
- **A bold label that carries an em dash inside prose is split by the existing grammar.** Nine of `fp-4-writable-catalog.md`'s 42 entries therefore show a prose fragment in the place a code would go. That is the label grammar the rows already use, and changing it would touch every existing outcome; the maintainer's own curation of those labels is the cheap fix.
