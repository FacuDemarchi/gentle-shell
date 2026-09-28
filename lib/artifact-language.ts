import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gentlePiConfigHome } from "./agent-home.ts";

// ---------------------------------------------------------------------------
// Artifact language — project > global > env > default English
//
// The always-on prompt tells the agent which language to write generated artifacts in, and its
// default is English: that is right for a package anyone installs, and wrong for a reader whose
// documents ARE the product. The Project Map's `?` explanation quotes the ODD documents, so their
// language is the language of that surface, and a user who wants Spanish prose everywhere should
// not have to fork the package default to get it.
//
// This resolves the language the prompt asks for. The split is deliberate and is spelled out by
// the directive: human-facing prose follows the setting, code-facing artifacts stay English,
// because identifiers, filenames and commit messages are read by tooling and by everyone.
//
// Pure on purpose, like the background-subagents policy it mirrors: no Pi imports, and every
// source is injectable so the tests never touch the real home.
// ---------------------------------------------------------------------------

export type ArtifactLanguage = "en" | "es";

/** Which of the four sources decided the effective language. */
export type ArtifactLanguageSource = "project_file" | "global_file" | "environment" | "default";

export const ARTIFACT_LANGUAGE_ENV = "GENTLE_PI_ARTIFACT_LANGUAGE";
export const ARTIFACT_LANGUAGE_FILE = "artifact-language.json";
export const ARTIFACT_LANGUAGE_SCHEMA = "gentle-pi.artifact-language/v1";
export const ARTIFACT_LANGUAGE_DEFAULT: ArtifactLanguage = "en";

export interface ArtifactLanguageResolution {
	language: ArtifactLanguage;
	source: ArtifactLanguageSource;
	/** The deciding file was present but failed the strict decode. */
	malformed: boolean;
	projectFile: string;
	globalFile: string;
	projectFileExists: boolean;
	globalFileExists: boolean;
	/** The raw env value, reported even when it is unrecognized and inert. */
	envValue: string | undefined;
}

export interface ResolveArtifactLanguageOptions {
	/** Override the config home directory (used in tests to avoid touching ~/.pi). */
	gentlePiConfigHome?: string;
	/** Override the environment lookup (used in tests). */
	env?: Record<string, string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict decode of `{"schema":"gentle-pi.artifact-language/v1","language":"en"|"es"}`.
 * Any malformed shape (bad JSON, wrong schema, unknown keys, unsupported language) returns
 * undefined so the caller fails closed to the default instead of guessing.
 */
export function parseArtifactLanguageFile(raw: string): ArtifactLanguage | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	const keys = Object.keys(parsed).sort();
	if (keys.length !== 2 || keys[0] !== "language" || keys[1] !== "schema") return undefined;
	if (parsed.schema !== ARTIFACT_LANGUAGE_SCHEMA) return undefined;
	return parsed.language === "en" || parsed.language === "es" ? parsed.language : undefined;
}

export function resolveArtifactLanguage(
	cwd: string,
	options: ResolveArtifactLanguageOptions = {},
): ArtifactLanguageResolution {
	const env = options.env ?? process.env;
	const rawEnv = env[ARTIFACT_LANGUAGE_ENV];
	const envValue = typeof rawEnv === "string" ? rawEnv.trim().toLowerCase() : undefined;
	let projectFile = "";
	let globalFile = "";
	try {
		const configHome = options.gentlePiConfigHome ?? gentlePiConfigHome(env as NodeJS.ProcessEnv);
		projectFile = join(cwd, ".pi", "gentle-ai", ARTIFACT_LANGUAGE_FILE);
		globalFile = join(configHome, ARTIFACT_LANGUAGE_FILE);
		const projectFileExists = existsSync(projectFile);
		const globalFileExists = existsSync(globalFile);
		const locations = { projectFile, globalFile, projectFileExists, globalFileExists, envValue };
		for (const [source, path, present] of [
			["project_file", projectFile, projectFileExists],
			["global_file", globalFile, globalFileExists],
		] as const) {
			if (!present) continue;
			let decoded: ArtifactLanguage | undefined;
			try {
				decoded = parseArtifactLanguageFile(readFileSync(path, "utf8"));
			} catch {
				// Unreadable is indistinguishable from unusable here, and both must fail closed on
				// the file that claimed the decision rather than falling through to a lower source.
				decoded = undefined;
			}
			return decoded === undefined
				? { language: ARTIFACT_LANGUAGE_DEFAULT, source, malformed: true, ...locations }
				: { language: decoded, source, malformed: false, ...locations };
		}
		if (envValue === "en" || envValue === "es") {
			return { language: envValue, source: "environment", malformed: false, ...locations };
		}
		return { language: ARTIFACT_LANGUAGE_DEFAULT, source: "default", malformed: false, ...locations };
	} catch {
		return {
			language: ARTIFACT_LANGUAGE_DEFAULT,
			source: "default",
			malformed: false,
			projectFile,
			globalFile,
			projectFileExists: false,
			globalFileExists: false,
			envValue,
		};
	}
}

/** The effective language alone, for callers that do not report a source. */
export function loadArtifactLanguage(cwd: string, options: ResolveArtifactLanguageOptions = {}): ArtifactLanguage {
	return resolveArtifactLanguage(cwd, options).language;
}

/**
 * What the prompt substitutes for `{{GENTLE_PI_ARTIFACT_LANGUAGE}}`.
 *
 * Both values are full sentences because the sentence they replace was one: the prompt reads
 * "Generated artifacts follow the configured artifact language: <this>." Keeping them whole is
 * also what keeps the injected prompt inside its byte budget, and both are measured.
 */
export function artifactLanguageDirective(language: ArtifactLanguage): string {
	return language === "es"
		? "Spanish for human-facing prose — ODD/SDD unit and task documents, and the UI copy that quotes them — and English for code, comments, identifiers, commit messages, filenames, tests, fixtures, prompt templates, and machine-facing files."
		: "English for every generated artifact — code, comments, identifiers, commit messages, filenames, PR descriptions, tests, fixtures, SDD/OpenSpec files, delegated phase outputs, and repository-facing documentation.";
}
