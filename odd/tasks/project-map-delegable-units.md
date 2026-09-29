# Project Map — only the delegable units are rows

Status: **authorized 2026-09-29** by the maintainer's choice among four designs. The user's words: *"pero tiene que distinguir entre tareas que realizo, funcionalidades grandes como los f que pueden ser delegadas"*, and then, choosing the design: **"Convención de código declarada: sólo `FP-` es fila"**.

## Objective

Make the map's rows the units that can be **delegated** — the large functionalities — and keep the units the maintainer performs itself out of the row set, through a code convention the project declares once.

## Problem

The delivered model answers "which document is the roadmap", not "which unit is delegable". Two consequences the user hit:

1. With no roadmap declared, the map showed **129 rows** for junglex: the level-0 unit of every one of its 22 documents, mixing functional points (`FP-4 — Writable catalog`) with the sub-tasks and retrospective prose of feature documents (`blocker-final-verification-r7a-…`, `add-the-dual-member-mismatched-merchant-proofs`). The map's own assumption admitted the mixed granularity, which is honest but not the requirement.
2. Even with the roadmap declared, the distinction is *documental*: nothing in the map says a row is delegable. The only existing signal is the executable half's `✿` (`projectMapLaunchableSet`), which needs an approved map, a `ready` state, ready dependencies, no blockers and a provisioned worktree — so it appears late and says "can be opened now", not "is a functionality".

The schema has no field for this: `ProjectMapCapabilityV1` carries `id`, `outcome`, `foundationRefs`, `dependsOn`, `contracts`, `featureDocs`, `surfaces`, `state`. And the shape of a work unit cannot distinguish the two kinds, because a roadmap document and a feature document write the same `- [ ] **X — Y**` line.

## Why

The Project Map's purpose is parallel work: a capability is what a human approves, declares surfaces for, provisions a worktree for and hands to a worker. A row that nobody can delegate is noise in the one place that must stay readable, and a delegable functionality hidden among 129 sub-tasks cannot be found. The project already writes the distinction — its functional points carry a code, its steps carry a sub-numbering — so the map can read it instead of asking for a second document list.

## Decisions

**D1 — The convention is declared, once, in `openspec/config.yaml`.**

```yaml
project_map:
  delegable: FP-
```

The value is the code prefix a delegable unit carries.

**D2 — A unit is delegable when its code starts with the declared prefix and carries no dot.** The code is what the label writes before its separator, or the whole label when it writes no separator, so `- [ ] **FP-1**` is delegable like `- [ ] **FP-1 — Provisioning**`. Reproduced: junglex's `fp-1b-provisioning.md` holds nine level-0 units coded `FP-1b.0` … `FP-1b.8`. They are the steps of `FP-1b`, not functionalities, and the prefix alone would promote all nine to rows. A code that continues with a dot is a sub-numbering of another unit, so it is a step. `FP-1b` is a row; `FP-1b.0` is not, whichever document it lives in.

**D3 — The convention applies to whatever documents are in scope, so it works with or without a roadmap.** With `project_map.roadmap` declared, the documents are that one; with no roadmap declared, every supplied document is read and the convention alone decides the rows. This is what makes the convention usable on its own, which is the design the user chose.

**D4 — Everything else is a step, not a row, and it is reported once rather than per unit.** A level-0 unit whose code does not match is a step of the functionality that owns it: it is not a capability and not a row. Reporting each one would print 119 lines for junglex, so the count is stated in the map's assumptions instead, in the same way the roadmap assumption already states how many documents contributed none. The units themselves stay in their documents and the `?` still explains them. **The document-level omission keeps HEAD's rule and gains one condition**: a document that produced no capability is reported as declaring no readable work unit, exactly as before, *unless* the convention is what excluded them — in which case the step count already says so and the sentence would be false. A verification round found the difference: with `- [ ] **!!!**` and no convention, HEAD emitted both the specific "cannot be normalized" omission and the document-level one, and the first version of this slice dropped the second by counting readable units instead of produced capabilities.

**D5 — With the convention declared, the fallback assumption stops claiming mixed granularity.** Today, with no roadmap, the generator says every top-level work unit became a capability source and their granularity may be mixed. That is true only without a convention: when `project_map.delegable` is declared, the assumption says the units whose code does not match the convention were read as steps, so the map's own words match the map.

## Scope

- The config key and its reader, beside `readProjectMapRoadmapPath` and `readProjectMapSurfaceMap`.
- The row filter in the generator, applied to the units of whatever documents are in scope.
- The assumption switch, and the count of units read as steps.
- The tests that pin all of it, and `docs/project-map.md`.

## Non-goals

- Any schema change. `kind` as a per-capability field was one of the four designs offered and was **not** chosen; the capability contract stays as it is.
- Nesting steps under their functionality in the card. That was another offered design and was not chosen; the steps stay out of the row set, not folded beneath it.
- Renaming the card's group label. The user's illustration shows `Funcionalidades`, and changing the card's English label is a presentation decision with its own cost; it is offered as a follow-up rather than folded in here.
- Changing how the roadmap key works. Both keys are complementary: the roadmap says which document, the convention says which units.

## Constraints

- Strict TDD, the repository's style, no new dependency and no new `lib/` file.
- The filter must not change anything when the key is absent: the previous slices' behaviour is the fallback and stays byte-identical.
- Single writer, one commit per work unit, no push.

## Authorized edit surfaces

- `lib/shell-project-map-draft.ts`
- `tests/shell-project-map-draft.test.ts`
- `docs/project-map.md`
- `odd/tasks/project-map-delegable-units.md`

## Acceptance criteria

1. With `project_map.delegable: FP-` declared and no roadmap, junglex's 22 documents produce **13 capabilities** — `FP-0`, `FP-0b`, `FP-1`, `FP-1a`, `FP-1b`, `FP-2` … `FP-9` — and none of `FP-1b.0` … `FP-1b.8`, `DEL-*`, `OF-*`, `ODD-*` or `T-*`. The first version of this list omitted `FP-1` while still claiming thirteen, which the implementing worker caught: the roadmap declares thirteen top-level units and `FP-1` is one of them.
2. The same 13 appear with the roadmap declared as well, so the two keys agree rather than fight.
3. With no `delegable` key, every previous behaviour is byte-identical: capabilities, serialized map, omissions and assumptions — checked over both repositories' real sources **and over a synthetic corpus that includes the corner cases**, because real sources did not surface the document-level omission this slice first dropped.
4. An assumption states how many units were read as steps, and the fallback assumption no longer claims mixed granularity when the convention is declared.
5. A unit whose code does not match is never a capability and never produces a per-unit omission.
6. Gates: the full suite, `check-types` at its baseline with no regression, the package resource check, and `git diff --check` reported by its exit code.

## Not done, and why

- **The card's group label** still reads `Product capabilities`. The user's illustration shows `Funcionalidades`; renaming it is presentation, and this unit is about which units are rows.
- **Steps are not shown under their functionality.** The chosen design keeps them out of the row set.
- **The convention is not derived.** Nothing infers `FP-` from the documents; the project declares it, because a code prefix is a project fact.
