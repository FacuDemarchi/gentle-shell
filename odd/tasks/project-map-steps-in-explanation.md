# Project Map — the explanation lists the functional point's sub-elements

Status: **authorized 2026-09-29.** The user's words: *"mete los subelementos del fp adentro del ?"*.

## Objective

Make the `?` of a functional point list its sub-elements — the steps that belong to it — with their code and their state, whichever document declares them.

## Problem

Measured on junglex with the roadmap and the delegable convention declared:

1. **FP-1a** (`repo-side-production-path-no-accounts-needed`): its `?` shows thirteen description lines and the sub-elements are among them — `[x] **FP-1a.1 — Extract the DSN-driven migration ledger into a shared module**`, `[x] **FP-1a.2 — Production migration runner**` — but buried inside the prose of their own bullets, with no list, no count and no state of their own.
2. **FP-1b** (`provisioning`): its `?` shows **zero** description lines. Its body in the roadmap is one sentence, and its **thirteen** sub-elements — `FP-1b.0`, `FP-1b.1a`, `FP-1b.1`, `FP-1b.2`, `FP-1b.3`, `FP-1b.3a`, `FP-1b.3a-b`, `FP-1b.3b`, `FP-1b.4`, `FP-1b.5`, `FP-1b.6`, `FP-1b.7`, `FP-1b.8` — are declared in `odd/tasks/fp-1b-provisioning.md`, a document the explanation never reads. The sub-elements are absent, not buried. (This paragraph said nine until the implementing worker measured the document; the count was mine and it was wrong, not the rule's.)

The two cases have one cause: the explanation reads one document — the capability's first feature document — and shows its body verbatim. A sub-element that lives elsewhere is invisible, and one that is nested is indistinguishable from a prose bullet.

## Why

The map now shows only the delegable units, which is what the user asked for, and the sub-elements are what the maintainer performs itself. They must not disappear from the tool because they left the row set: the `?` is the place where a functional point is explained, and "what is left inside it" is part of that answer. A step that lives in another document is exactly the one nobody can find today.

## Decisions

**D1 — A sub-element is the unit whose code is the functional point's code followed by a dot.** `FP-1b.0` is a sub-element of `FP-1b`; `FP-1a.1` is one of `FP-1a`. This is the same rule the delegable convention already uses to call a dotted code a sub-numbering, so the tool keeps one meaning for the dot instead of inventing a second. The functional point's code is the head of its own label — what it writes before its separator, or the whole label when it writes none.

**D2 — The sub-elements are read from every document the command read, not from one.** They are declared wherever their document put them: nested under the functional point in the roadmap, or at the top level of a document of their own. The search is over the same document set the draft uses, so the explanation and the map agree about what exists.

**D3 — Each sub-element shows its code, its title and its state.** The state comes from the checkbox the document wrote — `done`, `planned`, or `active` for `[~]` — and renders with the same glyph vocabulary the map uses for a capability's state, so a finished step reads the same way a finished capability does. **The overlay's own state word is Spanish and agrees with the capability it describes** (`hecha`, `planificada`); a sub-element is a *subelemento*, so that same word disagrees in gender inside the list, and the glyph has no gender at all. The list therefore uses the card's glyphs while the capability's own state keeps its word — one vocabulary for the card, and no agreement error in the overlay. The first version of this slice rendered the words and was refuted against this decision; the delegation had contradicted it, which is recorded rather than glossed.

**D4 — The list is a section of the explanation, before the description, and the description is untouched.** The description is the document's own words and it stays exactly as it is: filtering the sub-element lines out of it would change the body the translation sidecar hashes, which would invalidate every stored translation for a presentation gain. A sub-element therefore appears both in the list and, when the roadmap nested it, inside the description prose. That duplication is accepted and deliberate.

**D5 — A step the documents do not code is not associated with any functional point.** junglex's `odd/tasks/fp-4-writable-catalog.md` carries uncoded level-0 lines such as `Close the coverage gaps independent verification named`. Nothing in the text says which functional point they belong to, and guessing from the document a functional point happens to mention would be a second, weaker rule. They stay out, and this is recorded rather than hidden.

## Scope

- A collector in the draft module that, given the documents and a code, answers the sub-elements with their code, title, state and declaring document. It owns the work-unit grammar already, so it is where this belongs.
- The explanation's content and its rendering: a section listing them, with a count.
- The extension that gathers the documents and passes the list in.
- The tests and `docs/project-map.md`.

## Non-goals

- Translating the sub-elements. The sidecar translates a capability's body lines, and the structured list has no separately translated title field of its own, so a list entry renders in the document's language even when a duplicate of the same title inside the description is translated. A nested sub-element's title may therefore appear twice — translated inside the body, untranslated in the list. Changing the sidecar's shape is its own unit.
- Showing a sub-element's own body. The list is one line per step; the modal would otherwise become a document viewer.
- Changing the description, the rows, or the map artifact. Nothing in the map changes: this is the explanation.
- Associating uncoded units (D5).

## Constraints

- Strict TDD, the repository's style, no new dependency and no new `lib/` file.
- The collector is pure: documents in, sub-elements out. No filesystem access inside it.
- Single writer, one commit per work unit, no push.

## Authorized edit surfaces

- `lib/shell-project-map-draft.ts`
- `lib/project-map-help-modal.ts`
- `extensions/gentle-project-map.ts`
- `tests/shell-project-map-draft.test.ts`
- `tests/project-map-help-modal.test.ts`
- `tests/gentle-project-map.test.ts`
- `docs/project-map.md`
- `odd/tasks/project-map-steps-in-explanation.md`

## Acceptance criteria

1. For junglex's `FP-1b`, the `?` lists its **thirteen** sub-elements, measured from its documents: `FP-1b.0`, `FP-1b.1a`, `FP-1b.1`, `FP-1b.2`, `FP-1b.3`, `FP-1b.3a`, `FP-1b.3a-b`, `FP-1b.3b`, `FP-1b.4`, `FP-1b.5`, `FP-1b.6`, `FP-1b.7` and `FP-1b.8` — all declared by `odd/tasks/fp-1b-provisioning.md`, each with its title and its state, where today the explanation lists none. **The first version of this criterion said nine**, from a truncated scan of that document: the rule is D1's dot prefix and it must not be narrowed to match a number, so the count is corrected here rather than the rule.
2. For `FP-1a`, the same list appears with the six sub-elements the roadmap nests, each with its state, in addition to the description it already showed.
3. The count is stated once, and a functional point with no sub-elements says so plainly rather than showing an empty section. Measured: `FP-2` and `FP-4` are both empty, because their sub-units are not coded with a dot (`FP-4a1` begins with `FP-4` and continues with `a`), which is D5's boundary and not a defect.
4. The description is byte-identical to what it was before this unit, so no stored translation is invalidated.
5. Nothing about the map artifact, the rows or Coverage changes.
6. Gates: the full suite, `check-types` at its baseline, the package resource check, and `git diff --check` reported by its exit code.

## Not done, and why

- **Sub-elements render in the document's language.** The structured list has no separately translated title field of its own, so its entries stay in the document's language while a duplicate title inside the translated body does not. A Spanish frame therefore shows English step titles until the sidecar's shape grows a field for them. Recorded, not hidden. The first version of this paragraph said a sub-element's title is not in the body the sidecar translates, which a verification round refuted against real data: a nested sub-element's title *is* in that body, and the narrower truth is the missing field, not a missing title.
- **Uncoded units are not associated** (D5).
- **The card does not change.** The sub-elements are the explanation's business; the row set is the delegable convention's.
