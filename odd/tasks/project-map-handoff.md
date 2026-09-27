# Project Map — handoff

Prepared 2026-09-27 at the end of the session that built the capability help. **Read this top to bottom before touching anything**; it is self-contained and does not assume you know the initiative's history. The unit documents it points at carry the detail.

## State, verified at handoff

Repo `/home/facundo/projects/project-map-preview`, branch `feat/project-map-orchestration`, HEAD **`832ac1de`**, working tree clean, **in sync with `origin`**, a single worktree, no `review/*` branches left behind. RDD reads **`off (decided by clone_local)`** with `global: on`. Gates at this HEAD: suite **4,043 (4,005 passed, 38 skipped, 0 failed)**, type baseline **195** with no regressions, package resource check **198 files**, provider contract, generated runtime modules, runtime harness and `git diff --check` all **0**.

Eight `pi` sessions are running on this machine. Four have `cwd` in junglex (`301336` inside tmux, `1263644`, `1934339`, `2008941` outside it) and two in this repo (`3886318` inside tmux, `1709727` outside it). That split matters for anything that hovers — see the operational facts.

## What this session delivered

Nine commits since the last native review pass closed at `dec195d6`. All are pushed.

| Commit | What it is |
| --- | --- |
| `abadb715` | **Zero-config**: an empty argument routes to a new `ensure` sub-action instead of being a usage error, so `/gentle:project-map` ensures a map exists and shows it; generating the plan prints it and asks for confirmation |
| `b17c42b1` | Its documentation, and the command-surface count it stated was stale (ten while the union defined eleven, now twelve) |
| `c5d34609` | **The `apply.test_command` defect**: the config reader now follows the nesting, so `integrate`'s gating `verification` check can read the OpenSpec shape `sdd-init` itself writes. Verified against a real project: junglex's `rules.apply.test_command` is read as `npm run test:ts` |
| `4a30b04f` | The confirmation back to `ctx.ui.confirm`, the dialog every other write in this command already uses |
| `65d49b85` | **Capability rows are one line at any width**, identifier truncated in the middle, `—` for an undeclared surface; coverage packed to the real inner width |
| `b7fdef52` + `40b71533` | A coverage clip and its revert. **Net no-op** — the pair cancels out |
| `bc2c99ab` | **The description reader** (`lib/project-map-description.ts`) and **the help modal** (`lib/project-map-help-modal.ts`), both pure and both pinned in the pack list |
| `832ac1de` | **The `?` marker** on each capability row with its own click target, the `alt+e` shortcut, the wiring through `ctx.ui.custom`, and the documentation |

The unit documents are `odd/tasks/project-map-zero-config.md`, `odd/tasks/project-map-test-command-path.md`, `odd/tasks/project-map-card-presentation.md` and `odd/tasks/project-map-capability-help.md`. **Each ends with what it deliberately did not do** — read those before assuming a gap is an oversight.

## Operational facts this session paid for

These are not obvious and each cost something today.

1. **Every code change needs a `pi` restart to be visible.** Pi loads the package at startup; commits on disk are invisible to a running session. A full session was spent with the user looking at stale code and reporting a bug that was already fixed.
2. **`pi remove <pkg>` deletes the package directory**, and a session that had it loaded keeps resolving its package-local `gentle-ai` binary against the directory that no longer exists. Native review operations then fail with `package-local-binary-missing` until Pi restarts. Fix: restart, not `install-gentle-ai.mjs`.
3. **The globally installed package is now the local checkout.** `~/.pi/agent/settings.json` declares `../../projects/project-map-preview` and `npm:gentle-pi` was removed, because pi identifies local packages by absolute path and npm ones by name, so keeping both loads the thirteen shared extensions twice. Consequence: **the unreleased branch runs in every project**, not just this one. Reversible with `pi remove ../../projects/project-map-preview` + `pi install npm:gentle-pi`.
4. **Hover does not exist under `tmux`, `zellij` or `screen`.** pi-tui's alt-screen driver never forwards a plain move event there, so nothing that paints on hover ever activates; clicking works unchanged. `lib/shell-hover.ts` documents it. Half the running sessions are inside tmux.
5. **`openspec/project-map.json` is tracked in this repo**, because `4a30b04f` used `git add -A` and swept up the artifact the user had just generated. **This is an open decision**: keep it versioned (it is the plan of record) or remove it and ignore it. The fix is a new commit either way — the ratified policy is no history rewriting.
6. **The native review recipe inherited from PM-9 has two corrections** the runbook did not have: `baseRef` must be the **full 40-character** commit id (an abbreviated one is refused as `base-ref-unresolvable`, before authority), and the START input needs its **`mode: "ordinary"`** field or the range is read as a graph-v1 controller START and throws `Judgment Day graph-v1 START requires lineageId`.

## Open work, in priority order

### 1. A capability's meaning has no writer — and it blocks `open`

The map can record a capability's `surfaces` (through `declare`), its `approval` and its `contracts`. **`outcome`, `state`, `dependsOn`, `foundationRefs` and `featureDocs` have no writer at all** on the command surface: only the generator fills them, and only a hand edit changes them — which the next `draft` overwrites.

Two consequences, both real. The map cannot say what a capability *is*, which is why the help overlay reads the document instead. And **no capability can be set to `ready`**, which is exactly what `open` requires — so the executable half cannot be exercised end to end through the command surface. The generator only ever produces `planned` (`[ ]`) or `done` (`[x]`).

The fix is two sub-actions of the shape `declare` already has: `outcome <capability-id> <text>` and `state <capability-id> <state>`. **This is the highest-value open item**, because it unblocks the junglex test below.

### 2. Three ways a capability vanishes from a generated map

Measured against junglex's own documents. `lib/shell-project-map-draft.ts:26` matches only a line that is *exactly* `- [ ] **…**` and **ends** at the closing `**`.

- **Text after the closing `**` makes a work unit invisible with no omission at all.** `FP-1b.0` and `FP-1b.3` are in junglex's documents, are absent from its map, and appear in no omission list. Verified by running the pattern. This is the worst of the three because it leaves no trace.
- **A title that normalizes to more than 64 characters is dropped**, with an omission (`FP-6`, `AF-1`, `AF-2`, `OF-1`).
- **A document whose work units use another shape contributes nothing**, with an omission (three of junglex's nine documents).

The reader that explains a capability is deliberately more tolerant than the generator's pattern, so it can already find the work units the generator refuses.

### 3. The junglex parallel-development test — the user's stated goal

Verified state: **the map exists** (`openspec/project-map.json`, untracked there), it is a **draft**, with **27 capabilities and 2 foundations, 0 declared surfaces**, states 14 `planned` / 13 `done`. **No coordination store exists**, so nothing collides yet. Thirteen files are modified or untracked in that working tree — other sessions are working there.

The sequence, and what it needs:

```bash
export GENTLE_PI_PROJECT_MAP=1                 # the executable half is gated
/gentle:project-map declare <cap> <surface>... # 0 of 27 declare any surface
/gentle:project-map approve <actor>
/gentle:project-map state <cap> ready          # BLOCKED by open item 1
/gentle:project-map lead claim
/gentle:project-map worktree provision <cap>
/gentle:project-map open <cap>
```

`open` requires an **approved** map, a capability in **`ready`**, ready dependencies, no open blocker, no undecided proposed contract, a live claim, and a **provisioned** worktree — the launch target must already exist. A worktree already exists at `junglex-worktrees/fp-1b-storage-surface`, which is exactly the layout the feature derives; no collision unless a capability id matches.

### 4. Regenerating the map throws the declarations away

`generateProjectMapDraft` receives only the sources; it never reads the existing artifact, and a generated capability is born with `surfaces: []`. So updating a map today means regenerating, re-declaring every surface and approving again — 27 declarations in junglex, 49 in this repo. There is no plan-preserving path and no way to avoid it. A `draft` that merges surfaces by capability id is the obvious candidate.

### 5. The card's presentation, second slice

`odd/tasks/project-map-card-presentation.md` records it. This repo's own map renders **58 lines**, of which 48 are capabilities already `done`. The Todos card solves exactly this — *"done tasks fold into `✓ N done` and the open ones fill the remaining rows"* — and the map does not. Folding the done capabilities would take that card to roughly eleven lines. The same slice carries the Status/Todos idiom: section labels at column 0 with one-space rows and a blank line between sections, and the collapse control in the title. **It moves the click targets and the pinned rendered lines**, so it is deliberately separate.

### 6. Recorded but not built

- **The marker's hover treatment.** The card can paint, so highlighting the marker and previewing the description inside the card is possible; it is not implemented, and it would only paint where pi-tui delivers a move event. Recorded in the capability-help unit document and stated as not implemented in the reference.
- **The coverage summary at narrow widths.** The `…` clip was reverted because it hides surfaces, against the principle that an undeclared surface is shown as `—`. The honest alternative is one row per surface instead of one packed line.

## The native review pass is behind by six candidates

The last pass closed at `dec195d6`. RDD is `off`, so nothing has been reviewed since. One candidate per meaningful commit, with the ranges:

| Range | What it carries |
| --- | --- |
| `dec195d6..abadb715` | The zero-config feature: `ensure` and the confirmation |
| `b17c42b1..c5d34609` | The `apply.test_command` fix |
| `c5d34609..4a30b04f` | The confirmation revert |
| `4a30b04f..65d49b85` | Capability rows one line, coverage packed to the real width |
| `40b71533..bc2c99ab` | The description reader and the help modal |
| `bc2c99ab..832ac1de` | The `?` marker, the wiring and the docs |

**Exempt**: `abadb715..b17c42b1` (documentation only), and `65d49b85..b7fdef52..40b71533` (a change and its revert — the pair is a no-op).

Run it with the recipe in `odd/tasks/pm-9-rollout-e2e.md` plus the two corrections in the operational facts above: enable RDD for the clone, pin a sibling worktree at each candidate's **tip**, `inspect` and `start` with the **full** base commit id and `mode: ordinary`, `capture-group` twice (forecast, then the same bindings with the acknowledgement), `acknowledge-approved` to burn the authority, then remove the worktree and the branch. Return RDD to `off` at the end.

## What the user is waiting on

1. **The junglex parallel test** — blocked by open item 1.
2. **A decision on the tracked artifact** in this repo (operational fact 5).
3. **The review pass**, which is theirs to trigger: it is their switch and it spends real reviewer runs.
