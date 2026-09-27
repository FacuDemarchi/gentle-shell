# Project Map — rail presentation follow-ups

Status: **authorized 2026-09-27** by the user's report, after the capability-help handoff (`odd/tasks/project-map-handoff.md`). The user's words: *"fijate en el ancho del modal que se despliega al hacer click en ?, me tapa parte de project map"*, *"Fijate que le cambiaste el estilo/color a todos cuando te pedi que se lo cambiaras al project map, quiero que respoete el color y estilo del tema utilizado/configurado"*, and *"Quiero que el project map este debajo del todos"*.

## Objective

Make the Project Map card and the help modal sit in the rail without fighting the surfaces around them: the modal must not cover the card it explains, the card must paint the theme's frame like every other rail card, and the card must sit below Todos.

## Problem

Three defects, all measured against the code and against the user's terminal (193 columns, fullscreen rail active, so the rail's 50 columns are the rightmost of the screen).

1. **The help modal covers the rail.** `explainProjectMapCapability` (`extensions/gentle-project-map.ts:396`) opens the overlay with `{ anchor: "center", width: "80%", minWidth: 60, maxHeight: "85%" }`. At 193 columns that is 154 columns centered (19–173) while the rail occupies 143–193, so the modal eats 31 columns of the rail — part of the Project Map card. `docs/gentle-shell.md` also fixes the shell convention: the command palette overlay (`extensions/gentle-shell.ts:652`) uses 70%.
2. **The card's frame ignores the theme's card convention.** `projectMapCardDescriptor` (`lib/shell-project-map-view.ts:350`) paints `tone: success` when the map is approved and `warning` otherwise. `docs/gentle-shell.md:37` states the convention the card breaks: *every card paints the same rose frame — the rounded border in the theme's plain border role, the title in the accent role — the look every `CARD_TONE.INFO` card uses*. Status and Todos are `INFO`; the Project Map is the only rail card that paints yellow/green. The approval state is already in the subtitle, so the tone carries no information the reader needs.
3. **The rail order puts the map above Todos.** `lib/shell-sidebar-layout.ts:207` fixes the section order to `["footer", "project-map", "agents", "todo"]`, i.e. Status → Project Map → Agents → Todos. The user wants the map last.

## Decisions

**A. The modal reserves the rail's columns instead of covering them.** When the fullscreen rail owns the host, the overlay anchors `left-center`, takes a right margin equal to the rail width plus the frame gap, and keeps a left margin; when the rail is not active it stays centered. The rail width and the breakpoint stay owned by `lib/shell-sidebar-layout.ts` and are exported, so the overlay cannot drift from the geometry that reserves the rail.

**B. The card paints the theme's card frame.** The ready descriptor is `tone: "info"`; `invalid` keeps `error`, which is the theme's own error role and is a real failure rather than a lifecycle state. The approval state stays in the subtitle exactly as it is today.

**C. The order is the rail's, and only the rail's.** The section list moves `project-map` to the end. The non-fullscreen `belowEditor` card is unchanged: there is no rail there, and the user's report is about the fullscreen layout.

## Slices

- **PMPR-1 — the card's tone.** `tone: "info"` for a ready map; tests pin it for draft and approved.
- **PMPR-2 — the rail order.** `["footer", "agents", "todo", "project-map"]`; the layout test pins the new order.
- **PMPR-3 — the modal's columns.** The overlay anchors left and reserves the rail when it is active; the extension passes the rail width it reads from the sidebar state; tests pin both option sets.
- **PMPR-4 — the documentation.** `docs/gentle-shell.md` and `docs/project-map.md` carry the new order and the modal's geometry.

## Acceptance criteria

1. A ready Project Map card descriptor is `tone: "info"` for both a draft and an approved map, and `error` for an invalid one, so the card paints the theme's rose frame like Status and Todos.
2. A fullscreen rail with the Project Map and Todos registered renders Status → Agents → Todos → Project Map.
3. With the rail active, the help overlay is anchored left and its right margin is the rail width, so the overlay's columns never reach the rail; with no rail, it opens centered at the shell's 70%.
4. The approval state remains readable in the card's subtitle.
5. The focused suites and the type baseline stay green.

## Non-goals

- The handoff's open work: a writer for a capability's meaning, the generator's three extraction failures, the junglex parallel test, the plan-preserving regeneration, and the PMCP-2 Status/Todos idiom for section labels and Coverage rows.
- The native review pass the handoff lists; RDD is off and the switch is the user's.
- Any change to the non-fullscreen `belowEditor` card placement.
