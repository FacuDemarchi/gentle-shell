# Project Map — a code that continues is a sub-element, not a row

Status: **authorized 2026-09-29.** The user's words: *"me sigue apareciendo el fp-0b, fp-1a, etc ....."*, after having asked *"mete los subelementos del fp adentro del ?"*.

## Objective

Make the map's rows the **numbered roots** of the roadmap — `FP-0` … `FP-9` — and move every code that continues past its number inside the explanation of the code it extends, as a tree.

## Problem

The delegable convention treats a code as a row when it starts with the declared prefix and carries **no dot**. That catches `FP-1b.0` but not `FP-1b`, `FP-1a` or `FP-0b`, so junglex's map shows thirteen rows where three of them — `FP-0b`, `FP-1a`, `FP-1b` — are **cuts of `FP-0` and `FP-1`**, not functional points of their own. The user sees exactly those three and reports them.

The code already says so: a trailing letter is a sub-numbering, the same way a dot is. `FP-0b` extends `FP-0`; `FP-1a` and `FP-1b` extend `FP-1`; `FP-1b.0` extends `FP-1b`. The previous unit read the dot and missed the letter, so it built the sub-element list one level too deep: it put `FP-1b.0` … `FP-1b.8` inside `FP-1b`'s explanation, but `FP-1b` itself was still a row instead of living inside `FP-1`'s.

## Why

The map's rows are what a human approves, declares surfaces for, provisions a worktree for and hands to a worker. A cut of a functional point is not that: it is a piece of the point, and the point is what gets delegated. Showing both the parent and its cuts as rows doubles the plan and hides which unit the work belongs to. The user's own roadmap numbers them as a hierarchy, and the map should read the hierarchy it already writes.

## Decisions

**D1 — A code is a row when it starts with the declared prefix and what follows the prefix is digits and hyphens only** (`^\d+(-\d+)*$`). `FP-0` … `FP-9` are rows. `FP-0b` and `FP-1a` carry a letter after the number; `FP-1b.0` carries a dot; `FP-1a2` carries a letter inside the number; none of them is a row. The first version of this decision used three conditions — prefix, ends with a digit, no dot — and a verification round showed they were not enough: `FP-1a2` satisfies all three *and* extends `FP-1`, so it was both a row and a sub-element of another row, contradicting the sentence that says an extending code belongs inside rather than becoming its own capability. One condition over the remainder replaces three over the whole code, and it cannot overlap D2.

**D2 — Every other unit whose code extends a row's code is a sub-element of it.** A code extends another when it starts with it, is longer, and its next character is a **letter or a dot**. So `FP-1` owns the lettered cuts and their dotted steps alike, because the explanation of a functional point is where its whole inside belongs, and the two rules are disjoint by construction: a row's remainder is digits and hyphens only, so nothing that follows a row's code with a hyphen can extend it, and nothing with a letter or a dot after a row's code can be a row. `FP-1a2` is a sub-element of `FP-1` and not a row; `FP-1-2` is a row and not a sub-element. The set is enumerated here rather than abbreviated, because an ellipsis cost a round: the implementing worker read `FP-1b.0 … FP-1b.8` as the contiguous range `.0` through `.8` and counted nine where the documents declare thirteen.

- `FP-1a` (1) and its six steps `FP-1a.1`, `FP-1a.2`, `FP-1a.3`, `FP-1a.4`, `FP-1a.5`, `FP-1a.6` (6) — seven in all;
- `FP-1b` (1) and its thirteen steps `FP-1b.0`, `FP-1b.1a`, `FP-1b.1`, `FP-1b.2`, `FP-1b.3`, `FP-1b.3a`, `FP-1b.3a-b`, `FP-1b.3b`, `FP-1b.4`, `FP-1b.5`, `FP-1b.6`, `FP-1b.7`, `FP-1b.8` (13) — fourteen in all;
- therefore **twenty-one**, which is the number the acceptance criteria require.

**D3 — The explanation renders them as a tree, indented by the code's own depth.** The depth is the number of dots in the code plus one, so `FP-1a` sits one level in and `FP-1b.0` two, and the hierarchy the document writes is visible without a second relation to derive. The count states the total, and each entry keeps the code, the title and the state glyph the previous unit established.

**D4 — A unit that extends nothing and is not a row is neither a row nor a sub-element.** A code with no digit at its end that extends no row's code — a word-shaped code, say — stays out of both. It is still counted among the units read as steps, so the map's assumption keeps accounting for it.

**D5 — The state, the glyph vocabulary and the untouched description do not change.** The list keeps the card's glyphs, the description stays byte-identical to protect the stored translations, and nothing about Coverage changes.

## Scope

- The row rule in the generator: the letter condition joins the dot condition.
- The collector: the extension rule replaces the dot-prefix rule, with the not-a-digit guard.
- The explanation's rendering: indentation by depth.
- The tests and `docs/project-map.md`.

## Non-goals

- A second configuration key. The rule is derived from the codes the project already writes; the prefix is what is declared.
- Any schema change. The map still records only the rows.
- Translating the list. Still its own unit.
- Changing the delegable prefix key or the roadmap key.

## Constraints

- Strict TDD, the repository's style, no new dependency and no new `lib/` file.
- The collector stays pure and deterministic.
- Single writer, one commit per work unit, no push.

## Authorized edit surfaces

- `lib/shell-project-map-draft.ts`
- `lib/project-map-help-modal.ts`
- `tests/shell-project-map-draft.test.ts`
- `tests/project-map-help-modal.test.ts`
- `tests/gentle-project-map.test.ts`
- `docs/project-map.md`
- `odd/tasks/project-map-sub-numbering.md`

## Acceptance criteria

1. With junglex's real config and its 22 documents, the map declares **ten** capabilities: `FP-0`, `FP-1`, `FP-2`, `FP-3`, `FP-4`, `FP-5`, `FP-6`, `FP-7`, `FP-8`, `FP-9` — and not `FP-0b`, `FP-1a` or `FP-1b`.
2. `FP-1`'s explanation lists twenty-one sub-elements as a tree: `FP-1a` and its six dotted steps, `FP-1b` and its thirteen — the lettered cuts one level in, their steps two.
3. `FP-0`'s explanation lists `FP-0b` alone.
4. A code that only shares a prefix without extending it is not a sub-element: `FP-10` is not one of `FP-1`, and `FP-1b` is not one of `FP-1a`. And the two rules are disjoint: `FP-1a2` is a sub-element of `FP-1` and **not** a row, while `FP-1-2` is a row and **not** a sub-element of `FP-1`.
5. Without the key every previous behaviour is byte-identical, and a unit that extends nothing and is not a row is still counted as a step.
6. Gates: the full suite, `check-types` at its baseline, the package resource check, and `git diff --check` reported by its exit code.

## Not done, and why

- **The artifact is not regenerated here.** junglex's map still holds the thirteen-capability draft until the maintainer runs `draft` again; the tool change is what makes that draft come out with ten.
- **Sub-elements are not translated** (unchanged from the previous unit).
- **The card does not change.** Rows and Coverage follow the row rule; the tree is the explanation's.
