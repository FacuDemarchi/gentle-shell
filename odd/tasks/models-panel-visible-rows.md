> **Superseded 2026-10-02, during the rebase onto `upstream/main`.** Upstream had
> already shipped this behaviour two days earlier, independently:
> `681c78f9 fix(models): size /gentle:models lists to the terminal height` and
> `a25633d9 fix(models): open /gentle:models fullscreen like /gentle:profiles`,
> both by Alan Buscaglia on 2026-09-25. Upstream’s `visibleListRows` produces the
> same arithmetic this unit measured — 16 model rows and 9 agent rows on a 24-row
> terminal, full-height overlay — with a different design: a `terminalRows`
> callback instead of a `renderRowBudget` provider.
>
> The rebase therefore kept upstreams implementation and dropped this unit’s
> `extensions/gentle-ai.ts` and `tests/gentle-ai.test.ts` changes. Two details of
> this unit are **not** in upstream’s version and are recorded as follow-up
> candidates: the non-finite and throwing budget guard, and `PANEL_MIN_LIST_ROWS
> = 3` instead of upstream’s floor of 1.
>
> The rest of this document is the record as delivered, kept for what it paid for.
# Show every model the terminal can hold in /gentle:models

## Objective
Make the model picker in `/gentle:models` show all — or as many as the terminal can hold — of the
available models, instead of the fixed twelve-row window it uses today, and keep the panel inside
its overlay budget on any terminal size.

## Problem
`SddModelPanel` sizes its two lists from fixed constants:

```ts
const MODEL_PANEL_MAX_RENDER_ROWS = 20;
const AGENT_LIST_MAX_VISIBLE_ROWS = MODEL_PANEL_MAX_RENDER_ROWS - 15; // 5
const MODEL_LIST_MAX_VISIBLE_ROWS = 12;
```

The overlay is opened with `width: "70%"`, `minWidth: 72`, `maxHeight: "85%"`, so the *box* can be
large while the *content* stays at 20 lines. The model picker therefore shows 12 of the registry's
models on every terminal, from a 24-row one to an 80-row one, and the picker draws no
"↑ N more / ↓ N more" hint, so the hidden remainder is invisible.

This is the second time the fixed budget bit: `models-update-current-profile.md` records that adding
two panel rows pushed the agent list past the 24-row 85% budget and the fix was to change the chrome
subtraction from 13 to 15. A terminal-derived budget removes that class of defect.

## Why
User request (2026-10-01): "se puede agrandar la pantalla de /gentle:models?" followed by
"modifical para que se muestren todos o la mayoria de modelos".

## Scope
- The panel computes its available rows from the live terminal (`tui.terminal.rows`), at render time,
  instead of a compile-time constant.
- `renderRowBudget` is injected into `SddModelPanel` so unit tests stay deterministic; without a
  provider the panel uses a fallback that reproduces today's output exactly.
- Both lists (agents and models) derive their visible rows from the same budget.
- The overlay's `maxHeight` and the content budget share one constant, so they cannot drift apart.
- The panel takes the whole terminal height (`MODEL_PANEL_HEIGHT_PERCENT = 100`, `margin: 0`), matching the
  precedent the agents view already sets in the same file.
- The effort picker is unchanged (it is short and fixed).

## Constraints
- No behavior change when the budget is unknown: same 20-line agent card, same 5 agent rows, same
  12 model rows. Existing render tests must pass untouched.
- The chrome subtraction stays exact. Agent list chrome is 15 rows (two borders, title, current-profile
  line, blank, "Current assignments:", blank, both scroll indicators, blank, Continue, Back, blank, two
  footer rows). Model picker chrome is 8 rows (two borders, title, blank, search, blank, blank, footer).
  The model picker gains no new rows, so its chrome stays 8.
- The window follows the cursor: a selected row is always inside the visible window.
- A minimum of 3 list rows is kept for degenerate budgets.
- One file for behavior (`extensions/gentle-ai.ts`), one for tests (`tests/gentle-ai.test.ts`).
- English artifacts; tabs, double quotes, explicit `.ts` imports per repo convention.

## Design decisions
- **Terminal-derived, not a bigger constant.** Raising `MODEL_LIST_MAX_VISIBLE_ROWS` to, say, 40 would
  clip on any terminal under ~48 rows and still hide models on a taller one.
- **Read at render time through a provider, not once at construction.** `render()` is called on every
  frame, so a resize is picked up without re-creating the panel.
- **Single source of truth for the height.** `maxHeight` is built from the same percentage constant the
  budget math uses, because the two disagreeing is exactly how the earlier 13-vs-15 defect happened.
- **Floor, matching Pi.** `parseSizeValue` resolves `"100%"` as `Math.floor(rows * 100 / 100)`; the budget
  helper uses the same floor so the content can never be one line taller than the clamp.
- **Full height over a bigger constant.** The first revision kept the panel's original 85%, which still left 12
  rows on a 24-row terminal — the same number the fixed constant produced. Taking the whole height turns that
  into 16 rows, and 34 on a 40-row terminal. Pi clamps `maxHeight` to `termHeight - margins`, and the margins
  are zero, so a content of exactly `budget` lines fits with nothing clipped.
- **Fallback over hard failure.** A missing terminal signal falls back to the current 20-row budget rather than
  failing; tests and any non-TUI caller keep today's deterministic output. The fallback constant **is** a row
  budget, so it is returned unchanged instead of being multiplied by the percentage, and a provider that throws
  is caught rather than allowed to abort a render.

## Tasks
- **T1 — Panel budget plumbing and dynamic list sizing.** `MODEL_PANEL_HEIGHT_PERCENT`, the fallback
  budget, per-mode chrome constants, `modelPanelRowBudget`, the injected provider on `SddModelPanel`,
  and the `showSddModelPanel` wiring. Update the testing helper with an optional budget and key feed.
- **T2 — Tests.** Behavior tests for the budget (tall terminal shows every model, small terminal shrinks,
  cursor stays in the window) plus the fallback regression that pins today's 20-line output.
- **T3 — Independent verification.** A read-only verifier tries to falsify T1 and T2 against this
  document, in particular that the fallback is unchanged and the content never exceeds the clamp.

## Acceptance criteria
1. **Tall terminal shows all models.** With a budget of 40 rows, the picker lists every model option
   instead of the first twelve, and the selected row stays visible when the cursor moves to the end of
   the list.
2. **The content never exceeds the clamp, except where the minimum rows win.** For any budget, rendered lines
   are `<= max(PANEL_MIN_LIST_ROWS + chrome, budget)`, and `<= floor(terminalRows * 100 / 100)` whenever the
   budget leaves room for the chrome plus the 3-row minimum. On a terminal too short for its own chrome (a
   budget of 8, from an 8-row terminal) the minimum rows and the chrome are preserved and Pi clips the tail:
   11 lines for the picker and 18 for the agent list. Shrinking the chrome itself is out of scope.
3. **Small terminals shrink, not clip.** A budget of 20 keeps the current 5 agent rows / 12 model rows;
   a smaller budget reduces the list further down to the 3-row minimum. A non-finite terminal height returns
   the 20-row fallback budget unchanged, and a budget provider that throws is caught and treated as the
   fallback, so no render can be aborted by a bad budget.
4. **The unknown-budget fallback is byte-identical to today.** `renderSddModelPanel` without a budget
   produces exactly the previous output for the agent list.
5. **One constant for the height.** `overlayOptions.maxHeight` is derived from the same constant as the
   budget math; changing the constant changes both.
6. **No new list rows.** The model picker's chrome stays at 8 rows, so the budget arithmetic is exact.
7. **Gates.** Focused `node --experimental-strip-types --test tests/gentle-ai.test.ts` green, and
   `node scripts/check-types.mjs` at its recorded baseline with no regression.

## Not done, and why
- **No overflow indicator on the model picker.** Adding "↑ N more" rows to the picker would make its
  chrome conditional and break the exact arithmetic this unit establishes. Search is the intended path
  for a pool larger than the terminal. Recorded as a follow-up candidate.
- **No chrome compression.** Merging the title and the search line and dropping the two blank rows would buy
  three more model rows (19 instead of 16 on a 24-row terminal), but it redesigns the picker's look. Left to the
  user as a follow-up rather than assumed.
- **The height percentage is not exposed as a user setting.** The user asked for a bigger view, not for a knob;
  the constant is now in one place if that changes.

## Progress
- T1/T2 delegated to `gentle-ai-worker`; repo declares `strict_tdd: true` in `openspec/config.yaml`, so
  RED before GREEN with the focused runner.
- T3 independent verification (read-only) falsified two claims of the first revision and both were corrected in
  a bounded second round:
  - The fallback was applied as terminal rows, so `modelPanelRowBudget(NaN)` returned 17 instead of the 20-row
    fallback budget, silently shrinking the agent list to 3 rows. The constant is now returned unchanged.
  - A throwing budget provider propagated out of `render()` and killed the panel. It is now caught and treated
    as the fallback.
  - The clause "never exceeds the terminal clamp" was false on a terminal shorter than its own chrome; acceptance
    criterion 2 was corrected and the degenerate geometry is now pinned by a test (budget 8: 11 picker lines,
    18 agent-list lines).
- Verified after correction: focused panel tests 8/8, `node --experimental-strip-types --test
  tests/gentle-ai.test.ts` 85 passed / 0 failed, `node scripts/check-types.mjs` 195 recorded diagnostics with no
  regression.
- Fourth round: the user was offered 85% / full height / full height with compressed chrome and chose to let the
  parent decide. The panel now takes the whole terminal height (`MODEL_PANEL_HEIGHT_PERCENT = 100`, `margin: 0`),
  and the two test literals that hard-coded 85 derive from the exported constant. Verification caught one stale
  assertion in the degenerate test (`modelPanelRowBudget(10) === 8` was only true at 85%); it now derives the
  degenerate budget from an 8-row terminal, which is genuinely too short under the new ratio.
- Observed effect, from the verified arithmetic: picker rows are `floor(terminalRows * 1.00) - 8` — 16 on a
  24-row terminal and 34 on a 40-row one, against a fixed 12 before — and agent rows are `budget - 15`, 9 on a
  24-row terminal against a fixed 5 before.
- Final gates after the last edit: focused panel tests 8/8, `tests/gentle-ai.test.ts` 85 passed / 0 failed,
  `check-types.mjs` 195 diagnostics with no regression, and the degenerate geometry re-confirmed at 11 picker
  lines / 18 agent-list lines with no `NaN` or `undefined`.
- Native review: not run. The user-owned switch for this clone reads
  `receipt-driven development: off (decided by clone_local)` with `global: on`, and off wins, so the preflight
  never applies to this candidate.

## Next step
The unit is complete and verified in the working tree. Commit/PR stays the user's decision, and so does
enabling the native review switch for this clone if the user wants that check.

Open follow-up candidates, deliberately not done here:
- An overflow indicator on the model picker (`↑ N more / ↓ N more`), which needs conditional chrome and the
  arithmetic that implies.
- Chrome compression (title and search on one line, no blank rows) for three more model rows.
- The height percentage as a user setting, now that it is 100%.
