# Project Map — the verification command the project actually writes

Status: **authorized 2026-09-27**, one slice. Found while testing the feature against this repository, minutes after F1's fix was approved.

## Problem

`integrate`'s `verification` check — one of the seven that **gate** — reads the project's own test command from `openspec/config.yaml`. It cannot find it on a config this repository writes.

The reader flattens the file with `readSimpleConfigEntries`, which understands **two levels**: a bare top-level key becomes the section, and one indented key becomes `section.key`. A nested bare key such as `apply:` matches none of its three patterns and is dropped.

`extensions/sdd-init.ts` writes the OpenSpec shape, where the command is **three** levels deep:

```yaml
rules:
  apply:
    test_command: "pnpm test"
```

Measured, not inferred:

- `readSimpleConfigEntries` over this repository's own `openspec/config.yaml` yields `rules.test_command` — and **no** `apply.test_command`.
- `readProjectMapTestCommand(<that config>)` returns `null`.
- The same reader over the fixtures the suite uses returns `"pnpm test"`, because **every fixture declares a flat top-level `apply:`** — the shape `sdd-init` never writes.

Two consequences:

1. `draft` always reports *"openspec/config.yaml declares no apply.test_command, so the quality gates foundation stays planned"*, so the generated map understates the project's real gate.
2. `integrate` reports `verification` as unverified for every capability, forever. A gating check that no configuration can satisfy is the same defect class as F1 — a gate the product cannot satisfy from inside.

## Decision

**The reader becomes path-aware, and the lookup accepts both shapes, most specific first.** Three levels are not a special case to patch around: `rules.apply.test_command` is the shape this repository writes, and a reader that cannot follow the nesting will hide the next nested key the same way.

1. `readSimpleConfigEntries` tracks the nesting path by indentation and emits the full dotted path, so `rules.apply.test_command` is reachable. A bare key at any indentation opens a path; a valued key joins the paths that are less indented than it.
2. The declared command is read through one shared helper, `readConfigTestCommand`, which tries `rules.apply.test_command` first — the shape the project writes — and then a flat `apply.test_command`, which stays accepted because the reference documents it and a project may declare it at the top level.
3. Both consumers use that helper: the draft's quality-gates foundation and `integrate`'s `verification` check.

## Acceptance criteria

1. A config in the shape `sdd-init` writes makes the draft's quality-gates foundation `done`, and `integrate` reads the command.
2. A flat top-level `apply.test_command` keeps working.
3. The nested path wins when both are present, and neither is ever read from a block scalar body.
4. **The repository's own `openspec/config.yaml` — the file the writer produced — is read successfully by a test.** The fixtures that agreed with the reader instead of the writer are exactly what hid this, so the pin is the real file.
5. No other consumer of `readSimpleConfigEntries` changes behavior: the two existing callers are the only ones.

## Non-goals

- Changing `sdd-init`'s output. The config it writes is the OpenSpec shape and stays that way; the reader was the half that was wrong.
- Inventing a new config key or a schema field for the verification requirement.
- The remaining informational debt: review evidence still cannot be attributed to a capability.
