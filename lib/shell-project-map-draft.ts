import {
	PROJECT_MAP_SCHEMA_V1,
	canonicalizeProjectMap,
	isSafeFeatureDocumentPath,
	type ProjectMapCapabilityV1,
	type ProjectMapFoundationV1,
	type ProjectMapV1,
} from "./shell-project-map-schema.ts";
import { splitWorkUnitLabel } from "./project-map-description.ts";

export interface ProjectMapDraftSources {
	packageJson?: unknown;
	openspecConfig?: string;
	oddTaskDocuments?: { path: string; text: string }[];
}

export interface ProjectMapDraftResult {
	map: ProjectMapV1 | null;
	assumptions: string[];
	omissions: string[];
}

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_MAX_LENGTH = 64;
const CONFIG_BARE_KEY = /^([a-z][a-z0-9_]*):\s*$/;
const CONFIG_VALUED_ENTRY = /^([a-z][a-z0-9_.]*):\s*(\S.*)$/;
const WORK_UNIT = /^-\s+\[([ xX~])\]\s*\*\*(.+?)\*\*(.*)$/;
const UNREADABLE_WORK_UNIT = /^-\s+\[([^\]]*)\]\s*\*\*(.+)/;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The lowercase kebab-case form of a name, or `null` when it cannot be one at all. */
function normalizeToKebab(name: string): string | null {
	const withoutScope = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
	const normalized = withoutScope
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized.length === 0 || !IDENTIFIER.test(normalized) ? null : normalized;
}

function normalizeExactIdentifier(name: string): string | null {
	const normalized = normalizeToKebab(name);
	return normalized === null || normalized.length > IDENTIFIER_MAX_LENGTH ? null : normalized;
}

/**
 * The identifier a title normalizes to, or `null` when it cannot be one.
 *
 * Exported so the reader that explains a capability and the generator that names it share one
 * definition: two functions that disagree about a title would produce a capability nobody can
 * look up, which is the same defect class as a reader that cannot read what the writer writes.
 * A title past the identifier limit is truncated here rather than refused, and because the
 * reader truncates with this same function its lookup keeps agreeing with the generator's name.
 */
export function normalizeIdentifier(name: string): string | null {
	const normalized = normalizeToKebab(name);
	if (normalized === null || normalized.length <= IDENTIFIER_MAX_LENGTH) return normalized;

	let truncated = "";
	let words = 0;
	for (const word of normalized.split("-")) {
		const candidate = truncated.length === 0 ? word : `${truncated}-${word}`;
		if (candidate.length > IDENTIFIER_MAX_LENGTH) break;
		truncated = candidate;
		words += 1;
	}
// A hard cut can land on the separator that made the input too long, and a trailing hyphen is
	// not an identifier. The word-assembly result never ends that way, so only the fallback trims.
	const fallback = normalized.slice(0, IDENTIFIER_MAX_LENGTH).replace(/-+$/, "");
	const truncatedTo = words >= 2 ? truncated : fallback;
	return truncatedTo.length === 0 ? null : truncatedTo;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Whether a value is a YAML block-scalar marker (`|` or `>`, each with an optional chomping indicator). */
function isBlockScalarMarker(value: string): boolean {
	return /^[|>][+-]?$/.test(value.trim());
}

/**
 * The simple key/value entries a configuration declares, keyed by their full dotted path.
 *
 * Exported because the integration-readiness report needs the project's own test command, and a
 * second copy of this parser is how two readers of the same file drift apart. It interprets no
 * YAML construct: a value keeps the literal text its line wrote, including a list, an anchor or a
 * trailing comment, while a block-scalar body is skipped, and so is a line whose shape this
 * reader does not recognise.
 *
 * The path is tracked by indentation rather than by a fixed depth, because the shape this
 * repository writes nests three levels deep: `rules.apply.test_command` is a bare key
 * (`rules:`), a bare key (`apply:`) and a valued key. A reader that stopped at two levels
 * dropped the middle key and produced `rules.test_command`, so a caller looking for the
 * documented `apply.test_command` found nothing on a config the project had just written.
 */
export function readSimpleConfigEntries(text: string): Map<string, string> {
	const entries = new Map<string, string>();
	/** The bare keys open at this point, with the indentation each one was declared at. */
	const openKeys: { indentation: number; key: string }[] = [];
	let blockScalarIndent: number | null = null;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (line.trim().length === 0) continue;
		const indentation = line.length - line.trimStart().length;
		if (blockScalarIndent !== null) {
			if (indentation > blockScalarIndent) continue;
			blockScalarIndent = null;
		}
		const content = line.trim();
		if (content.startsWith("#")) continue;
		const bare = CONFIG_BARE_KEY.exec(content);
		if (bare !== null) {
			while (openKeys.length > 0 && openKeys[openKeys.length - 1]!.indentation >= indentation) openKeys.pop();
			openKeys.push({ indentation, key: bare[1] });
			continue;
		}
		const valued = CONFIG_VALUED_ENTRY.exec(content);
		if (valued === null) continue;
		if (isBlockScalarMarker(valued[2])) {
			blockScalarIndent = indentation;
			continue;
		}
		const value = unquote(valued[2]);
		if (value.length === 0) continue;
		const path = [...openKeys.filter((open) => open.indentation < indentation).map((open) => open.key), valued[1]];
		entries.set(path.join("."), value);
	}
	return entries;
}

function normalizeProjectMapRoadmapPath(path: string): string {
	const leadingSlash = path.startsWith("/");
	const normalized = path.split("/").filter((segment) => segment.length > 0 && segment !== ".").join("/");
	return normalized.length === 0 ? path : leadingSlash ? `/${normalized}` : normalized;
}

/** The roadmap document a project declares with `project_map.roadmap`, or `null` when it declares none. */
export function readProjectMapRoadmapPath(configText: string | undefined): string | null {
	if (typeof configText !== "string") return null;
	const value = readSimpleConfigEntries(configText).get("project_map.roadmap");
	return value === undefined || value.trim().length === 0 ? null : normalizeProjectMapRoadmapPath(value.trim());
}

/**
 * The verification command a project declares, or `null` when it declares none.
 *
 * Two shapes are accepted, most specific first: the OpenSpec rule block this repository's own
 * `sdd-init` writes (`rules.apply.test_command`), and a flat top-level `apply.test_command`,
 * which the reference documents and a project may declare directly. An absent or blank command
 * declares nothing, and nothing is never read as a requirement.
 */
export function readConfigTestCommand(entries: Map<string, string>): string | null {
	for (const key of ["rules.apply.test_command", "apply.test_command"]) {
		const value = entries.get(key);
		if (value !== undefined && value.trim().length > 0) return value;
	}
	return null;
}

function comparePaths(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function extractWorkUnits(path: string, text: string, omissions: string[]): { capability: ProjectMapCapabilityV1; line: string }[] {
	const capabilities: { capability: ProjectMapCapabilityV1; line: string }[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		const match = WORK_UNIT.exec(line);
		if (!match) {
			if (UNREADABLE_WORK_UNIT.test(line)) {
				omissions.push(`The work unit line "${line}" in ${path} cannot be read as a capability, so it was omitted.`);
			}
			continue;
		}
		const label = match[2].replace(/\s+/g, " ").trim();
		const id = normalizeIdentifier(splitWorkUnitLabel(label).title);
		if (id === null) {
			omissions.push(`The work unit line "${line}" in ${path} cannot be normalized into a capability identifier.`);
			continue;
		}
		capabilities.push({
			capability: {
				id,
				outcome: label,
				foundationRefs: [],
				dependsOn: [],
				contracts: [],
				featureDocs: [path],
				surfaces: [],
				state: match[1] === " " ? "planned" : match[1] === "~" ? "active" : "done",
			},
			line,
		});
	}
	return capabilities;
}

export function generateProjectMapDraft(sources: ProjectMapDraftSources): ProjectMapDraftResult {
	const assumptions: string[] = [];
	const omissions: string[] = [];

	const packageJson = sources.packageJson;
	let projectId: string | null = null;
	let projectName: string | null = null;
	if (!isRecord(packageJson)) {
		omissions.push("package.json is absent or is not an object, so the project identity could not be derived.");
	} else {
		const rawName = packageJson.name;
		if (typeof rawName !== "string" || rawName.trim().length === 0) {
			omissions.push("package.json declares no usable \"name\", so the project identity could not be derived.");
		} else {
			projectName = rawName.trim();
			projectId = normalizeExactIdentifier(projectName);
			if (projectId === null) {
				omissions.push(`package.json declares the name "${projectName}", which cannot be normalized into a project identifier.`);
			}
		}
	}

	let openspecConfig: string | null = null;
	if (typeof sources.openspecConfig !== "string") {
		omissions.push("openspec/config.yaml is absent, so no quality gate could be derived.");
	} else {
		openspecConfig = sources.openspecConfig;
	}

	const foundations: ProjectMapFoundationV1[] = [];
	if (isRecord(packageJson) && projectName !== null) {
		const scripts = packageJson.scripts;
		const declaresTooling =
			isRecord(scripts) && Object.values(scripts).some((command) => typeof command === "string" && command.trim().length > 0);
		foundations.push({
			id: "repository-tooling",
			outcome: "The repository and its declared tooling are present and consistent.",
			state: declaresTooling ? "done" : "planned",
			...(declaresTooling ? { evidence: ["package.json"] } : {}),
		});
		if (!declaresTooling) omissions.push("package.json declares no usable script command, so the repository tooling foundation stays planned.");
	}

	if (openspecConfig !== null) {
		const entries = readSimpleConfigEntries(openspecConfig);
		const testCommand = readConfigTestCommand(entries);
		const declaresGate = testCommand !== null;
		foundations.push({
			id: "quality-gates",
			outcome: "The project declares the automated gates that guard a change.",
			state: declaresGate ? "done" : "planned",
			...(declaresGate ? { evidence: ["openspec/config.yaml"] } : {}),
		});
		if (entries.size === 0 && openspecConfig.trim().length > 0) {
			omissions.push("openspec/config.yaml carries no simple key/value entry this generator can interpret.");
		}
		if (!declaresGate) omissions.push("openspec/config.yaml declares no apply.test_command, so the quality gates foundation stays planned.");
	}

	omissions.push("No structured source in this step names product capabilities; they must come from the ODD work-unit extraction or from the human.");
	const capabilities: ProjectMapCapabilityV1[] = [];
	const declaredBy = new Map<string, { path: string; line: string }>();
	const declaredRoadmapPath = readProjectMapRoadmapPath(openspecConfig ?? undefined);
	const documents = Array.isArray(sources.oddTaskDocuments)
		? sources.oddTaskDocuments
			.filter(
				(document): document is { path: string; text: string } =>
					isRecord(document) && typeof document.path === "string" && document.path.length > 0 && typeof document.text === "string",
			)
			.filter((document) => {
				if (isSafeFeatureDocumentPath(document.path)) return true;
				if (document.path !== declaredRoadmapPath) {
					omissions.push(`${document.path} is not a safe repository-relative path, so it was skipped rather than recorded as a feature document.`);
				}
				return false;
			})
			.sort((left, right) => comparePaths(left.path, right.path))
		: [];
	if (!Array.isArray(sources.oddTaskDocuments)) {
		omissions.push("No ODD task documents were supplied, so no capability could be extracted from work units.");
	}

	let capabilityDocuments = documents;
	if (declaredRoadmapPath === null) {
		assumptions.push("No project_map.roadmap is declared, so every top-level work unit of every supplied ODD task document became a capability source and their granularity may be mixed.");
	} else if (!isSafeFeatureDocumentPath(declaredRoadmapPath)) {
		omissions.push(`openspec/config.yaml declares the roadmap "${declaredRoadmapPath}", but it is not a safe repository-relative path, so no capability could be extracted from it.`);
		capabilityDocuments = [];
	} else {
		const roadmap = documents.find((document) => document.path === declaredRoadmapPath);
		if (roadmap === undefined) {
			omissions.push(`openspec/config.yaml declares the roadmap "${declaredRoadmapPath}", but no document with that path could be read, so no capability could be extracted from it.`);
			capabilityDocuments = [];
		} else {
			capabilityDocuments = [roadmap];
			assumptions.push(`openspec/config.yaml declares "${declaredRoadmapPath}" as the roadmap, so only it contributes capabilities; ${documents.length - 1} other supplied document${documents.length === 2 ? "" : "s"} contributed none.`);
		}
	}

	for (const document of capabilityDocuments) {
		const extracted = extractWorkUnits(document.path, document.text, omissions);
		if (extracted.length === 0) {
			omissions.push(`${document.path} declares no work unit this generator can read, so it contributed no capability.`);
		}
		for (const extractedWorkUnit of extracted) {
			const { capability, line } = extractedWorkUnit;
			const existing = declaredBy.get(capability.id);
			if (existing !== undefined) {
				if (existing.path === document.path) {
					omissions.push(`The capability "${capability.id}" is declared twice in ${document.path}: "${existing.line}" and "${line}"; the first declaration wins.`);
				} else {
					omissions.push(`The capability "${capability.id}" is declared by both ${existing.path}, line "${existing.line}", and ${document.path}, line "${line}"; the first document in sorted order wins.`);
				}
				continue;
			}
			declaredBy.set(capability.id, { path: document.path, line });
			capabilities.push(capability);
		}
	}
	if (capabilities.length === 0) {
		omissions.push("No supplied source names a product capability, so the draft carries none; capabilities must come from the ODD work-unit extraction or from the human.");
	}

	assumptions.push("Every generated map is a draft: this generator never marks a map approved, and approval requires a human actor and an explicit transition.");
	assumptions.push("A generated foundation is done only when its named structured source carries a well-formed declaration of it; done therefore means declared, not verified.");
	assumptions.push("Foundation identifiers are generic proposals derived from repository tooling, and the human is expected to replace or extend them with the project's real foundations.");
	assumptions.push("Project identity is derived from the package manifest name, with the scope removed and the remainder normalized to lowercase kebab-case.");
	assumptions.push("An ODD work unit becomes a capability named after its title, a checked box becomes done and an unchecked box becomes planned, and the declaring document becomes its feature document. The checkbox is a declaration of completion, not verified progress.");
	assumptions.push("A generated capability leaves its surface list empty, because no structured source states which product surfaces it touches.");

	if (projectId === null || projectName === null) {
		return { map: null, assumptions, omissions };
	}

	return {
		map: canonicalizeProjectMap({
			version: PROJECT_MAP_SCHEMA_V1,
			project: { id: projectId, name: projectName },
			approval: { state: "draft" },
			foundations,
			capabilities,
		}),
		assumptions,
		omissions,
	};
}
