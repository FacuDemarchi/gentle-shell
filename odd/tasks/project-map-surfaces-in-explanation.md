# Project Map — the surfaces roll-up moves from the card into the `?`

Status: **authorized 2026-09-29** by the maintainer's choice among three designs. The user's words: *"saca el Web · API · Data del project map, que quede dentro del ?"*, and then, choosing the design: **"Colas y Coverage, el agregado va al ?"**.

## Objective

Take the surface vocabulary out of the card and keep it in the explanation: a capability row ends at its label, the card's `Coverage` section disappears, and the map's per-surface roll-up — which the card used to carry — appears inside the `?` instead. The information moves; it is not reduced.

## Problem

The card paints surfaces twice. `capabilityRow` appends a tail to every row (``? ✿ ✓ FP-5 — Provisioning · Web · API · Data``), and `projectMapCardBody` appends a `Coverage` section whose lines are `Web 100% (1/1): five ✓ · API — · Data —`. The `?` already answers the per-capability question with its `Superficies:` fact (`lib/project-map-help-modal.ts:79`), so the row tail repeats what the explanation says better, and the card spends its narrowest resource — horizontal room for the label — on a list the reader can ask for.

The roll-up is different: it is a **map-level** metric (share per surface across every capability), not a fact of one row. Removing it without a home would delete information; the user chose to keep it, inside the explanation.

## Why

The card's job is to be scannable: which functionalities exist, how they are doing, and which one can be launched. The label is what a human scans, and a surface tail competes with it for the same line. The explanation's job is exactly the opposite — completeness on request — and it already carries the capability's own surfaces, so the roll-up belongs beside them rather than under the rows.

## Decisions

**D1 — The `?` carries the map's per-surface roll-up.** The explanation gains a section, in Spanish like its other own words, placed after the facts and after the sub-element list and before the description (the document's own words stay last). It lists **one line per surface in canonical schema order**, and each line carries exactly what the card's coverage line carried: the surface label, `share% (done/declared)`, and the capabilities that declare it as `id <glyph>`, comma-separated. A surface no capability declares renders `—`, the same absence-of-evidence vocabulary the rest of the feature uses. Because it is the map's roll-up, the section appears in every capability's explanation; the modal says it is the map's, not the row's. **A caller that supplies no lines at all renders no section**, because a missing roll-up is a missing input rather than a map that declares nothing; the production caller always supplies the computed lines, and a supplied roll-up whose every surface is undeclared states that absence explicitly.

**D2 — One builder for the line text, in the view library.** The labels (`Web`, `API`, `Data`, …) and the arithmetic live once. `lib/shell-project-map-view.ts` exports the function that turns the map and its coverage entries into those lines, and the modal renders what it is given: no surface label, no percentage and no glyph lookup is added to the modal.

**D3 — The card stops showing surfaces.** `capabilityRow` ends at its label — no ` · Web · API · Data` tail and no `—` tail for a capability that declares none — and the freed width goes to the label, which is the only content that stays. `projectMapCardBody` loses the `Coverage` header and its lines. The card's body is then the foundations group, the capabilities group, and nothing else.

**D4 — The card's digest follows what the card paints.** `projectMapCardDigest` stops folding the surfaces (and the coverage lines) into its hash, so a surfaces-only change no longer invalidates the rail's memo. The digest keeps covering everything the card still paints.

**D5 — Nothing else moves.** The surface vocabulary, the artifact schema, the derivation, `declare`, the approval contract, the launch markers and the `Superficies:` fact the `?` already carries are untouched. `Coverage` is not deleted; it changes place. The card's foundations and capabilities groups, their counts, the collapse behaviour and the click targets are unchanged.

**D6 — The documentation says where it lives now.** `docs/project-map.md` stops describing a card section that no longer exists, describes the explanation's roll-up section, and stops claiming that a capability row carries a surface tail.

## Scope

- The view library: the row, the card body, the exported roll-up line builder, the digest.
- The help modal: the new section and its placement; the extension passes the coverage in.
- The documentation and the tests that pin all of it.

## Non-goals

- **No change to what Coverage means or counts.** The definition (`declared` in the denominator, `done` in the numerator) is untouched.
- **No new overlay, no second modal, no key binding.** The roll-up lives inside the existing `?`.
- **No change to the reserved capability vocabulary, the launch marker, or the retired Inspector.** Nothing comes back.
- **No translation work.** The modal's own words are Spanish and the surface labels stay the map's own English vocabulary, as they already do in the card.

## Constraints

- Strict TDD, the repository's style, no new dependency and no new `lib/` file.
- The card's rendered body stays one line per row, and the digest stays a pure function of what is painted.
- Single writer, one commit per work unit, no push.

## Authorized edit surfaces

Task T1 (the explanation gains the roll-up; the card is untouched):

- `lib/shell-project-map-view.ts`
- `lib/project-map-help-modal.ts`
- `extensions/gentle-project-map.ts`
- `tests/shell-project-map-view.test.ts`
- `tests/project-map-help-modal.test.ts`
- `tests/gentle-project-map.test.ts`
- `docs/project-map.md`

Task T2 (the card loses the surfaces):

- `lib/shell-project-map-view.ts`
- `tests/shell-project-map-view.test.ts`
- `tests/shell-project-map-card.test.ts`
- `docs/project-map.md`

Task T3 is verification only and edits nothing (read-only).

## Tasks

- **T1 — The explanation carries the map's roll-up.** Export the line builder from the view library, add the section to the modal in the documented position, pass the coverage from the extension, and pin it with tests. The card keeps painting what it paints today, so no information is ever missing.
- **T2 — The card stops painting surfaces.** Remove the row tail and the `Coverage` section, give the freed width to the label, narrow the digest, and update the card tests and the documentation.
- **T3 — Independent verification.** A read-only verifier tries to falsify T1 and T2 against this document's decisions and acceptance criteria, paying attention to the label width, the digest, and whether anything the card painted is now unreachable.

## Acceptance criteria

1. **The roll-up is in the `?`.** Opening the explanation of any capability lists one line per surface in canonical order, each with its label, `share% (done/declared)`, and the declaring capabilities as `id <glyph>`, and `—` for a surface nobody declares. The section sits after the facts and the sub-element list and before the description. A caller that supplies **no** lines renders no section and claims nothing about the map's surfaces; a supplied roll-up whose every surface is undeclared states that absence explicitly.
2. **One definition of the text.** The line text comes from the view library's exported builder, which the modal calls; the modal adds no surface label, no percentage and no glyph lookup of its own.
3. **The roll-up is identified as the map's**, not as the row's, in the section's own words.
4. **A row ends at its label.** No row paints a surface tail or an `—` for one, and the label is given the width the tail used to occupy.
5. **The card has no `Coverage`.** No `Coverage` header and no per-surface line appear in the card body; the foundations and capabilities groups, their counts and their collapse behaviour are unchanged.
6. **The digest matches the paint.** It changes when painted content changes and does not change for a surfaces-only change.
7. **Nothing else moved.** The `Superficies:` fact, the sub-element list, the description's last position, the launch marker, the click targets and the artifact are exactly as they were.
8. **Documentation.** `docs/project-map.md` describes the roll-up where it now lives and no longer describes a card tail or a card `Coverage` section.
9. **Gates.** The full suite, `node scripts/check-types.mjs` at its baseline with no regression, `node scripts/verify-package-files.mjs`, and `git diff --check` reported by its **exit code**.

## Corrections

**Round 1 — the independent verification of T1 and T2 (2026-10-01) verified the production behaviour and refuted one optional-argument footgun.** `buildProjectMapHelpContent`'s `coverageLines` defaulted to an empty array, and the renderer's absence test — every line ends with `—` — is vacuously true for an empty array, so a caller that omitted the parameter produced an explanation asserting *"El mapa no declara ninguna superficie."* while its own facts line named declared surfaces. The only production caller always supplies the computed lines, so no command path ever printed it; the contract was still wrong. The section is now rendered only when lines were supplied, and both cases are pinned. The same round verified and left unchanged: the roll-up's fidelity against the card's HEAD text (labels, rounding, counts, ids and glyphs, canonical order), the section's position across sixteen modal combinations, the label-only row with the freed width and its unchanged marker columns, the card without `Coverage` and without dead helpers, the digest's surfaces-only stability, the untouched description and artifact, and the documentation.

**Two pre-existing duplications were found and are deliberately not fixed here.** `lib/shell-project-map-tabs.ts` carries its own surface label table (`ORCHESTRATOR_SESSION_SURFACE_LABEL`) beside the view library's `SURFACE_LABEL`; it is untouched by this unit and predates it. And the card's digest remains conservatively broader than its paint — a collapsed capability's label is still an input — which is also pre-existing.

## Not done, and why

- **Nothing yet.** This section records what each verification round refuted as the work proceeds.
