# Project Map — the explanation in Spanish, translated once

Status: **authorized 2026-09-27.** The user's words: *"te dije que me lo traduzca al español al cargarse el project map, cuando lo obtiene del ducomento proveniente del odd"*, after choosing the stored-translation option (*"a"*).

## Objective

Show the capability explanation in Spanish even though the ODD documents that carry it are written in English, by translating each body once and storing the result next to the map, and by never showing a translation that no longer matches the body it came from.

## Problem

The `?` explanation quotes the work unit's body from the project's own ODD document, and those documents are English. The extension cannot translate at that point: the overlay opens from a synchronous path, and an extension has no model call. So the translation has to happen somewhere a model exists, be stored, and be read back cheaply.

## Decisions

**A. The translation is a sidecar, not a schema change.** `openspec/project-map.es.json`, versioned `gentle-pi.project-map-translations/v1`, one entry per capability with the source path, the body hash, an optional translated title and the translated lines. The artifact, the store and the canonical map are untouched: a translation is derived content, and nothing about the plan changes because someone reads it in another language.

**B. Freshness keys on the extracted body, not on the file.** The hash is over the lines the reader returns, so an unrelated edit elsewhere in the same document does not invalidate every translation it feeds, and a body that changed invalidates its own even when the mtime did not. A stale entry is never shown: the explanation falls back to the document's own words.

**C. The command reports the work; the agent does it.** `/gentle:project-map translate` is read-only and never gated. It prints, per capability that needs a pass, the id, the document and the hash, plus the exact shape to write — the hash is the part a writer cannot reproduce by hand, because it identifies the reader's extracted body and not the file's bytes.

**D. An untranslated body is explained, not mysterious.** When no current translation exists, the modal shows the document's words and states `Traducción: no generada` or `Traducción: desactualizada, el documento cambió`, naming the command. A Spanish frame around an English paragraph without a reason is exactly the confusion this unit exists to remove.

**E. The reader is one function.** `translatedExplanation` is the only place a translation is consulted, and it returns the capability, the description and the note together, so the overlay cannot show a translated body with an untranslated title or the other way round.

## Slices

- **PMTR-1 — the sidecar.** `lib/project-map-translations.ts`: strict decode, body hash, freshness lookup, work list, and the printed shape, with its tests.
- **PMTR-2 — the command.** The `translate` sub-action, its usage line, and the sub-action list test.
- **PMTR-3 — the reader.** `translatedExplanation` and the modal's `descriptionNote`.
- **PMTR-4 — the documentation.** `docs/project-map.md`, including the sub-action count.

## Acceptance criteria

1. A fresh entry makes the explanation show the translated body and the translated title, and the note disappears.
2. A missing or stale entry shows the document's own words and says which of the two it is, naming the command.
3. A malformed sidecar is refused whole — never partially trusted — and the explanation falls back with a diagnostic.
4. `translate` prints the hash the writer must copy, the exact shape, and what already needs no pass; it writes nothing and is never gated.
5. Focused suites, the full unit suite and the type baseline stay green.

## Non-goals

- Translating the documents themselves, or the package's prompt assets and configuration. An earlier attempt to change the package's authoring language was reverted; this unit translates nothing but the explanation.
- Any language other than Spanish, or any setting for it. The sidecar's language is fixed at `es`.
- Translating identifiers, paths, or the map's frozen English values.
- Writing the sidecar from the command. The agent writes it with its own tools, which is what keeps the extension free of a model call.

## The content pass (2026-09-28)

The unit shipped the mechanism; this section records the pass that filled it.

**What ran.** `openspec/project-map.es.json` now holds **49 entries / 189,965 characters**: every capability the map declares with a document. Measured with the repository's own reader — `readProjectMapFile` + `readCapabilityDescription` + `projectMapTranslationWorklist` — the worklist went from `fresh: 0 · need a pass: 49` to **`fresh: 49 / 49`**, which is the reader's verdict, not a claim about the file.

**How it was produced.** The input was split by size into eight batches under `/tmp/pm-es-in/` (29,871 down to 98 characters per body); the translations were written under `/tmp/pm-es-out/`. A single merge script builds the artifact and refuses to write unless every check passes, so a hand-written hash can never forge an identity:

- `source` and `sourceHash` come from the batch **input** files, never from the translated output.
- every output id must exist in the inputs, appear once, and carry a non-empty title and a non-empty array of string lines;
- the assembled text must survive `readProjectMapTranslations` with **zero diagnostics** and lose no entry — the file is checked by the same strict decoder the reader uses;
- the freshness check runs `projectMapTranslationFor` per capability against the live map, so `fresh: 49 / 49` is the explanation path itself, not a shape check.

**Standing rule for the next project.** Translate the prose; copy identifiers, paths, `code spans`, commit hashes, diagnostic codes and literal state values (`planned`, `ready`, `draft`, `approved`) verbatim; keep technical nouns that Spanish would blur (worktree, store, commit, gate, slice, receipt, claim, lease, heartbeat, blocker, handoff, digest, lineage, CAS, lock) glued into Spanish grammar.

**A pass is a lot of prose.** 159,654 characters of English went in; the Spanish is 189,965. That does not fit in one turn, so it is a **batch job**: translate a batch, merge, re-read freshness, continue. The batch boundary is a size boundary, not a capability boundary — one capability's body is one entry, so a capability is never split across writers.

**Gates.** `tests/project-map-translations.test.ts` 5/5; `node scripts/verify-package-files.mjs` passes (200 files; the sidecar is not a package resource, so the pin is untouched); the reader's own freshness check 49/49.

**Not done, and why.**

- **Committed?** No. `openspec/project-map.es.json` is untracked. Two open decisions gate it: whether `openspec/project-map.json` should be tracked at all (handoff, operational fact 5), and whether a 190 KB derived artifact belongs in a commit whose review budget is 400 lines. This is the user's call.
- **Other projects.** The sidecar is per repository: junglex and every other project need their own pass over their own map. The command reports the work, never does it, because an extension has no model call.
- **Staleness is real.** A translation is `stale` the moment a body changes, and a stale entry is never shown. Editing an ODD work-unit body means re-running that entry (`/gentle:project-map translate` names it with its new hash).
