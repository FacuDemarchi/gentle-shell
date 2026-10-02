# Communication contract — how an ask becomes work here

Status: **recorded 2026-10-02**. Read-only reflection; no code changed. This
document does not live under `docs/` on purpose: `docs/` is in the package
`files` array, so anything there ships to npm. This is a working agreement for
this fork, not a product artifact.

Evidence base: 218 commits (2026-09-27 → 2026-10-01), 59 documents in
`odd/tasks/`, 22 of them quoting the human's verbatim ask, 31 commits that are
corrections, reverts or fixes (~14%), 3 documents with three or more
verification rounds.

---

## 1. The real objective

**Declared:** Project Map Orchestration — a persistent, human-approved
architectural map (`openspec/project-map.json`) plus a multi-worktree capability
lifecycle: satellites, shared contracts, isolated worktrees, integration
readiness, rollout.

**Real:** this is not a product feature, it is the **cockpit** — the control
surface for directing several agents across several surfaces at once. Of the six
feature families, only the Project Map is the map itself; the rest is review
authority, models and usage, ODD routing, session tabs and shell visuals.

The structural consequence: **this is a meta-project.** The harness is used while
it is being built, so every convention change is simultaneously a product
decision and a workflow decision, and the cost of being wrong is doubled.

| Measure | Value |
| --- | --- |
| Own commits | 218 in 5 days |
| ODD documents | 59 |
| Documents quoting the verbatim ask | 22 / 59 |
| Correction / revert / fix commits | 31 / 218 (14%) |
| Documents with 3+ verification rounds | 3 |
| `HEAD` vs `upstream/main` | +218 / −262 |
| Branches in the fork | 171 |

---

## 2. What is kept, and why

One unit is one document with explicit authorization: the human's literal words
quoted, scope, non-goals, authorized edit surfaces, acceptance criteria. Then a
bounded writer, an independent verifier, recorded corrections, one work-unit
commit, and a memory mirror.

The 14% correction rate is the mechanism working, not a failure. A revert such
as `c05ef431 revert: undo the artifact-language setting` is the safety net
closing. What makes this analyzable at all is that **the correction and its
reason are written down** next to the words that authorized the work.

---

## 3. Where understanding broke: six archetypes

1. **Modelling the domain instead of measuring the real project.** Assumed every
   level-0 checkbox was a row; the real rows were the roadmap's functional
   points. `odd/tasks/project-map-roadmap-functional-points.md:3`
2. **Inventing unrequested policy.** The artifact-language setting and the
   Capability Inspector were both built without being asked for, and both were
   removed. `odd/tasks/project-map-inspector-and-spanish.md:3`
3. **Scope bleeding into sibling components.** Asked to restyle Project Map,
   Status and Todos were restyled too.
   `odd/tasks/project-map-rail-presentation.md:3`
4. **Shallow parsing that forces a re-ask.** Read the dot and missed the letter,
   so `FP-1a` stayed a row: *"me sigue apareciendo el fp-0b, fp-1a, etc ....."*.
   `odd/tasks/project-map-sub-numbering.md:3`
5. **Rigid geometry assumptions against a real terminal.** Fixed widths and a
   modal that covered the rail it was meant to explain.
6. **Over-engineering against zero friction.** An eleven-subaction CLI versus
   *"yo quiero que con un `/gentle:project-map` se prenda y me muestre el
   mapa"*. `odd/tasks/project-map-zero-config.md:3`

The irony worth keeping in view: the Project Map exists to cure archetypes 1 and
2. Deriving a row from a **convention the document declares** (`50c8bd5d`)
instead of guessing it from the shape of a code is the engineering answer to the
collaborator's failure modes.

---

## 4. The ask style (diagnosis, not criticism)

The human's asks are consistently:

- **Elliptical** — *"saca el Web · API · Data del project map, que quede dentro
  del ?"*: twelve words, no spec.
- **Deictic** — points at the screen (the `?`, *"eso"*, *"ahí"*) instead of
  naming the referent.
- **Outcome-first** — states the felt result (*"quedan re feos"*, *"siga el
  estilo del status y el todo"*) and deliberately omits the mechanism.
- **Symptom, not diagnosis** — reports the observation, not the cause.

None of that is wrong: it is the human's role to see the result and the agent's
role to derive the mechanism. The failure is that the agent **fills the gap by
inventing instead of measuring or asking**. The counter-evidence is in the same
corpus: when the ask was complete (`project-map-zero-config.md`), the unit closed
clean on the first attempt.

---

## 5. The contract

### The human's side

1. **Name the referent when it is on screen.** "The `?`" becomes "the modal that
   opens from `?` on the FP row".
2. **Declare the non-goal when one exists.** *"y no toques Status ni Todos"*
   removes half of archetype 3.
3. **Say "decidí vos" when delegating design, and only then.** Today it is
   inferred, and that is where the Inspector and the language policy came from.

### The agent's side

1. **Measure before modelling.** If the ask touches the data shape of an existing
   project, show the real counts before designing. No more "assumed every
   checkbox is a row".
2. **One question, at the right moment.** If the ask is elliptical *and* being
   wrong would cost a structural revert, ask once and wait.
3. **No new global policy without its own authorized unit.** Language,
   nomenclature, gates — each one is its own unit. Lesson of `c05ef431`.
4. **A change that touches a sibling is a finding, not a task.** Report it and
   continue with what was asked.

### The rule that cuts the two worst archetypes

**The cost of being wrong decides, not the ambiguity of the ask.**

- **Reversible or cosmetic** (colour, width, copy, row order) → decide, show,
  and let the human react to the result. No added ceremony.
- **Structural or policy** (new data field, new convention, new gate, anything
  that crosses component boundaries) → **one question, then wait.**

---

## 6. Open decisions

- The fate of the six feature families against `upstream/main` (+218 / −262):
  which land upstream, which stay in this fork. **Undecided.**
- The working tree is dirty and uncommitted: `extensions/gentle-ai.ts`,
  `tests/gentle-ai.test.ts`, `openspec/project-map.json`,
  `odd/tasks/project-map-spanish-translations.md`, plus untracked
  `odd/tasks/models-panel-visible-rows.md` and `openspec/project-map.es.json`.
  The models-panel unit is verified but has no commit and no review (RDD is off
  in this clone).
- This document is untracked and uncommitted: persisting it was decided, landing
  it was not.
