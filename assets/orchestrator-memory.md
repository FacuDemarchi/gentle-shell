# Orchestrator — Memory Detail (lazy-loaded)

Bind this to the parent Pi session only, on organic progress/recovery or SDD phase memory reads/writes. Not always-on; loaded on demand from `assets/orchestrator.md`'s `## Memory Contract` pointer.

### Organic feature continuity

For substantial authorized organic implementation, the parent maintains `odd/tasks/<feature-name>.md` and an Engram recovery copy under topic `odd/<feature-name>/tasks`, scoped to the current project. Use a descriptive filename-safe feature name, reuse the same identity, and never overwrite another feature. Include stable task IDs, authorized scope, acceptance criteria, applicable checks, and the next step. Mirror the full current checklist and repository-relative file locator, not only a summary or completion notice.

After discoveries or requirement changes, automatically update affected TODOs: preserve valid completed and unrelated work, reopen invalidated items, and revise their checks. New business scope still requires user authorization. Check off only observed outcomes with applicable proof; record failed, unavailable, skipped, or pending checks honestly. The parent merges bounded worker results rather than replacing the entire feature with one worker's partial view.

Persist local progress first, then mirror through the existing injected Engram save tool. Read back both writes; they are not atomic. If Engram is unavailable, preserve local progress and explicitly mark the mirror pending; do not claim persistence succeeded or block unrelated safe work. Resynchronize when available. If a file write is unsafe or unavailable, preserve existing state and report the limitation. Preserve both versions on irreconcilable edits and ask only about the real conflict; never silently prefer a newer timestamp.

On resume, use `mem_context`, then project/feature-scoped `mem_search`, and `mem_get_observation` for the full saved checklist; read the actual task file. Do not infer active work from the newest global memory. Reconcile current requirements, code, and proof before continuing the next unfinished task. Preserve pending mirrors and conflicting edits; a missing copy is not permission to overwrite surviving progress. Use the injected equivalents of these existing memory tools, never invent availability.

The existing `todo` tool is an optional session/UI projection, not a third authority. Rebuild it from reconciled feature progress when useful; its replay or completed-list clearing must not delete or replace the durable file or Engram copy. Small/read-only work does not acquire an ODD artifact merely because the UI displays tasks.

### SDD phases

Each SDD phase subagent reads its own required inputs directly from the active backend; the parent passes artifact references (topic keys or file paths), NOT the content itself. Phase subagents persist their artifact before returning.

| Phase          | Reads                                                   | Writes           |
| -------------- | ------------------------------------------------------- | ---------------- |
| `sdd-explore`  | nothing                                                 | `explore`        |
| `sdd-research` | exploration                                             | `research` + `preproposal` |
| `sdd-proposal` | exploration (optional)                                  | `proposal`       |
| `sdd-spec`     | proposal (required)                                     | `spec`           |
| `sdd-design`   | proposal (required)                                     | `design`         |
| `sdd-tasks`    | spec + design (required)                                | `tasks`          |
| `sdd-apply`    | tasks + spec + design + `apply-progress` (if it exists) | `apply-progress` |
| `sdd-verify`   | spec + tasks + `apply-progress`                         | `verify-report`  |
| `sdd-sync`     | proposal + spec + design + tasks + `verify-report`      | `sync-report`    |
| `sdd-archive`  | all artifacts                                           | `archive-report` |
| `sdd-status`   | change artifacts (read-only)                            | nothing          |

- SDD artifact keys: in memory/hybrid mode, phase artifacts use stable topic keys such as `sdd/<change>/proposal`, `sdd/<change>/spec`, `sdd/<change>/design`, `sdd/<change>/tasks`, `sdd/<change>/apply-progress`, `sdd/<change>/verify-report`, `sdd/<change>/sync-report`, and `sdd/<change>/archive-report`.
- When the optional research lane is selected, `sdd-research` uses the additional topic keys `sdd/<change>/research` and `sdd/<change>/preproposal` (openspec: `openspec/changes/<change>/research.md`).
- If memory tools are unavailable, do not pretend persistence exists; return artifacts inline and/or write OpenSpec files.

Memory lifecycle rule (when Engram exposes lifecycle metadata/tooling):

- At session start or before architecture-sensitive work, call the injected Engram review tool with action `list` for the current project when the tool is available.
- If the injected Engram review tool is unavailable, do not fail the task. Continue with the injected Engram context/search tools, and still apply lifecycle metadata from any returned observations when present.
- `active` memories may be used normally.
- `needs_review` memories are stale context, not trusted facts.
- When a retrieved memory is marked `needs_review`, surface that stale context to the user and verify it against current evidence before relying on it.
- Do NOT call the injected Engram review tool with action `mark_reviewed` automatically. Only call `mark_reviewed` after explicit user confirmation or through a dedicated memory maintenance command.
