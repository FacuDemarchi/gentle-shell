# Project Map — explaining a capability

Status: **authorized 2026-09-27.** The user's words: *"a la izquierda del capability, a la izquierda del check ... quiero que este un signo (?) el signo encerrado en un circulo, que en on hover despliegue la pantalla tipo modal de una pagina web con la descripción de la capability"*, and then *"no entiendo que son cada capability de por si"*.

## Objective

Make a capability explainable from the card: a `?` marker on each row opens a modal that says what that capability is, in the words the project already wrote.

## Problem

Three separate gaps produce one confusion.

1. **The map has no description of a capability.** `extractWorkUnits` sets `outcome` to the work unit's title verbatim, so `id` and `outcome` are two renderings of one string: `close-the-gate` and `Close the gate`. The Inspector prints `Outcome: Close the gate` and adds nothing.
2. **The description exists, one line below.** In an ODD document the work unit's body — its indented sub-bullets — is the description, and the generator reads only the checkbox line and discards the body.
3. **There is nowhere to ask.** The card shows a row per capability; the only way to learn more is the Inspector, which repeats the id.

## Decisions

**A. The description comes from the feature document, not from the map.** No schema change: `featureDocs` is already a field, and the reader walks the document for the work unit whose normalized title equals the capability id and returns its body. This is generic — it assumes the ODD document shape, which is the shape the generator already parses, and it needs nothing from any particular project.

**B. The `?` opens the modal on click, not on hover.** The card lives inside the rail and its `handleMouse` is synchronous: it can paint, but it cannot open an overlay, which is an awaited `ctx.ui.custom` owned by the extension. A modal that opened on hover would also stay open after the pointer left the row, because nothing on the card can close it. Hover keeps its own treatment — the marker paints in the shared hover role and a one-line preview appears inside the card — and it is honest about being unavailable under tmux, zellij and screen, where pi-tui never delivers a plain move event.

**C. The modal is reached without a mouse too.** `alt+e` explains the selected capability, with `GENTLE_PI_PROJECT_MAP_HELP_KEY` to rebind it and the same empty-value/`off` semantics the other map keys use. The selection is what `alt+j`/`alt+k` already move.

**D. The modal is a pure component.** Like the command palette, it takes data and a `done` callback, imports no Pi API, and is exercised without a session.

## Slices

- **PMCH-1 — the description reader.** `lib/project-map-description.ts`: from a document's text and a capability id, the work unit's body as plain lines. Tolerant of the trailing text after the closing `**` that the generator's own pattern refuses, because a reader that matched only what the writer accepts would inherit the same blind spot.
- **PMCH-2 — the help modal.** `lib/project-map-help-modal.ts`: the capability's declared facts plus the description, in the shell's rounded frame, scrollable, closed with escape/enter/ctrl+c.
- **PMCH-3 — the marker and its target.** `?` left of the lifecycle glyph, its own hit range so clicking it explains instead of selecting, and a hovered treatment.
- **PMCH-4 — the wiring.** An `onExplain` callback on the card part, `ctx.ui.custom` with a centered overlay, and the `alt+e` shortcut.
- **PMCH-5 — the documentation.** `docs/project-map.md` gains an *Explaining a capability* section and `docs/gentle-shell.md` names the marker and the key.

## Follow-up work this unit does not do

- **The marker's hover treatment.** The card's pointer handler can paint, so highlighting the marker and previewing the description on one line inside the card is possible; it is not implemented, and it would only ever paint where pi-tui delivers a plain move event (`tmux`, `zellij` and `screen` do not). Recorded rather than claimed in the reference.
- **The extraction failures.** A work unit line with text after its closing `**` is invisible in the map with no omission, a title over 64 characters is dropped, and a document whose work units use another shape contributes nothing. All three are recorded findings that need their own candidate.
- **Writing a capability's meaning.** `outcome`, `state`, `dependsOn`, `foundationRefs` and `featureDocs` have no writer on the command surface, so a capability can only be described by its document and a `state` cannot be set to `ready`, which `open` requires.

## Acceptance criteria

1. A capability row carries `?` left of its lifecycle glyph, and the row stays one line at every width.
2. Clicking the `?` explains that capability; clicking elsewhere on the row selects it, exactly as before.
3. `alt+e` explains the selected capability, and works without a mouse.
4. The modal shows the capability's declared facts and its description when the feature document carries one, and says plainly when it carries none.
5. The reader is generic: it takes a document's text, and it does not assume any project's naming, paths or language.
6. A description that is longer than the modal scrolls rather than being clipped away.

## Non-goals

- Any schema change: the map keeps its frozen v1 fields.
- Fixing the generator's extraction failures (trailing text after `**`, the 64-character identifier cap, documents that contribute nothing). Those are recorded as their own finding and need their own candidate.
- A `state` or `outcome` sub-action. Both are real gaps, both are separate.
