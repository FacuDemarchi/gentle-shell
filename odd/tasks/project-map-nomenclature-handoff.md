# Project Map — handoff: the nomenclature question

Prepared 2026-09-29 for a fresh session. **Read this top to bottom.** It is self-contained and does not assume the history that produced it. Its subject is one open question, stated in *What to analyze*; the state sections exist so nothing is lost and nothing is redone.

## The question, in the user's words

> *"Me parece que te estás agarrando mucho de la estructura que le pinto al orquestador en ese momento para organizarse él. creo que deberíamos formalizar al orquestador con una forma de nombrar las subtareas para que esto pueda extenderse a otros proyectos."*

Translated into the tool's terms: the rules that decide **which unit is a row** and **which unit is a sub-element of which row** are heuristics inferred from the code shapes of one project's documents — documents the user wrote for the orchestrator to organize itself at that moment. They are not a nomenclature a project declares on purpose, and they do not travel to another project. The ask is to analyze formalizing a **naming convention for sub-tasks** so the map's structure is declared rather than guessed.

## What the tool does today, exactly

Three declared keys in `openspec/config.yaml`, all added in this session, plus two derived rules:

| Key or rule | What it does | How it is decided |
| --- | --- | --- |
| `project_map.roadmap: <path>` | Names the one document whose units are capability sources | Declared |
| `project_map.delegable: <prefix>` | A code is a **row** when it starts with the prefix and what follows the prefix is digits and hyphens only (`/^\d+(-\d+)*$/`) | Declared prefix, **derived shape** |
| the sub-element relation | A unit is a **sub-element** of a row when its code starts with the row's code, is longer, and the next character is a letter or a dot | **Derived shape only** |
| `project_map.surfaces.<surface>: <prefixes>` | Maps a path in an `**Allowed edit surfaces:**` line to a surface | Declared |

Rows appear as the map's capabilities; sub-elements appear as a depth-indented tree inside the row's `?` explanation, with their state as the card's glyph.

## The evidence this session produced, which the analysis should start from

All of it is measured, not assumed.

1. **A roadmap document and a feature document write the same line.** `- [ ] **FP-4 — Writable catalog: …**` is indistinguishable, by shape, from `- [ ] **DEL-1 — Unify the invitation delivery port**`. So the shape cannot say which is a functional point and which is a unit of work. This is why the roadmap key exists at all.
2. **Indentation distinguishes levels only inside one document.** In junglex's roadmap, `FP-1a.1` is nested under `FP-1a`, but the same kind of unit is a level-0 entry in `odd/tasks/fp-1b-provisioning.md`. A sub-task is not reliably nested; it is often in its own document.
3. **Codes carry the hierarchy only when the project codes consistently — and junglex does not.** `FP-1b.0` … `FP-1b.8` live in `fp-1b-provisioning.md` and extend `FP-1b` by their code. But `FP-5`'s steps are coded `F5b-1` … in `odd/tasks/fp-5b-geocoding-truth-up.md`, which does **not** extend `FP-5`, so **`FP-5`'s explanation shows zero sub-elements while it has a document full of them**. Measured, and visible on screen.
4. **Deriving the rules from code shape is easy to get wrong.** The first version of the row rule used three conditions (prefix, ends with a digit, no dot) and a verification round produced `FP-1a2`, which satisfied all three *and* extended `FP-1` — so one code was a row **and** a sub-element of another row, contradicting the documentation. The current version replaced three conditions with one over the remainder and made the extension guard require a letter or a dot, which makes the two rules disjoint by construction. That took two correction rounds; a declared grammar would not have.
5. **Sub-numbering in junglex uses two marks, a letter and a dot.** `FP-0b` and `FP-1a` are cuts of `FP-0` and `FP-1`; `FP-1b.0` is a step of `FP-1b`. Reading only the dot was the mistake that made the user see `fp-0b, fp-1a, …` as rows.
6. **The documents are inconsistent about which mark they use.** `FP-3a-b` and `FP-1b.3a` are both in use; `F5b-1` uses neither. So even a good grammar would need the project to adopt it, not just declare it.
7. **The tool already has the "declare it" precedent twice** (`project_map.surfaces` and `project_map.delegable`), so a declared nomenclature fits the existing config surface rather than inventing a new one.
8. **The user's model, in their words:** *"tiene que distinguir entre tareas que realizo, funcionalidades grandes como los f que pueden ser delegadas."* Rows are the large functionalities that can be delegated — with surfaces, dependencies, a worktree; sub-elements are what the maintainer does itself, and they belong **inside** the functionality's explanation.
9. **The user's standing preference is zero friction**: earlier in the initiative they asked for `/gentle:project-map` to work as one gesture with no configuration. Any proposal that adds ceremony per project should say what it buys against that preference.

## Design space to analyze — not decided, and none of these is endorsed

Present them to the user with their costs; do not pick one.

1. **A declared grammar for codes.** The project declares how a row's code and a sub-task's code are written — a pattern, or a small template with placeholders (row, slice, step). Most explicit; a regular expression in a config file is a footgun, and the project must adopt it.
2. **A declared parent on the sub-task itself.** Each sub-task states which row it belongs to — in its line, in its own document's frontmatter, or in a field beside it. Makes the relation declared instead of inferred, and fixes evidence point 3 immediately. Costs a line per sub-task document.
3. **A declared relation between documents.** A document declares which functionality it belongs to, and every unit in it is that functionality's sub-task. One line per document, no re-coding of units, and it fixes `F5b-1` without touching the codes. Weakness: a document holding two functionalities' work cannot say so.
4. **A structured section convention.** A roadmap writes its functionalities and its tasks under known headings, or in a table. No config, but the project rewrites its documents, and prose-heavy roadmaps like junglex's do not fit tables.
5. **A machine-readable plan beside the documents.** The map reads a declared plan file listing the rows and their sub-tasks, with the ODD documents as evidence rather than as the source of structure. The most formal and the most portable; the plan is then a second artifact to keep true.

Whatever is chosen, the analysis should answer: **what does another project have to write, once, for the map to read its structure correctly?** If the answer is "nothing", the tool is guessing again.

## What is already decided and should not be reopened

- Rows are the delegable units and the map shows only them; sub-elements belong inside the row's explanation as a depth-indented tree.
- The explanation's list uses the card's state glyphs, not the overlay's Spanish state word (the word agrees with *capability*; a *subelemento* would disagree in gender).
- The description is never filtered: its lines are what the translation sidecar hashes, so changing them would invalidate every stored translation.
- The map artifact, Coverage, and the schema are untouched by all of this. There is no `kind` field and none was approved.
- Sub-elements are not translated; the structured list has no translated title field, and a nested sub-element's title inside the translated body is a different thing.

## State, verified at handoff

Repository `/home/facundo/projects/project-map-preview`, branch `feat/project-map-orchestration`, **nothing pushed** (the branch is far ahead of `origin`; pushing is the maintainer's decision).

The initiative's four units are delivered and committed: `project-map-roadmap-functional-points` (`a1f4f2c2`, `02e7f6bc`, `a51d12e2`, `d9a63596`, `dfdc93e2`, `3f6a8941`, `bfc5fdb5`, `422b0a9f`), `project-map-delegable-units` (`8c10347b`, `edd956e2`), `project-map-steps-in-explanation` (`1dc99ca0`, `d0462888`), and `project-map-sub-numbering`, whose **candidate is uncommitted** at handoff (see below).

**Delivered and committed**: `project-map-sub-numbering` as `46f9b998`, and this handoff with its unit document as the docs-only commit that follows it. The verification of the disjointness closed **verified**, and with a proof rather than examples: with the prefix fixed, every row's remainder is digits and hyphens, so anything extending it must introduce a letter or a dot and therefore cannot be a row itself. That round also found the word "letter" restricted to ASCII in the code — `FP-1é` was excluded — which the candidate fixed with a unicode letter class and a test before the commit. **Two entries in the tree are the maintainer's and must not be swept into a commit**: the modified `odd/tasks/project-map-spanish-translations.md` and the untracked `openspec/project-map.es.json`.

**Also outside this repository**: `junglex/openspec/config.yaml` carries the `project_map` block this session added — `roadmap: odd/tasks/first-merchant-pilot.md`, `delegable: FP-`, and the surface mapping built from that repository's real paths. junglex's `openspec/project-map.json` is a **draft with thirteen capabilities** and must be regenerated with `/gentle:project-map draft` (**not** `ensure`, which preserves it) to come out with the ten rows the current rules produce. That config edit is the maintainer's and is already made; do not re-do it.

**Gates at the last full run**: 4126 tests, 4088 passed, 38 skipped, 0 failed; typecheck at its 195-diagnostic baseline with no regressions; package resource check 200 files; provider contract and runtime harness clean; `git diff --check` exits 0.

## Open items, in priority order

1. **The nomenclature question** — this document's subject.
2. **`FP-5` shows no sub-elements** although `odd/tasks/fp-5b-geocoding-truth-up.md` holds its steps, because `F5b-1` does not extend `FP-5` by code. Either the project re-codes them (`F5b-1` → `FP-5b.1`) or the analysis chooses an association that does not depend on the code (design options 2 and 3 above). The user has been shown both and has not chosen.
3. **Four functional points have no surfaces**, so the map cannot be approved: the schema requires at least one surface per capability, and `FP-0`, `FP-1a`, `FP-1b` and `FP-9` declare no `**Allowed edit surfaces:**` line. They are declared by hand with `declare`, and that is where the maintainer's judgement replaces the document's.
4. **Sub-elements are not translated**, so a Spanish frame shows their English titles. Fixing it needs a field for them in the translation sidecar — its own unit.
5. **The translation decoder accepts a blank or already-prefixed title**, and the freshness hash covers the body only, so a title-only edit keeps a stored translation "fresh". Both are recorded in the earlier unit documents; extending the hash would invalidate the 49 stored entries.
6. **The card's group label still reads `Product capabilities`.** The user's illustration showed `Funcionalidades`; it is presentation and was deliberately left out.

## Operational facts this session paid for

- **`git diff --check` writes its diagnostics to stderr and the harness can swallow them.** A blank line at the end of a test file survived a full review round because the command printed nothing where the report was read, and `git diff --check && echo clean` reads that silence as success. **Report the exit code, not the absence of text.**
- **A bare key in a configuration is a parent to the lines beneath it.** Widening the class that recognises bare keys inserts a nesting level that was previously ignored and reparents keys other readers resolve. A shared parser is not widened for one consumer's convenience.
- **In a contract, never abbreviate a list with an ellipsis.** `FP-1b.0 … FP-1b.8` was read as the contiguous range `.0` through `.8` and cost a round: the codes are not contiguous (`FP-1b.1a`, `.3a`, `.3a-b`, `.3b`, `.7` are among them). Enumerate.
- **A non-regression invariant is proved with a synthetic corpus of degenerate cases, not with the real sources you have at hand.** A real-source comparison against HEAD passed while a document-level omission was silently lost for a label that cannot become an identifier — a shape no real document contains.
- **A writer's allowed surfaces and a verifier's read-only role are not interchangeable.** A correction order was once sent to the read-only verifier by mistake; it was cancelled and the tree confirmed unchanged. Write authority belongs to a writer.
- **A word in a decision is a contract.** D2 said a sub-element continues with "a letter or a dot"; the code used an ASCII class, so `FP-1é` was not a continuation and the code contradicted its own documentation. It was one character to fix and one round to find. When a decision names a class — letter, digit, separator — the code must mean that class.
- **Every verification round in this session found something real**, and three of the findings were the orchestrator's own: a property asserted without testing it ("the row stays one line at any width"), a comment asserted to be true when it was not, and a test specified for a state that valid input cannot reach. The verifier is not ceremony.

## How the work has been run here

Strict TDD, one writer at a time, an independent read-only verifier per slice, work-unit commits with code, tests and documentation together, and no push. Each unit has its own document in `odd/tasks/` carrying its decisions, its acceptance criteria, and — in the sections named *Not done, and why* and *Corrections* — what was deliberately left out and what a verification refuted. Read those before assuming a gap is an oversight. `odd/tasks/project-map-handoff.md` is the older handoff of the same initiative and still holds the operational facts from before this session.
