# Project Map — a launch marker on the capability row

Status: **authorized 2026-09-27.** The user's words, in order: *"un orquestador que mantenga el project map y sea el que defina si se puede o no lanzar a otro orquestador en otra pestaña"*, then *"b"* (choosing the derived predicate over a `state` writer), then *"el icono solo si se puede lanzar, sino que no aparezca"*, *"la pondria entre ? y el check"*, and finally *"usa ✿ listo"*.

## Objective

Make the card answer, at a glance, which capability can be opened in a parallel session right now, and make that answer clickable: a `✿` between the `?` marker and the lifecycle glyph, drawn only when the capability is launchable, launching the same flow `/gentle:project-map open` already runs.

## Problem

1. **Launchability is decided by a declaration nobody can write.** `projectMapOpenPiReadiness` (`lib/project-map-open-pi.ts:388`) refuses unless `capability.state === "ready"`, and no sub-action writes `state` — the generator only ever produces `planned` or `done`. So the whole executable half is unreachable from the command surface, and the card's `[Open Pi]` line can never light up.
2. **The card says nothing about it per row.** `[Open Pi]` is a line in the Inspector for the selected capability only (`lib/shell-project-map-view.ts:247`), and the Inspector sits at the bottom of a 69-line card, so it is effectively invisible. The row carries no launch affordance at all.
3. **Nothing launches from the card.** The card's hit model has three targets (`lib/shell-project-map-card.ts:132-147`): the group header, the capability row, and the `?` marker. `open` is reachable only by typing the command.

## Decisions

**A. Launchability is derived from evidence, not declared.** `projectMapOpenPiReadiness` stops requiring the literal `ready`. A capability may be opened when the map is approved, its declared state is neither `done` nor `blocked`, its dependencies are ready, it has no open blocker and no proposed contract awaiting decision, its worktree is provisioned, and the host is available. The gate stays where it was, applied by the caller. The two new refusals are named `capability-done` and `capability-blocked`, because they are the only two declarations that still mean "do not start".

**B. The row marker is the cheap projection of that predicate.** A pure `lib/project-map-launchable.ts` derives the launchable set from one coordination read plus the worktree bindings: approved map, state neither `done` nor `blocked`, `dependencyReady`, no blockers, no proposed contracts, a binding for the capability, the gate, and the host. It deliberately skips the git re-verification the real plan performs, so the marker can over-report by one provisioning detail; the click always re-runs the real predicate and refuses with its reasons.

**C. The marker is `✿`, and it is drawn only when launchable.** It sits between the `?` and the lifecycle glyph, in the theme's `accent` role — the same glyph and role the shell's brand and prompt petal use, so it needs no patched font and no new color. A row that is not launchable keeps exactly the columns it has today.

**D. Clicking it runs the command the product already has.** The card reports the capability id and the extension calls `runProjectMapCommand("open <id>", ctx, { env })`, which shows the plan, asks once, and launches. No second launch path, no new confirmation semantics.

## Slices

- **PMLM-1 — the derived predicate.** `projectMapOpenPiReadiness` and its test table.
- **PMLM-2 — the launchable projection.** The pure module and its tests.
- **PMLM-3 — the row marker.** The column, the hit range, the accent paint, and the click.
- **PMLM-4 — the wiring.** The extension builds the set on a short refresh cadence and calls the command.
- **PMLM-5 — the documentation.** `docs/project-map.md` and the unit document.

## Acceptance criteria

1. A capability declared `planned`, `active` or `review` is openable when the rest of the evidence holds; `done` and `blocked` are refused with their own named diagnostic.
2. A capability row carries `✿` between the `?` and the lifecycle glyph exactly when the capability is in the launchable set, and its column is recorded so the hit range cannot drift from the paint.
3. A row without the marker is byte-identical to today's row.
4. Clicking the marker runs the `open` flow for that capability and does not change the selection.
5. The marker is painted with the theme's `accent` role, so it follows the configured theme.
6. Focused suites, the full unit suite and the type baseline stay green.

## Non-goals

- A `state` or `outcome` writer, and a plan-preserving regeneration. Option A was rejected for this unit; the map keeps being regenerated wholesale.
- Refusing a second launch while a live claim exists (`nextSafeAction === "work"`). Readiness does not gate on claims today, and changing that is its own decision.
- The Inspector, its visibility, and the Mustachi block in the launch overlay. The user left the Inspector alone and did not ask for the overlay artwork.
- Any dependency on a Nerd Font: the package uses no private-use glyphs and keeps it that way.

## Delivered

| Commit | What it carries |
| --- | --- |
| `28dc7c64` | The derived predicate: `done` and `blocked` are the only states that still refuse |
| `d202527e` | `lib/project-map-launchable.ts`, the cheap projection, pinned in the pack list |
| `4b2bdbec` | The `✿` marker: column, hit range, accent paint, and the digest fold |
| `45ced984` | The wiring: the launchable set on a two-second cadence, and the click running `open` |
| `b9e70fa6` | The documentation |
| `f1f0517b` | The two integration cases through the real extension |

Gates at delivery: unit suite 4,058 (4,020 passed, 38 skipped, 0 failed), type
baseline 195 with no regressions, package resource check 199 files, provider
contract, generated runtime modules, runtime harness and `git diff --check` all
0. RDD reads `off (decided by clone_local)`, so no native review ran.
