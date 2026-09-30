# Project Map — one gesture: refresh when the sources moved, and hand over the translation

Status: **authorized 2026-09-29** by the maintainer's choice among four designs. The user's words: *"hace que /gentle:project-map genere ademas el draft y la traduccion automaticamente para sacar /gentle:project-map draft y /gentle:project-map translate"*, and then, choosing the design: **"Regenerar si cambió, con confirmación"**.

## Objective

Make bare `/gentle:project-map` the one gesture the feature is named after: it shows the map, refreshes the draft when the repository sources moved since the artifact was written, and hands over the translation work so the agent that read the command does it in the same turn. `draft` and `translate` stop being necessary steps in the ordinary flow.

## Problem

The default path (`ensure`) does two things and stops. When a usable artifact exists it shows the card and reports it, whatever the sources now say — so a document that gained a work unit, lost one, or changed a checkbox leaves the map stale until the maintainer remembers to type `draft`. When no usable artifact exists it runs the generation flow, so the first run is already one gesture. The gap is the second, third and tenth run.

The translation is the same shape of gap from the other side. `translate` prints what still needs a pass — the capability id, the body hash, the document, and the exact shape to write — and the agent then does the work. Nothing about that requires the maintainer to type the command: the report is for the agent's next turn, and the default path could carry it.

**The extension cannot translate, and this unit does not pretend otherwise.** `docs/project-map.md:133` records why: the overlay opens from a synchronous path and an extension has no model call. What can change is who reads the report and when — not who writes the Spanish.

## Why

The feature's own name is a gesture, and a gesture that goes stale silently is worse than one that asks. Refreshing on change keeps the card true without adding a command, and it does so behind the confirmation that already exists, so a human's own work in the artifact is never replaced without being told. Folding the translation report into the same output removes the last step that existed only because the report had to be asked for.

## Decisions

**D1 — The default path refreshes instead of only showing.** Bare `/gentle:project-map` keeps everything it does today — show the card for a usable artifact, generate the draft when there is none — and adds one step: with a usable artifact, it recomputes the draft from the same repository sources and compares it with the stored map. Identical, and nothing else happens. Different, and it reports exactly what changed and asks the same write confirmation the generation flow already uses (D3). Nothing is written without that confirmation.

**D2 — What counts as changed is the source-owned projection, and the comparison is a pure function.** It is deliberately narrower than a deep equality:
- **compared**: `project.id`, `project.name`, `foundations`, and, for each capability in canonical order, `id`, `outcome`, `state`, `foundationRefs`, `dependsOn`, `contracts`, `featureDocs`, and `surfaces` **only when the freshly generated capability declares at least one surface**;
- **ignored**: `approval`, because a stored map may be approved while a generated one is always a draft, and a capability's `surfaces` when the documents declare none, because that field is also the human's (`declare`) and a difference there is not staleness.
Every difference becomes one deterministic line naming the capability and the field, in canonical order. Capabilities are visited in the **stored** map's order, **each id once**, and a capability that exists only in the generated map is reported afterwards in **canonical id order**, so the generated map's own ordering never reaches the report while each id's first occurrence is unchanged; the stored map's order is the report's order by design, and a stored map that lists its capabilities differently produces its lines in that order. A capability present on one side only is reported as added or removed, once. A repeated generated id uses its first occurrence for field comparison, and a repeated stored id is described once at its first position. **Known limit:** a document that stops declaring an `Allowed edit surfaces` line is not detected as a change, because the regenerated list is then empty and empty is what the human's own declaration looks like; `draft` still re-derives it.

**D3 — The confirmation, and what is never lost.** The refresh writes only after the same two-option confirmation the generation flow uses, after the same `artifactMovedSince` guard, and it reports the change list before asking. A declined refresh writes nothing and leaves the stored map — and the card — exactly as they were. **What an accepted refresh writes is the freshly generated map with one merge and only one:** for every capability whose generated surface list is empty, the stored capability's surface list is carried over, because that field is the human's whenever the document is silent (D2). Nothing else is merged. **And an approved map does not stay approved:** writing a regenerated draft returns it to draft, so the confirmation says so before asking, because a plan whose capabilities moved is a plan that needs approving again.

**D4 — The default path hands over the translation.** After the map is settled, whether refreshed or kept, the default path appends the report `/gentle:project-map translate` produces: the target path, the counts, and per capability the id, the body hash to copy, the document, and the exact shape to write. **One shared builder** produces that report for both the default path and the `translate` sub-action, so the two can never drift. The report is for the agent reading the command's output, which does the translation in the same turn and writes `openspec/project-map.es.json`.

**D5 — `draft` and `translate` stay, and stop being necessary.** Both keep their behaviour and their place in the command surface: `draft` remains the explicit "replace it now, whatever it says" route, and `translate` the read-only report on its own. The change is that the ordinary flow no longer needs either, so neither has to be remembered.

**D6 — The write gates do not move.** A refresh is a planning-route write to the artifact, exactly like `draft`: same confirmation, same guard, same `wrote` flag meaning that something durable changed, and no new opt-in switch. Nothing else in the command surface changes — `show`, `status`, `hide`, `declare`, `approve` and the coordination routes keep their behaviour.

**D7 — The default path stays quiet when nothing moved.** An unchanged map with nothing to translate prints what `ensure` prints today plus the "current" line `translate` already prints for that case: no dialog, no write, no noise.

**D8 — No artifact schema change and no provenance fingerprint.** The artifact gains no field: the comparison happens in memory and nothing durable records when the map was generated. `draft`'s replacement semantics do not change.

## Scope

- The pure comparison and its change lines, beside the generator.
- The `ensure` flow: card, comparison, change report, confirmation, write, and the appended translation report.
- The shared translation-report builder.
- `docs/project-map.md`, and the tests that pin all of it.

## Non-goals

- **Removing `draft` or `translate` from the command surface.** They stay; they stop being required steps.
- **Translating inside the extension.** Impossible by design: no model call and a synchronous overlay path. The report is for the agent.
- **Auto-approval, or approving anything.** The refresh writes a draft; approval remains a human decision.
- **A file watcher, a background refresh, or a refresh on any other command.** The gesture is the default path.
- **Changing the generator's derivation or the artifact schema.** The refresh compares; it does not decide what the map should contain.
- **No general merge.** Only a capability's human-owned surfaces carry over into a refreshed map; every other field comes from the freshly generated draft.

## Constraints

- Strict TDD, the repository's style, no new dependency.
- The comparison is pure and deterministic: no filesystem access, no clock, canonical order in, canonical order out.
- The no-change path must not write, must not open a dialog, and must not change what `ensure` reports today beyond the translation line D7 names.
- Single writer, one commit per work unit, no push.

## Authorized edit surfaces

Task T1 (the comparison and its change lines):

- `lib/shell-project-map-draft.ts`
- `tests/shell-project-map-draft.test.ts`

Task T2 (the default flow, the shared report and the documentation):

- `extensions/gentle-project-map.ts`
- `lib/project-map-translations.ts`
- `tests/gentle-project-map.test.ts`
- `tests/project-map-translations.test.ts`
- `docs/project-map.md`

Task T3 is verification only and edits nothing (read-only).

## Tasks

- **T1 — Compare a stored map with a freshly generated one.** The pure function, its canonical change lines, the ignored fields of D2, and the unit tests that pin the limits. No command behaviour changes in this task.
- **T2 — Wire the default path and share the translation report.** The `ensure` flow gains the comparison, the change report and the confirmation, and both it and `translate` print the same report built by one helper. Update `docs/project-map.md`.
- **T3 — Independent verification.** A read-only verifier tries to falsify T1 and T2 against this document's decisions and acceptance criteria, in particular the never-lost surfaces and the byte-identical decline.

## Acceptance criteria

1. **Unchanged sources change nothing.** With a stored map and identical sources, the default path shows the card, opens no dialog, writes nothing (`wrote: false`), and reports the translation state without a change list.
2. **A moved source is reported and gated.** A changed checkbox state, an added capability, a removed capability and a changed outcome each produce their change line; the default path asks once and writes only on accept. On accept `wrote: true` and the stored map is the regenerated one; on decline `wrote: false` and the stored artifact is **byte-identical** to what it was.
3. **A human's declaration is not staleness, and a refresh does not destroy it.** A stored capability whose surfaces were declared by hand, whose document declares none, is not reported as changed and does not open a dialog; and an accepted refresh **carries those surfaces into the written map**, so the only way they change is an explicit `declare`.
4. **A document-declared surface change is reported.** A document that gained or changed its `**Allowed edit surfaces:**` line produces a surfaces change line for that capability.
5. **The change list is deterministic and canonical.** Same inputs, same lines, same order; an added or removed capability is named as such, once per id; capabilities are visited in the stored map's order by design, and the **generated** side cannot influence that order — a capability that only the generated map has appears in canonical id order, so reversing the generated map's own order produces identical lines provided each id's first occurrence is unchanged, while a stored map that lists its capabilities differently produces them in its own order.
6. **Approval never looks like staleness, and a refresh is honest about it.** An approved stored map whose sources are otherwise identical is not refreshed and is not reported as changed. An approved stored map **whose sources moved** may be refreshed, the confirmation states that the write returns it to draft, and the written artifact is a draft — never silently still approved.
7. **The translation report is one report.** The default path's report contains the worklist — target path, counts, and per capability the id, hash, document and shape — and is identical to what `translate` prints for the same inputs, because one builder produces both.
8. **`draft` and `translate` are unchanged.** Their behaviour, their output and their `wrote` semantics are exactly as they were.
9. **Gates.** The full suite, `node scripts/check-types.mjs` at its baseline with no regression, `node scripts/verify-package-files.mjs`, and `git diff --check` reported by its **exit code**.

## Not done, and why

- **Nothing yet.** This section records what each verification round refuted, and what is deliberately left out, as the work proceeds.
