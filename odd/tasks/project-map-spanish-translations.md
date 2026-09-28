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
