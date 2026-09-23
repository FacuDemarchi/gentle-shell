import {
	PROJECT_MAP_SCHEMA_V1,
	canonicalizeProjectMap,
	isSafeFeatureDocumentPath,
	type ProjectMapCapabilityV1,
	type ProjectMapFoundationV1,
	type ProjectMapV1,
} from "./shell-project-map-schema.ts";

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
const CONFIG_SECTION = /^([a-z][a-z0-9_]*):\s*$/;
const CONFIG_NESTED_ENTRY = /^\s+([a-z][a-z0-9_]*):\s*(\S.*)$/;
const CONFIG_TOP_ENTRY = /^([a-z][a-z0-9_]*):\s*(\S.*)$/;
const WORK_UNIT = /^-\s\[([ xX])\]\s\*\*(.+?)\*\*\s*$/;
const WORK_UNIT_SEPARATOR = "—";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIdentifier(name: string): string | null {
	const withoutScope = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
	const normalized = withoutScope
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (normalized.length === 0 || normalized.length > IDENTIFIER_MAX_LENGTH || !IDENTIFIER.test(normalized)) return null;
	return normalized;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Reads only the simple `key: value` shape of a YAML document, including one level of
 * nesting. Block scalars, lists, comments, anchors, and multi-line values are deliberately
 * not interpreted; a caller that needs them must treat them as an omission.
 */
function isBlockScalarMarker(value: string): boolean {
	return /^[|>][+-]?$/.test(value.trim());
}

function readSimpleConfigEntries(text: string): Map<string, string> {
	const entries = new Map<string, string>();
	let section = "";
	let blockScalarIndent: number | null = null;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (line.trim().length === 0) continue;
		const indentation = line.length - line.trimStart().length;
		if (blockScalarIndent !== null) {
			if (indentation > blockScalarIndent) continue;
			blockScalarIndent = null;
		}
		if (line.trimStart().startsWith("#")) continue;
		const sectionMatch = CONFIG_SECTION.exec(line);
		if (sectionMatch) {
			section = sectionMatch[1];
			continue;
		}
		const nestedMatch = CONFIG_NESTED_ENTRY.exec(line);
		if (nestedMatch && section.length > 0) {
			if (isBlockScalarMarker(nestedMatch[2])) {
				blockScalarIndent = indentation;
				continue;
			}
			const value = unquote(nestedMatch[2]);
			if (value.length > 0) entries.set(`${section}.${nestedMatch[1]}`, value);
			continue;
		}
		const topMatch = CONFIG_TOP_ENTRY.exec(line);
		if (topMatch) {
			section = "";
			if (isBlockScalarMarker(topMatch[2])) {
				blockScalarIndent = indentation;
				continue;
			}
			const value = unquote(topMatch[2]);
			if (value.length > 0) entries.set(topMatch[1], value);
		}
	}
	return entries;
}

function comparePaths(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function extractWorkUnits(path: string, text: string, omissions: string[]): ProjectMapCapabilityV1[] {
	const capabilities: ProjectMapCapabilityV1[] = [];
	for (const rawLine of text.split("\n")) {
		const match = WORK_UNIT.exec(rawLine.replace(/\r$/, ""));
		if (!match) continue;
		const label = match[2].trim();
		const separatorIndex = label.indexOf(WORK_UNIT_SEPARATOR);
		const title = (separatorIndex === -1 ? label : label.slice(separatorIndex + WORK_UNIT_SEPARATOR.length)).trim();
		const id = normalizeIdentifier(title);
		if (id === null) {
			omissions.push(`The work unit "${label}" in ${path} cannot be normalized into a capability identifier.`);
			continue;
		}
		capabilities.push({
			id,
			outcome: title,
			foundationRefs: [],
			dependsOn: [],
			contracts: [],
			featureDocs: [path],
			surfaces: [],
			state: match[1] === " " ? "planned" : "done",
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
			projectId = normalizeIdentifier(projectName);
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
		const testCommand = entries.get("apply.test_command");
		const declaresGate = testCommand !== undefined && testCommand.length > 0;
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
	const declaredBy = new Map<string, string>();
	if (!Array.isArray(sources.oddTaskDocuments)) {
		omissions.push("No ODD task documents were supplied, so no capability could be extracted from work units.");
	} else {
		const documents = sources.oddTaskDocuments
			.filter(
				(document): document is { path: string; text: string } =>
					isRecord(document) && typeof document.path === "string" && document.path.length > 0 && typeof document.text === "string",
			)
			.filter((document) => {
				if (isSafeFeatureDocumentPath(document.path)) return true;
				omissions.push(`${document.path} is not a safe repository-relative path, so it was skipped rather than recorded as a feature document.`);
				return false;
			})
			.sort((left, right) => comparePaths(left.path, right.path));
		for (const document of documents) {
			const extracted = extractWorkUnits(document.path, document.text, omissions);
			if (extracted.length === 0) {
				omissions.push(`${document.path} declares no work unit this generator can read, so it contributed no capability.`);
			}
			for (const capability of extracted) {
				const existing = declaredBy.get(capability.id);
				if (existing !== undefined) {
					omissions.push(`The capability "${capability.id}" is declared by both ${existing} and ${document.path}; the first document in sorted order wins.`);
					continue;
				}
				declaredBy.set(capability.id, document.path);
				capabilities.push(capability);
			}
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
