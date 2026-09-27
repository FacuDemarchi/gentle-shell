# Project Map — one command, no configuration

Status: **authorized 2026-09-27**, two slices. The user's own words: *"yo quiero que con un `/gentle:project-map` se prenda y me muestre el mapa debajo de status lo demas no me importa... si no existe el plan que me lo genere automático"*, and, on the confirmation, *"que al generar el plan lo muestre y pida confirmación del usuario, que no sea por boton"*.

## Objective

Make the visible half of the Project Map reachable in one gesture: `/gentle:project-map` with no argument ensures a map exists, shows it below Status, and — when it has to generate one — shows the plan and asks for confirmation as text rather than as a dialog choice.

## Problem

Two gaps, both of them in the path a user actually walks, and neither of them about permissions:

1. **The bare command does nothing useful.** `parseProjectMapSubAction` returns `A sub-action is required. Usage: /gentle:project-map <draft|declare|approve|status|show|hide|lead|contract|worktree|open|integrate>` for an empty argument. The one gesture the feature is named after is the one gesture it refuses.
2. **Generating the plan asks through a dialog.** The `draft` route shows the derived plan with `notify` and then asks with `ctx.ui.confirm` — a selectable dialog. The user asked for the confirmation to be *text*, and the API already supports it: `ctx.ui.input` is used six times elsewhere in this repository.

There is a third gap that is not in this unit: the extension is not installed in a plain `pi` session, so the command does not exist until the checkout is installed as a package (`pi install .`). That is an install step, not a code defect, and `docs/readme-reference.md` already documents it.

## What this unit is not

- **Not a change to the opt-in gate.** The gate covers four routes — `worktree provision`, `open`, `lead claim|renew`, `contract propose|accept|reject`, `integrate` — and every one of them acts outside the artifact. Nothing this unit touches is gated, so no environment variable is needed to use it. The user explicitly said the executable half is not what they want.
- **Not auto-approval.** `approve` still needs an actor and declared surfaces. A generated map is a draft, and a draft renders in full: the card does not need an approved map to show anything.
- **Not the `apply.test_command` defect.** The map's config reader looks up a flat `apply.test_command` while this repository's own `sdd-init` writes `rules.apply.test_command` through a two-level reader, so `verification` cannot be satisfied on a config the product itself writes. Recorded separately; it needs its own candidate and its own design decision.

## Decisions

**A. What the bare command means.** `/gentle:project-map` with no argument routes to a new `ensure` sub-action, which is also typeable by name. With a valid artifact it makes the card visible for this session and reports the map's state; without one it runs the generation flow below. It never invents an approval and never touches the executable half.

**B. Generation shows the plan and asks by text.** The plan summary keeps going out through `notify` — project, counts, assumptions, omissions, and the current artifact's own diagnostics when it exists but is invalid — and the confirmation becomes `ctx.ui.input` with a typed answer. A dismissed prompt (`undefined`), an empty answer, or anything that is not an affirmative writes nothing and says so. The concurrent-writer re-read stays exactly where it is: the prompt is where a second writer gets its window.

**C. The affirmative is one word, and the refusal is the default.** Only `yes` (case-insensitive, trimmed) writes. Every other answer — including a dismissal, which is `undefined` and not a decline — is reported as not confirmed, because the user was asked and did not say yes.

## Slices

- **PMZC-1 — the default action.** `ensure` joins the sub-action list, an empty argument routes to it, and the route composes "generate if missing, then show" without duplicating the draft flow.
- **PMZC-2 — the text confirmation.** Plan generation asks with `ctx.ui.input`; the test harness gains an `input` answer channel and the tests that counted `confirmations` on the generation path move to it.
- **PMZC-3 — the documentation.** `docs/project-map.md` documents `ensure` and the typed confirmation, `docs/gentle-shell.md` states the one-gesture path, and the sub-action count the reference states is corrected.

## Acceptance criteria

1. `/gentle:project-map` with no argument and no artifact generates a draft, shows the plan, asks by text, and writes only on an affirmative answer.
2. The same command with a valid artifact writes nothing, makes the card visible for the session, and reports the map's state.
3. A dismissed or non-affirmative answer writes nothing and reports that nothing was written.
4. The artifact is re-read after the answer, and a change during the prompt refuses the write.
5. No route this unit touches consults the opt-in gate.
6. Every existing refusal keeps its own diagnostic and its own order: a usage error still precedes everything else.

## Non-goals

- Commit, push, PR, merge or release beyond the unit's own work-unit commits.
- Changing the confirmation of any other sub-action: `approve`, `declare`, `contract accept`, `worktree provision` and `open` keep their dialogs, because each of them decides something different from "write the plan I just generated".
- Auto-approval, inferred surfaces, or a persisted setting of any kind.
