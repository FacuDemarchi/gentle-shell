# Project Map — how the card shows itself

Status: **authorized 2026-09-27.** The user's words: *"hay que revisar como muestra la pantalla, me gustaría que siga el estilo del status y el todo"*, and then, about a wrapped capability row, *"quedan re feos"*.

## Objective

Make the Project Map card readable at the width the user actually has, and bring its shape in line with the two cards it sits beside — Status and Todos.

## Problem

A capability row was **pre-wrapped at a fixed 60 columns** by `boundedLines`, and `renderCard` wrapped the result again at the real inner width. Three defects came out of that one guess:

1. **The continuation lines lost their indent.** `boundedLines` cut at a space and `trimStart()`ed the remainder, so a wrapped row landed at column 0 with no glyph and no indent, reading as two unrelated lines. Measured at width 48: `✓ add-integration-readiness-sequencing ·` then `no surface` then `declared`.
2. **The budget was width-blind.** A card 48 wide was built to 60, so every row longer than the card was clipped mid-content by `cardLine` — losing the tail instead of moving it down.
3. **`no surface declared` spent 20 columns of prose** on an absence the card already has vocabulary for: Coverage renders `—` for a surface nobody declares.

The coverage block had the same two wrapping defects, because it packed to a fixed `COVERAGE_BUDGET` and then wrapped the packed line at a third width.

## Decisions

**A. A capability row is one line, at any width.** The row is built to the inner width the renderer actually has, and a long identifier is truncated **in the middle** — `capability-with-a…kable-identifier` — because a capability id is read from either end and end-truncation keeps only the half nobody recognises. Nothing is hidden: the Inspector prints the identifier in full, and so does the descriptor at its default budget.

**B. The width is threaded down from the render path.** `projectMapCardBody`, `projectMapCardDescriptor` and `coverageLines` take the inner width, and `renderProjectMapCard`, the rail's render closure and the collapsed bottom card pass `cardInnerWidth(width)`. The default stays 60 for callers that build a descriptor without a width, which is what keeps the pure-data tests meaningful.

**C. A continuation keeps its indent.** `boundedLines` re-applies the line's own leading indent to every continuation, so a wrapped coverage or diagnostic line reads as part of the line it continues. A token with no spaces in it is still cut hard, because every line it returns is drawn as one card line — leaving it whole would overrun the budget, which is exactly what a first attempt at this got wrong.

**D. `—` replaces `no surface declared`.** The same absence vocabulary Coverage already uses. Undeclared is an absence of evidence, never a zero.

## Slices

- **PMCP-1 — long rows (delivered).** One line per capability, middle-truncated, width-aware; `—` for an undeclared surface; indent-preserving wrap; coverage packed to the real width. Six tests that pinned the old behavior were updated, two of them replaced by tests of the new contract, and three existing tests caught a real regression in the first attempt (an unbreakable token overran the budget).
- **PMCP-2 — the Status/Todos idiom (pending, needs the user's eye).** Section labels at column 0 with one-space rows and a blank line between sections, as Status does; the collapse control in the title with the key in the top rule, as Todos does; Coverage as one row per declared surface instead of a packed run-on. This slice moves the click targets and the pinned rendered lines, so it is deliberately separate.

## Acceptance criteria

1. A capability row occupies exactly one body line and one rendered line at every width, and clicking it selects it.
2. A long identifier is truncated in the middle rather than wrapped or end-truncated, and the full identifier remains in the descriptor and the Inspector.
3. No body line exceeds the budget it was built for, including a token with no spaces.
4. A wrapped line's continuations carry that line's indent.
5. Coverage is packed to the card's real width, never to a fixed guess.

## Non-goals

- The Status/Todos alignment of PMCP-2, which changes click targets and is held for a design decision.
- Any change to what the card *says*: coverage arithmetic, glyphs, states and the honest `—` all stay.
