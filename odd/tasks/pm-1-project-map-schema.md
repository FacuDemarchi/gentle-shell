# PM-1 — Versioned Project Map schema and validation

## Objective
Define the versioned Project Map definition and its deterministic validation boundary: the contract a repository-owned map artifact must satisfy, the diagnostics it produces when it does not, and the canonical form upstream phases consume.

This is the first work unit of the initiative roadmap recorded in `odd/tasks/project-map-orchestration.md`. It replaces nothing: the static visual prototype (`lib/shell-project-map.ts` in the visual-demo worktree) stays untouched until PM-3 consumes a real approved map.

## Problem
The Project Map has no data contract. Without one, PM-2 (draft generation and approval), PM-3 (render and inspector), and PM-4 (runtime overlay) would each invent their own shape, and nothing would prevent ephemeral session state from leaking into the repository-owned, human-reviewed artifact.

## Why
A versioned, validated definition is the boundary that keeps durable product intent separate from transient runtime coordination, and it is the only way "the map is wrong" can be reported as a precise, testable diagnostic instead of an ambiguous failure.

## Decisions (approved by the user)
- **Artifact format and location**: a JSON document at `openspec/project-map.json`. Zero new dependencies, diffable, deterministic. YAML would require promoting the transitively installed `yaml@2.9.0`, and Markdown frontmatter would weaken deterministic validation.
- **Schema authority**: a hand-written TypeScript validator is the single source of truth, following the repository's own precedent (`lib/review-graph-schema.ts`). No duplicated project-owned JSON Schema; `contracts/` holds vendored provider contracts, not project artifacts.
- **Feature-document references**: a missing referenced document is an error in strict mode (default) and a warning in tolerant read mode.
- **Unit scope**: the library plus reusable validation only. No shell command, no UI, no rendering. Those belong to PM-3.

## Scope
- Versioned contract types for foundations, capabilities, coverage surfaces, lifecycle states, and references.
- Deterministic parsing of the artifact: JSON text or an already-decoded value.
- Structural validation with stable diagnostic codes and precise paths, including rejection of unknown fields and of runtime-coordination fields.
- Reference resolution, dependency cycle detection with the offending path, and feature-document reference safety.
- Canonical serialization so the same logical map always produces the same bytes.
- Documentation of the format, defaults, and diagnostic codes.

## Non-goals
- Draft generation, plan approval, or any state transition (PM-2).
- Rendering, inspector, or shell wiring (PM-3).
- Runtime claims, leases, heartbeats, blockers, and the shared store (PM-4).
- Any commit, push, PR, or release.

## Constraints
- TDD mode: strict (`openspec/config.yaml` declares `strict_tdd: true`); runner: `node --experimental-strip-types --test tests/<file>.test.ts`, full suite `pnpm test`.
- Repository style: ESM `.ts` imports with explicit extensions, tabs, double quotes, semicolons.
- No new runtime dependency.
- Single writer; no parallel writes.
- `pnpm` and `node_modules` are unavailable in this worktree, so the full-suite and typecheck gates cannot run here; focused `node --test` runs and an explicit limitation note are the substitute evidence.

## Authorized edit surfaces
- `odd/tasks/pm-1-project-map-schema.md`
- `lib/shell-project-map-schema.ts`
- `tests/shell-project-map-schema.test.ts`
- `docs/project-map.md`

## Contract v1

```text
version: "gentle-shell.project-map/v1"
project:   { id, name }
foundations[]: { id, outcome, state, evidence? }
capabilities[]: {
  id, outcome,
  foundationRefs[], dependsOn[], contracts[], featureDocs[],
  surfaces{ productUx, web, api, data, security, operations, tests },
  state
}
states: done | active | review | ready | blocked | planned
```

- Identifiers are kebab-case, unique within their namespace (foundations and capabilities are separate namespaces), and immutable.
- `dependsOn` and `foundationRefs` reference identifiers in those namespaces; v1 validates `contracts` entries structurally and does not resolve them; the shared registry arrives with PM-5.
- `featureDocs` are repository-relative paths; absolute paths and `..` segments are rejected without filesystem access.
- Runtime coordination state (`session`, `worktree`, `branch`, `lease`, `heartbeat`, `claims`, `blockers`, `generation`) is forbidden in the versioned artifact and reported with its own diagnostic code.
- Migration-safe defaults apply only to optional collections (`foundations`, `foundationRefs`, `dependsOn`, `contracts`, `featureDocs` default to empty). The schema version is never defaulted: an unknown version fails closed.

## Tasks
- [ ] **PM1-1 — Schema version, fail-closed version gate, and canonical form**
  - Export the v1 version tag, coverage surfaces, lifecycle states, and diagnostic codes.
  - Reject any other version with a single diagnostic and no partial map.
  - Canonicalize (stable ordering, applied defaults) and serialize deterministically.
- [ ] **PM1-2 — Structural validation**
  - Reject unknown fields at every level with the exact path, and runtime-coordination fields with their own code.
  - Report missing required fields and wrong types with stable codes.
  - Detect duplicate identifiers per namespace and duplicate entries inside collections.
- [ ] **PM1-3 — Reference resolution and dependency cycles**
  - Report unknown `foundationRefs` and `dependsOn` references with the exact path; `contracts` stays structural in v1.
  - Detect dependency cycles, including self-reference, and report one diagnostic per cyclic dependency group.
- [ ] **PM1-4 — Feature-document references**
  - Reject absolute paths and `..` escapes without filesystem access.
  - With an existence predicate, report a missing document as an error in strict mode and a warning in tolerant mode.
- [ ] **PM1-5 — Artifact reading and reusable validation entry points**
  - Validate a decoded value, parse JSON text, and read the artifact from disk with a diagnostic instead of a thrown error.
- [ ] **PM1-6 — Documentation**
  - Document the format, defaults, canonical form, and every diagnostic code in `docs/project-map.md`.
- [ ] **PM1-7 — Verification**
  - Focused test file green; full-suite and typecheck attempted and their unavailability recorded honestly.

## Acceptance criteria
- A valid v1 map validates with no diagnostics and produces a stable canonical serialization.
- Any unsupported `version` produces exactly one fail-closed diagnostic and `map: null`.
- Unknown fields, wrong types, missing required fields, duplicate identifiers, unknown references, one diagnostic per cyclic dependency group that names every member, unsafe feature-document paths, and runtime-coordination fields each produce their documented code and an exact `$`-rooted path.
- Validation never throws on malformed input; it returns diagnostics.
- Only evidence of an error (not a warning) makes the validated map unavailable.

## Review workload forecast
Measured correction-round totals: 501 library lines, 613 test lines, 95 documentation lines, and 107 task-document lines (1,316 total). Because that exceeds the 400-line review budget, the unit is implemented in two reviewable stages: PM-1a (PM1-1, PM1-2, PM1-5 core) and PM-1b (PM1-3, PM1-4, PM1-6, PM1-7). Each stage reports its own measured diff size.

## Progress
- 2026-09-22: Unit authorized by the user with decisions a–d accepted as recommended. Task document created before the first source write. PM1-1 through PM1-7 pending.
- 2026-09-22: Independent verification found four defects (Windows absolute paths accepted, key-order-dependent serialization, incomplete cyclic-group coverage, index drift after duplicate removal); all corrected and re-tested.
- 2026-09-22: Re-verification confirmed the four corrections and identified weak regression coverage; cyclic-group, index-fidelity, and malformed-input expectations pinned.
- 2026-09-22: Cyclic-group diagnostics now name every member of the group; disjoint groups covered by test.

## Next decision
Report measured results per stage. Commit, push, and PR remain separate decisions and require explicit authorization; native review remains a separate user-owned choice.
