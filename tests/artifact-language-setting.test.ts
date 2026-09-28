import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ARTIFACT_LANGUAGE_DEFAULT,
	ARTIFACT_LANGUAGE_SCHEMA,
	artifactLanguageDirective,
	loadArtifactLanguage,
	parseArtifactLanguageFile,
	resolveArtifactLanguage,
} from "../lib/artifact-language.ts";

const SPANISH = JSON.stringify({ schema: ARTIFACT_LANGUAGE_SCHEMA, language: "es" });
const ENGLISH = JSON.stringify({ schema: ARTIFACT_LANGUAGE_SCHEMA, language: "en" });

function sandbox(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "artifact-language-setting-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("decodes only the exact schema and the two supported languages", () => {
	assert.equal(parseArtifactLanguageFile(SPANISH), "es");
	assert.equal(parseArtifactLanguageFile(ENGLISH), "en");
	for (const raw of [
		"{",
		"[]",
		'"es"',
		JSON.stringify({ schema: ARTIFACT_LANGUAGE_SCHEMA, language: "fr" }),
		JSON.stringify({ schema: "other/v1", language: "es" }),
		JSON.stringify({ schema: ARTIFACT_LANGUAGE_SCHEMA, language: "es", extra: true }),
		JSON.stringify({ language: "es" }),
	]) assert.equal(parseArtifactLanguageFile(raw), undefined, raw);
});

test("defaults to English with no source at all", () => {
	sandbox((root) => {
		const resolution = resolveArtifactLanguage(join(root, "repo"), { gentlePiConfigHome: join(root, "home"), env: {} });
		assert.equal(resolution.language, "en");
		assert.equal(resolution.language, ARTIFACT_LANGUAGE_DEFAULT);
		assert.equal(resolution.source, "default");
		assert.equal(resolution.malformed, false);
	});
});

test("resolves project > global > env > default", () => {
	sandbox((root) => {
		const cwd = join(root, "repo");
		const home = join(root, "home");
		const projectFile = join(cwd, ".pi", "gentle-ai", "artifact-language.json");
		const globalFile = join(home, "artifact-language.json");
		mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
		mkdirSync(home, { recursive: true });
		const options = { gentlePiConfigHome: home, env: { GENTLE_PI_ARTIFACT_LANGUAGE: "en" } as Record<string, string | undefined> };

		writeFileSync(globalFile, SPANISH, "utf8");
		assert.equal(resolveArtifactLanguage(cwd, options).source, "global_file");
		assert.equal(resolveArtifactLanguage(cwd, options).language, "es");

		writeFileSync(projectFile, ENGLISH, "utf8");
		assert.equal(resolveArtifactLanguage(cwd, options).source, "project_file", "the project file outranks the global one");
		assert.equal(loadArtifactLanguage(cwd, options), "en");

		rmSync(projectFile);
		rmSync(globalFile);
		assert.equal(resolveArtifactLanguage(cwd, options).source, "environment");
		assert.equal(loadArtifactLanguage(cwd, options), "en");
	});
});

test("fails closed on a malformed file instead of falling through to a lower source", () => {
	sandbox((root) => {
		const cwd = join(root, "repo");
		const home = join(root, "home");
		mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
		mkdirSync(home, { recursive: true });
		writeFileSync(join(home, "artifact-language.json"), SPANISH, "utf8");
		writeFileSync(join(cwd, ".pi", "gentle-ai", "artifact-language.json"), "{ not json", "utf8");
		const resolution = resolveArtifactLanguage(cwd, { gentlePiConfigHome: home, env: { GENTLE_PI_ARTIFACT_LANGUAGE: "es" } });
		assert.equal(resolution.source, "project_file");
		assert.equal(resolution.malformed, true);
		assert.equal(resolution.language, ARTIFACT_LANGUAGE_DEFAULT, "a broken file decides, and it decides the default");
	});
});

test("an unrecognized env value is reported and stays inert", () => {
	sandbox((root) => {
		const resolution = resolveArtifactLanguage(join(root, "repo"), { gentlePiConfigHome: join(root, "home"), env: { GENTLE_PI_ARTIFACT_LANGUAGE: "fr" } });
		assert.equal(resolution.source, "default");
		assert.equal(resolution.envValue, "fr");
		assert.equal(resolution.language, "en");
	});
});

test("the directive keeps prose and code on different sides", () => {
	const spanish = artifactLanguageDirective("es");
	assert.match(spanish, /^Spanish for human-facing prose/);
	assert.match(spanish, /English for code, comments, identifiers, commit messages, filenames, tests, fixtures/);
	const english = artifactLanguageDirective("en");
	assert.match(english, /^English for every generated artifact/);
	// The substituted value replaces a sentence in the always-on prompt, which is pinned at an
	// 8,192 B budget, so neither value may be the long tail the other one is not.
	for (const directive of [spanish, english]) assert.ok(Buffer.byteLength(directive) <= 260, `${Buffer.byteLength(directive)} B`);
});
