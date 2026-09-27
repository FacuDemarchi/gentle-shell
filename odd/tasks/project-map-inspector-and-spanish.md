# Project Map — retire the Inspector and say the explanation in Spanish

Status: **authorized 2026-09-27.** The user's words: *"entonces el inspector fuera?"*, then *"si y traducime el contenindo de ? al español"*.

## Objective

Delete the capability Inspector from the card, keep the one fact it alone carried by folding it into the `?` explanation, and say that explanation in Spanish — the language the documents it quotes are already written in.

## Problem

1. **The Inspector is a duplicate that is never seen.** It renders 13 of the card's 69 body lines at the very bottom of a rail whose viewport shows far fewer, and the selection reveal only scrolls to the *row* that was clicked, so it never comes into view. Its content overlaps the `?` modal almost completely: id and state, outcome, surfaces, foundations, dependencies, contracts and documents are all in both. What only the Inspector carried is the **static blockers** line — and `[Open Pi]`, which the `✿` marker replaced.
2. **It is also the card's most expensive work.** The Inspector is the only consumer of the real readiness predicate per selection (`projectMapOpenPiReadiness`: a store read, a worktree plan that runs git, and a tmux probe) on every selection change. Removing it removes that cost with it.
3. **The explanation speaks English around Spanish content.** The description the modal shows comes from the project's own ODD documents, which are written in Spanish; the labels and messages around it were English. The user reads a Spanish paragraph inside an English frame.

## Decisions

**A. The Inspector goes, and its one unique fact moves.** `inspectorLines` and the readiness plumbing it needed (`ProjectMapOpenPiReadinessView`, the `openPiReadiness` parameters of `projectMapCardBody`, `projectMapCardDescriptor` and `projectMapCardDigest`, and the card's `decisionFor` port) are deleted. The static blockers are computed by a new pure `projectMapStaticBlockers(map, capabilityId)` and rendered as one more fact line in the `?` modal. The `✿` marker is the launch affordance, so `[Open Pi]` has no replacement to make.

**B. The explanation is Spanish.** Every fixed string the modal owns is translated: the fact labels, `none` → `ninguno`, the two "nothing to read" messages, the state shown next to the id, and the footer's key hints. The description itself is already Spanish because the documents are. The card's own labels stay English for now, because the user asked for the `?` and translating the whole shell is a separate decision.

**C. The state is translated for display only.** The map keeps its frozen English values; the modal maps them to Spanish words so the title reads as one language.

## Slices

- **PMIX-1 — the blockers, extracted.** `projectMapStaticBlockers` and its tests.
- **PMIX-2 — the Inspector retired.** The view, the card and the extension lose the readiness plumbing; the Inspector tests go.
- **PMIX-3 — the explanation in Spanish.** The modal's strings, its tests, and the extension test that pinned an English sentence.
- **PMIX-4 — the documentation.** `docs/project-map.md`.

## Acceptance criteria

1. A ready card renders no Inspector, and the selection no longer changes the descriptor's body beyond the selected row's marker.
2. The `?` modal shows the static blockers when the capability has any, and `Bloqueos: ninguno` when it does not.
3. The card no longer asks for the real readiness predicate on selection: `projectMapCardRail` and `projectMapCardPart` have no readiness port.
4. Every fixed string the modal owns is Spanish, and the state next to the id is Spanish too.
5. Focused suites, the full unit suite and the type baseline stay green.

## Non-goals

- Translating the card's own labels (`Foundations`, `Product capabilities`, `Coverage`, `Inspector` is gone anyway) or any other shell surface. The user asked for the `?`.
- Any change to the map's schema, its canonical English state values, or the artifact.
- The `[Open Pi]` line: the `✿` marker already replaced it.

## Delivered

| Commit | What it carries |
| --- | --- |
| `d41866fa` | The explanation in Spanish, plus the static blockers it inherited |
| `cc3c06bb` | The Inspector retired, and with it the card's readiness port and its per-selection cost |
| `6336fc3c` | The documentation |

Gates at delivery: unit suite 4,059 (4,021 passed, 38 skipped, 0 failed), type
baseline 195 with no regressions, package resource check 199 files, provider
contract, generated runtime modules, runtime harness and `git diff --check` all
0. RDD reads `off (decided by clone_local)`, so no native review ran.
