import {
	PROJECT_MAP_SCHEMA_V1,
	PROJECT_MAP_SURFACES,
	canonicalizeProjectMap,
	isSafeFeatureDocumentPath,
	type ProjectMapCapabilityV1,
	type ProjectMapFoundationV1,
	type ProjectMapState,
	type ProjectMapSurface,
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
// A bare key is a parent: widening this HEAD-compatible class reparents children other readers
// resolve. Uppercase is allowed only for valued keys, so camel-cased `productUx` can carry one.
const CONFIG_BARE_KEY = /^([a-z][a-z0-9_]*):\s*$/;
const CONFIG_VALUED_ENTRY = /^([A-Za-z][A-Za-z0-9_.]*):\s*(\S.*)$/;
const WORK_UNIT = /^-\s+\[([ xX~])\]\s*\*\*(.+?)\*\*(.*)$/;
const UNREADABLE_WORK_UNIT = /^-\s+\[([^\]]*)\]\s*\*\*(.+)/;
const DESCRIPTION_WORK_UNIT = /^(\s*)-\s+\[([ xX~])\]\s*\*\*(.+?)\*\*(.*)$/;
const BULLET = /^(?:[-*+]|\d+[.)])\s+/;
// After a body's optional list marker is stripped, only a line beginning exactly with this bold
// marker (allowing the colon inside or immediately after the closing bold marker) declares paths.
const ALLOWED_EDIT_SURFACES_MARKER = /^\*\*Allowed edit surfaces:?\*\*:?[\t ]*/;
// Like allowed edit surfaces, the colon may sit inside or immediately after the bold marker.
const BELONGS_TO_MARKER = /^\*\*Belongs to:?\*\*:?[\t ]*/;
// The trailing dot excludes structural parents such as `project_map.surfaces` from surface reports.
const PROJECT_MAP_SURFACES_PREFIX = "project_map.surfaces.";

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

/** The prefix and title the document wrote inside a bold work-unit label. */
export interface ProjectMapWorkUnitLabel {
	head: string;
	title: string;
}

/** Splits a bold label at its first separator while preserving the functional-point prefix. */
export function splitWorkUnitLabel(label: string): ProjectMapWorkUnitLabel {
	const separator = label.indexOf("—");
	if (separator === -1) return { head: "", title: label.trim() };
	let headEnd = separator + "—".length;
	while (/\s/.test(label[headEnd] ?? "")) headEnd += 1;
	return { head: label.slice(0, headEnd), title: label.slice(headEnd).trim() };
}

export interface ProjectMapDescription {
	title: string;
	lines: string[];
}

export interface ProjectMapStep {
	code: string;
	title: string;
	state: ProjectMapState;
	path: string;
}

function projectMapStateFromCheckbox(checkbox: string): ProjectMapState {
	return checkbox === " " ? "planned" : checkbox === "~" ? "active" : "done";
}

/**
 * Collects a functional point's sub-elements from the same work-unit grammar the draft reads.
 * Documents and declarations retain their sorted, written order; repeated coded entries therefore
 * keep their first declaration.
 */
export function collectProjectMapSteps(documents: readonly { path: string; text: string }[], code: string, delegablePrefix: string | null = null): ProjectMapStep[] {
	if (code.trim().length === 0) return [];
	const steps: ProjectMapStep[] = [];
	const seen = new Set<string>();
	for (const document of [...documents].sort((left, right) => comparePaths(left.path, right.path))) {
		const declared = readDeclaredProjectMapParent(document.text);
		const declaredParentIsUsable = declared.code !== null && delegablePrefix !== null && isDelegableWorkUnitCode(declared.code, delegablePrefix);
		for (const rawLine of document.text.split("\n")) {
			const match = DESCRIPTION_WORK_UNIT.exec(rawLine.replace(/\r$/, ""));
			if (match === null) continue;
			const label = match[3]!.replace(/\s+/g, " ").trim();
			const split = splitWorkUnitLabel(label);
			const unitCode = (split.head.length === 0 ? label : split.head.replace(/—\s*$/, "")).trim();
			if (declared.hasDeclaration) {
				if (!declaredParentIsUsable || declared.code !== code || (delegablePrefix !== null && isDelegableWorkUnitLabel(label, delegablePrefix))) continue;
				const stepCode = split.head.length === 0 ? "" : unitCode;
				if (stepCode.length > 0 && seen.has(stepCode)) continue;
				if (stepCode.length > 0) seen.add(stepCode);
				steps.push({ code: stepCode, title: split.title, state: projectMapStateFromCheckbox(match[2]!), path: document.path });
				continue;
			}
			// D2 says a letter or a dot, and it means any letter: `\p{L}` with the unicode flag, so an
			// accented continuation is a continuation too. The row rule stays ASCII by nature, because
			// what it accepts is digits and hyphens.
			const extendsCode = unitCode.startsWith(code) && unitCode.length > code.length && /[\p{L}.]/u.test(unitCode[code.length]!);
			if (!extendsCode || seen.has(unitCode)) continue;
			seen.add(unitCode);
			steps.push({ code: unitCode, title: split.title, state: projectMapStateFromCheckbox(match[2]!), path: document.path });
		}
	}
	return steps;
}

/**
 * Reads a work unit's title and indented body by capability id.
 *
 * Blank body lines are skipped; every non-blank following line must be indented further than the
 * work unit, and its list marker is removed. This remains deliberately more tolerant than the
 * top-level generator, because descriptions may explain nested work units.
 */
export function readProjectMapWorkUnit(documentText: string, capabilityId: string): ProjectMapDescription | null {
	if (capabilityId.trim().length === 0) return null;
	const lines = documentText.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const match = DESCRIPTION_WORK_UNIT.exec(lines[index]!.replace(/\r$/, ""));
		if (match === null) continue;
		const { title } = splitWorkUnitLabel(match[3]!.trim());
		if (normalizeIdentifier(title) !== capabilityId) continue;
		return { title, lines: readWorkUnitBody(lines, index + 1, match[1]!.length) };
	}
	return null;
}

function readWorkUnitBody(lines: string[], start: number, indentation: number): string[] {
	const body: string[] = [];
	for (let index = start; index < lines.length; index += 1) {
		const raw = lines[index]!.replace(/\r$/, "");
		if (raw.trim().length === 0) continue;
		if (raw.length - raw.trimStart().length <= indentation) break;
		const text = raw.trim().replace(BULLET, "").replace(/\s+/g, " ").trim();
		if (text.length > 0) body.push(text);
	}
	return body;
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
type SimpleConfigDeclaration = { path: string; value: string | null };

/**
 * The one indentation-aware config scan shared by the value-only and declaration-preserving
 * views. A `null` value records a recognised key that carried no usable value, while preserving
 * the old value-only reader's treatment of it as absent.
 */
function scanSimpleConfigDeclarations(text: string): SimpleConfigDeclaration[] {
	const declarations: SimpleConfigDeclaration[] = [];
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
			const path = [...openKeys.filter((open) => open.indentation < indentation).map((open) => open.key), bare[1]].join(".");
			declarations.push({ path, value: null });
			openKeys.push({ indentation, key: bare[1] });
			continue;
		}
		const valued = CONFIG_VALUED_ENTRY.exec(content);
		if (valued === null) continue;
		const path = [...openKeys.filter((open) => open.indentation < indentation).map((open) => open.key), valued[1]].join(".");
		if (isBlockScalarMarker(valued[2])) {
			declarations.push({ path, value: null });
			blockScalarIndent = indentation;
			continue;
		}
		const value = unquote(valued[2]);
		declarations.push({ path, value: value.length === 0 ? null : value });
	}
	return declarations;
}

/** Every recognised config key, preserving a missing or empty value as `null`. */
export function readSimpleConfigDeclarations(text: string): Map<string, string | null> {
	const declarations = new Map<string, string | null>();
	for (const declaration of scanSimpleConfigDeclarations(text)) declarations.set(declaration.path, declaration.value);
	return declarations;
}

export function readSimpleConfigEntries(text: string): Map<string, string> {
	const entries = new Map<string, string>();
	for (const declaration of scanSimpleConfigDeclarations(text)) {
		if (declaration.value !== null) entries.set(declaration.path, declaration.value);
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

export function readProjectMapDelegablePrefix(configText: string | undefined): string | null {
	if (typeof configText !== "string") return null;
	const value = readSimpleConfigEntries(configText).get("project_map.delegable");
	return value === undefined || value.trim().length === 0 ? null : value.trim();
}

/** The path-prefix mapping a project declares for deriving capability surfaces. */
export function readProjectMapSurfaceMap(configText: string | undefined): {
	surfaces: Map<ProjectMapSurface, string[]>;
	unusableKeys: string[];
	blankSurfaces: ProjectMapSurface[];
} {
	const surfaces = new Map<ProjectMapSurface, string[]>();
	const unusableKeys: string[] = [];
	const blankSurfaces: ProjectMapSurface[] = [];
	if (typeof configText !== "string") return { surfaces, unusableKeys, blankSurfaces };

	const declarations = readSimpleConfigDeclarations(configText);
	const entries = readSimpleConfigEntries(configText);
	for (const [key] of declarations) {
		if (!key.startsWith(PROJECT_MAP_SURFACES_PREFIX)) continue;
		const surface = key.slice(PROJECT_MAP_SURFACES_PREFIX.length);
		if (!PROJECT_MAP_SURFACES.includes(surface as ProjectMapSurface)) unusableKeys.push(key);
	}
	unusableKeys.sort(comparePaths);

	for (const surface of PROJECT_MAP_SURFACES) {
		const key = `${PROJECT_MAP_SURFACES_PREFIX}${surface}`;
		if (!declarations.has(key)) continue;
		const value = entries.get(key);
		const prefixes = value === undefined ? [] : value.split(",").map((prefix) => prefix.trim()).filter((prefix) => prefix.length > 0);
		if (prefixes.length === 0) {
			blankSurfaces.push(surface);
			continue;
		}
		surfaces.set(surface, prefixes);
	}
	return { surfaces, unusableKeys, blankSurfaces };
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

function isDelegableWorkUnitCode(code: string, prefix: string): boolean {
	return code.startsWith(prefix) && /^\d+(?:-\d+)*$/.test(code.slice(prefix.length));
}

function isDelegableWorkUnitLabel(label: string, prefix: string): boolean {
	const { head } = splitWorkUnitLabel(label);
	const code = head.length === 0 ? label.trim() : head.replace(/—\s*$/, "").trim();
	return isDelegableWorkUnitCode(code, prefix);
}

interface DeclaredProjectMapParent {
	code: string | null;
	hasDeclaration: boolean;
	hasUnreadableDeclaration: boolean;
}

/** Reads the first readable parent declaration, retaining unreadable markers anywhere for reporting. */
function readDeclaredProjectMapParent(documentText: string): DeclaredProjectMapParent {
	let code: string | null = null;
	let hasDeclaration = false;
	let hasUnreadableDeclaration = false;
	for (const rawLine of documentText.split("\n")) {
		const line = rawLine.replace(/\r$/, "").trim().replace(BULLET, "");
		const marker = BELONGS_TO_MARKER.exec(line);
		if (marker === null) continue;
		hasDeclaration = true;
		const codes = [...line.slice(marker[0].length).matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
		if (codes.length !== 1) {
			hasUnreadableDeclaration = true;
			continue;
		}
		if (code === null) code = codes[0]!;
	}
	return { code, hasDeclaration, hasUnreadableDeclaration };
}

interface ExtractedWorkUnits {
	capabilities: { capability: ProjectMapCapabilityV1; line: string }[];
	stepCount: number;
}

function extractWorkUnits(path: string, text: string, omissions: string[], delegablePrefix: string | null): ExtractedWorkUnits {
	const capabilities: { capability: ProjectMapCapabilityV1; line: string }[] = [];
	let stepCount = 0;
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
		}
		if (delegablePrefix !== null && !isDelegableWorkUnitLabel(label, delegablePrefix)) {
			stepCount += 1;
			continue;
		}
		if (id === null) continue;
		capabilities.push({
			capability: {
				id,
				outcome: label,
				foundationRefs: [],
				dependsOn: [],
				contracts: [],
				featureDocs: [path],
				surfaces: [],
				state: projectMapStateFromCheckbox(match[1]),
			},
			line,
		});
	}
	return { capabilities, stepCount };
}

function declaredEditSurfacePaths(documentText: string, capabilityId: string): string[] {
	const description = readProjectMapWorkUnit(documentText, capabilityId);
	// Guard only: a generated capability cannot reach it because extraction and lookup share one
	// document, label parser, and identifier normalization, but this primitive accepts any id.
	if (description === null) return [];
	const declaration = description.lines.find((line) => ALLOWED_EDIT_SURFACES_MARKER.test(line));
	if (declaration === undefined) return [];
	return [...declaration.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
}

function deriveCapabilitySurfaces(documentText: string, capability: ProjectMapCapabilityV1, surfaceMap: Map<ProjectMapSurface, string[]>): ProjectMapSurface[] {
	const matched = new Set<ProjectMapSurface>();
	for (const path of declaredEditSurfacePaths(documentText, capability.id)) {
		let selected: ProjectMapSurface | null = null;
		let longestPrefix = -1;
		for (const surface of PROJECT_MAP_SURFACES) {
			for (const prefix of surfaceMap.get(surface) ?? []) {
				if (path.startsWith(prefix) && prefix.length > longestPrefix) {
					selected = surface;
					longestPrefix = prefix.length;
				}
			}
		}
		if (selected !== null) matched.add(selected);
	}
	return PROJECT_MAP_SURFACES.filter((surface) => matched.has(surface)) as ProjectMapSurface[];
}

function unmatchedDeclaredEditSurfacePaths(documentText: string, capability: ProjectMapCapabilityV1, surfaceMap: Map<ProjectMapSurface, string[]>): string[] {
	return declaredEditSurfacePaths(documentText, capability.id).filter(
		(path) => ![...surfaceMap.values()].flat().some((prefix) => path.startsWith(prefix)),
	);
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
	const declaredSurfaceMap = readProjectMapSurfaceMap(openspecConfig ?? undefined);
	for (const key of declaredSurfaceMap.unusableKeys) {
		omissions.push(`openspec/config.yaml declares unsupported surface key "${key}", so project_map.surfaces cannot honour it.`);
	}
	for (const surface of declaredSurfaceMap.blankSurfaces) {
		omissions.push(`openspec/config.yaml declares project_map.surfaces.${surface}, but its value names no path prefix, so it cannot map declared edit surfaces.`);
	}
	const derivesSurfaces = declaredSurfaceMap.surfaces.size > 0;
	const capabilities: ProjectMapCapabilityV1[] = [];
	const declaredBy = new Map<string, { path: string; line: string }>();
	const declaredRoadmapPath = readProjectMapRoadmapPath(openspecConfig ?? undefined);
	const declaredDelegablePrefix = readProjectMapDelegablePrefix(openspecConfig ?? undefined);
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
		assumptions.push(
			declaredDelegablePrefix === null
				? "No project_map.roadmap is declared, so every top-level work unit of every supplied ODD task document became a capability source and their granularity may be mixed."
				: `No project_map.roadmap is declared, so units whose codes do not match the declared "${declaredDelegablePrefix}" convention were read as steps rather than capabilities.`,
		);
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

	let stepCount = 0;
	for (const document of capabilityDocuments) {
		const extracted = extractWorkUnits(document.path, document.text, omissions, declaredDelegablePrefix);
		stepCount += extracted.stepCount;
		if (extracted.capabilities.length === 0 && extracted.stepCount === 0) {
			omissions.push(`${document.path} declares no work unit this generator can read, so it contributed no capability.`);
		}
		for (const extractedWorkUnit of extracted.capabilities) {
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
			if (derivesSurfaces) {
				capability.surfaces = deriveCapabilitySurfaces(document.text, capability, declaredSurfaceMap.surfaces);
				const unmatched = unmatchedDeclaredEditSurfacePaths(document.text, capability, declaredSurfaceMap.surfaces);
				if (unmatched.length > 0) {
					omissions.push(`The capability "${capability.id}" declared by ${document.path} has paths that matched no project_map.surfaces prefix: ${unmatched.join(", ")}.`);
				}
			}
			capabilities.push(capability);
		}
	}
	// Only retained extraction rows can honour a parent, including when a roadmap limits sources.
	const rowCodes = new Set(capabilities.map((capability) => {
		const label = splitWorkUnitLabel(capability.outcome);
		return (label.head.length === 0 ? capability.outcome : label.head.replace(/—\s*$/, "")).trim();
	}));
	for (const document of documents) {
		const declared = readDeclaredProjectMapParent(document.text);
		if (!declared.hasDeclaration) continue;
		const usable = declared.code !== null && declaredDelegablePrefix !== null
			&& isDelegableWorkUnitCode(declared.code, declaredDelegablePrefix) && rowCodes.has(declared.code);
		if (!usable) {
			const reason = declared.code === null ? ""
				: declaredDelegablePrefix === null ? ": the project declares no project_map.delegable convention"
				: `: "${declared.code}" is not a functional point this map declares`;
			omissions.push(`${document.path} declares an unusable **Belongs to:** declaration${reason}, so its work units were associated with no functional-point row.`);
		} else if (declared.hasUnreadableDeclaration) {
			omissions.push(`${document.path} has an unreadable **Belongs to:** marker that was ignored; the readable declaration "${declared.code}" was used instead.`);
		}
	}
	if (declaredDelegablePrefix !== null) {
		assumptions.push(
			`${stepCount} work unit${stepCount === 1 ? " was" : "s were"} read as steps instead of capabilities because their codes do not match the declared "${declaredDelegablePrefix}" convention.`,
		);
	}
	if (capabilities.length === 0) {
		omissions.push("No supplied source names a product capability, so the draft carries none; capabilities must come from the ODD work-unit extraction or from the human.");
	}

	assumptions.push("Every generated map is a draft: this generator never marks a map approved, and approval requires a human actor and an explicit transition.");
	assumptions.push("A generated foundation is done only when its named structured source carries a well-formed declaration of it; done therefore means declared, not verified.");
	assumptions.push("Foundation identifiers are generic proposals derived from repository tooling, and the human is expected to replace or extend them with the project's real foundations.");
	assumptions.push("Project identity is derived from the package manifest name, with the scope removed and the remainder normalized to lowercase kebab-case.");
	assumptions.push("An ODD work unit becomes a capability named after its title, a checked box becomes done and an unchecked box becomes planned, and the declaring document becomes its feature document. The checkbox is a declaration of completion, not verified progress.");
	assumptions.push(
		derivesSurfaces
			? "Generated capability surfaces were derived from the capability's own declared edit surfaces through project_map.surfaces; a capability without that line remains undeclared."
			: "A generated capability leaves its surface list empty, because no structured source states which product surfaces it touches.",
	);

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
