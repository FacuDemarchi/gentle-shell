import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readProjectMapCoordinationState } from "../lib/project-map-coordination-state.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { projectMapExecutableRefusal } from "../lib/shell-project-map-gate.ts";
import { listProjectMapStoreWorktreeBindings } from "../lib/project-map-store-worktrees.ts";
import { readProjectMapStoreHeartbeat } from "../lib/project-map-store-heartbeats.ts";
import { collectProjectMapSteps, deriveProjectMap, splitWorkUnitLabel } from "../lib/shell-project-map-draft.ts";
import { readCapabilityDescription, type ProjectMapDescription } from "../lib/project-map-description.ts";
import {
	PROJECT_MAP_TRANSLATIONS_PATH,
	projectMapTranslationFor,
	projectMapTranslationWorklist,
	renderProjectMapTranslationReport,
	readProjectMapTranslations,
} from "../lib/project-map-translations.ts";
import { buildProjectMapHelpContent, ProjectMapHelpModal, type ProjectMapHelpResult } from "../lib/project-map-help-modal.ts";
import { projectMapCardPart } from "../lib/shell-project-map-card.ts";
import { createOrchestratorSessionTabsSnapshot, orchestratorSessionTabsDigest, orchestratorSessionTabsRail, renderOrchestratorSessionTabDetail } from "../lib/shell-project-map-tabs.ts";
import { listPresence } from "../lib/orchestrator-presence.ts";
import { sidebarHeaderContributor, sidebarState } from "../lib/shell-sidebar.ts";
import { resolveGentlePiAgentHome } from "../lib/agent-home.ts";
import type { CardTheme } from "../lib/shell-card.ts";
import { invalidateSidebar, RAIL_WIDTH } from "../lib/shell-sidebar-layout.ts";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	isSafeFeatureDocumentPath,
	readProjectMapFile,
	type ProjectMapCapabilityV1,
	type ProjectMapDiagnostic,
	type ProjectMapV1,
} from "../lib/shell-project-map-schema.ts";
import { orderCapabilitiesForDisplay } from "../lib/shell-project-map-display-order.ts";
import {
	PROJECT_MAP_EXPANDED,
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	type ProjectMapCardState,
	projectMapCoverage,
	projectMapCoverageLines,
	projectMapStaticBlockers,
	toggleProjectMapGroup,
	type ProjectMapCollapseState,
	type ProjectMapGroup,
} from "../lib/shell-project-map-view.ts";

// Project Map: the repository-owned definition of what the product is, kept below
// Status. This extension owns only the human entry point — generating a draft,
// reviewing it, and recording an approval. Rendering the map is a later unit, and
// approval is deliberately a declaration of plan authority: this command starts no
// writer, provisions no worktree, and authorizes no commit, push, or merge.

export const PROJECT_MAP_COMMAND_NAME = "gentle:project-map";
export const PROJECT_MAP_WIDGET_KEY = "gentle-project-map";
export const PROJECT_MAP_COLLAPSE_KEY_DEFAULT = "alt+m";
export const PROJECT_MAP_NEXT_KEY_DEFAULT = "alt+j";
export const PROJECT_MAP_PREV_KEY_DEFAULT = "alt+k";
export const PROJECT_MAP_HELP_KEY_DEFAULT = "alt+e";

function projectMapKey(value: string | undefined, fallback: string): string | undefined {
	if (value === undefined || value === "") return fallback;
	return value.toLowerCase() === "off" ? undefined : value;
}

export function parseProjectMapCollapseKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return projectMapKey(env.GENTLE_PI_PROJECT_MAP_KEY?.trim(), PROJECT_MAP_COLLAPSE_KEY_DEFAULT);
}

export function parseProjectMapNextKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return projectMapKey(env.GENTLE_PI_PROJECT_MAP_NEXT_KEY?.trim(), PROJECT_MAP_NEXT_KEY_DEFAULT);
}

export function parseProjectMapPrevKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return projectMapKey(env.GENTLE_PI_PROJECT_MAP_PREV_KEY?.trim(), PROJECT_MAP_PREV_KEY_DEFAULT);
}

export function parseProjectMapHelpKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return projectMapKey(env.GENTLE_PI_PROJECT_MAP_HELP_KEY?.trim(), PROJECT_MAP_HELP_KEY_DEFAULT);
}
export const PROJECT_MAP_SUB_ACTIONS = ["show", "hide", "translate"] as const;

export type ProjectMapSubAction = (typeof PROJECT_MAP_SUB_ACTIONS)[number];

const USAGE = {
	command: `Usage: /${PROJECT_MAP_COMMAND_NAME} <${PROJECT_MAP_SUB_ACTIONS.join("|")}>`,
	show: `Usage: /${PROJECT_MAP_COMMAND_NAME} show`,
	hide: `Usage: /${PROJECT_MAP_COMMAND_NAME} hide`,
	translate: `Usage: /${PROJECT_MAP_COMMAND_NAME} translate`,
} as const;

export interface ProjectMapCommandContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: (message: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
		/**
		 * The overlay host. The card cannot reach it — its pointer handler is synchronous and an
		 * overlay is awaited — so a click on the marker reports the capability and this extension
		 * opens the modal. Declared structurally because this context is the subset the command
		 * needs, not the whole Pi context.
		 */
		custom?: <T>(factory: (tui: TUI, theme: CardTheme, keybindings: unknown, done: (result: T) => void) => Component & { dispose?(): void }, options?: { overlay?: boolean; overlayOptions?: { anchor?: string; width?: number | string; minWidth?: number; maxHeight?: number | string; margin?: number | { top?: number; right?: number; bottom?: number; left?: number } } }) => Promise<T>;
		setWidget?: (key: string, widget: ((tui: TUI, theme: CardTheme) => Component) | undefined, options?: { placement: "belowEditor" }) => void;
	};
	sessionManager?: {
		getSessionId: () => string | undefined;
	};
}

export interface ProjectMapCommandDiagnostic {
	code: string;
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface ProjectMapCommandReport {
	action: ProjectMapSubAction | null;
	wrote: boolean;
	map: ProjectMapV1 | null;
	assumptions: string[];
	omissions: string[];
	diagnostics: ProjectMapCommandDiagnostic[];
}

export interface ProjectMapCommandOptions {
	now?: () => Date;
	/** The environment the opt-in gate is read from; the registration site supplies it, defaulting to the process. */
	env?: NodeJS.ProcessEnv;
	onShow?: () => void;
	onHide?: () => void;
}

export interface ProjectMapSubActionParse {
	ok: boolean;
	action: ProjectMapSubAction | null;
	argument: string;
	message: string;
}

export function parseProjectMapSubAction(args: string): ProjectMapSubActionParse {
	const [head = "", ...rest] = args.trim().split(/\s+/);
	// Display is read-only; artifact generation remains an explicit sub-action.
	if (head.length === 0) return { ok: true, action: "show", argument: "", message: "" };
	if (!PROJECT_MAP_SUB_ACTIONS.includes(head as ProjectMapSubAction)) {
		return { ok: false, action: null, argument: "", message: `Unknown sub-action "${head}". ${USAGE.command}` };
	}
	return { ok: true, action: head as ProjectMapSubAction, argument: rest.join(" ").trim(), message: "" };
}

function refusal(message: string, path = "$"): ProjectMapDiagnostic {
	return { code: "project-map/invalid-field", path, message, severity: "error" };
}

function emptyReport(action: ProjectMapSubAction | null, diagnostics: ProjectMapCommandDiagnostic[] = []): ProjectMapCommandReport {
	return { action, wrote: false, map: null, assumptions: [], omissions: [], diagnostics };
}

function sessionKey(ctx: ProjectMapCommandContext): string {
	return ctx.sessionManager?.getSessionId() ?? "";
}

function describeDiagnostics(diagnostics: Array<{ code: string; path: string; message: string }>): string {
	return diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}`).join("\n");
}

/**
 * A source read. The shape is flat rather than a discriminated union on purpose: this
 * repository compiles with `strict: false`, and TypeScript does not narrow a union by its
 * discriminant under that setting, so a union would force every caller into a cast. The
 * invariant is explicit instead: `reason` is null exactly when `ok` is true, and `text` is
 * empty exactly when it is not.
 */
interface SourceRead {
	ok: boolean;
	text: string;
	reason: "absent" | "unreadable" | null;
}

/**
 * Distinguishes a source that is not there from one that is there and cannot be read.
 * Conflating them sends the operator looking for a missing file that is right in front of
 * them, so `ENOENT` and a missing parent mean absent while anything else means unreadable.
 */
function readSource(path: string): SourceRead {
	try {
		return { ok: true, text: readFileSync(path, "utf8"), reason: null };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | null)?.code;
		return { ok: false, text: "", reason: code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable" };
	}
}

/**
 * Explains one capability: the facts the map declares, and what the document it came from says
 * about it.
 *
 * The card cannot open an overlay — its pointer handler is synchronous and an overlay is an
 * awaited `ctx.ui.custom` — so a click on the marker reports the capability and this opens the
 * modal. `railColumns` is the rail the overlay must stay clear of: the card lives there, and a
 * centered overlay would cover the thing being explained. Zero means no rail, and the overlay
 * then opens centered like the shell's other overlays. A document the map names but cannot be
 * read is not an error: the modal then says the description is missing rather than inventing one.
 *
 * The words themselves come from `translatedExplanation`, which is the only place a translation is
 * ever consulted: this read is synchronous and the extension has no model, so the translation was
 * made once by an agent and stored next to the map.
 */
export async function explainProjectMapCapability(ctx: ProjectMapCommandContext, capabilityId: string, railColumns = 0): Promise<void> {
	const repository = readProjectMapDisplay(ctx.cwd);
	const map = repository.map;
	const capability = map?.capabilities.find((entry) => entry.id === capabilityId);
	if (map === null || capability === undefined) {
		ctx.ui.notify(`No FP work unit named "${capabilityId}" was found in odd/tasks/*.md.`);
		return;
	}
	if (!ctx.hasUI || ctx.ui.custom === undefined) {
		ctx.ui.notify(`Explaining ${capabilityId} needs an interactive session.`);
		return;
	}
	const document = capability.featureDocs[0];
	const source = document === undefined ? null : readSource(join(ctx.cwd, document));
	const label = splitWorkUnitLabel(capability.outcome);
	const code = (label.head.length === 0 ? capability.outcome : label.head.replace(/—\s*$/, "")).trim();
	const description = source !== null && source.ok ? readCapabilityDescription(source.text, capabilityId, code) : null;
	const translated = translatedExplanation(ctx.cwd, capability, description);
	const steps = collectProjectMapSteps(repository.sources.oddTaskDocuments ?? [], code, "FP-");
	// The static blockers are the one fact the retired Inspector alone carried, so they travel
	// with the explanation instead of disappearing with it.
	const content = buildProjectMapHelpContent(
		translated.capability,
		translated.description,
		projectMapStaticBlockers(map, capabilityId),
		translated.note,
		steps,
		projectMapCoverageLines(map, projectMapCoverage(map)),
	);
	try {
		await ctx.ui.custom<ProjectMapHelpResult>(
			(tui, theme, _keybindings, done) => new ProjectMapHelpModal(content, done, theme, () => Math.max(0, tui.terminal.rows)),
			{ overlay: true, overlayOptions: helpOverlayOptions(railColumns) },
		);
	} catch (error) {
		ctx.ui.notify(`The capability could not be explained: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * The explanation's words, in Spanish when a current translation exists.
 *
 * The card cannot translate: this read is synchronous and an extension has no model call. So the
 * translation is made once, stored next to the map, and this decides whether what is stored still
 * matches the body it was made from. A missing or stale translation is never an error and never
 * silent: the explanation falls back to the document's own words and says which of the two it is,
 * so an English paragraph in a Spanish frame is explained rather than mysterious.
 */
function translatedExplanation(cwd: string, capability: ProjectMapCapabilityV1, description: ProjectMapDescription | null): { capability: ProjectMapCapabilityV1; description: ProjectMapDescription | null; note: string | undefined } {
	if (description === null) return { capability, description, note: undefined };
	const target = PROJECT_MAP_TRANSLATIONS_PATH;
	const hint = ` · /${PROJECT_MAP_COMMAND_NAME} translate`;
	const stored = readSource(join(cwd, target));
	if (!stored.ok) return { capability, description, note: `Traducción: no generada${hint}` };
	const parsed = readProjectMapTranslations(stored.text);
	if (parsed.translations === null) return { capability, description, note: `Traducción: ${target} no se pudo usar — ${parsed.diagnostics[0] ?? "forma inválida"}` };
	const lookup = projectMapTranslationFor(parsed.translations, capability.id, description.lines);
	if (lookup.translation === null) {
		return { capability, description, note: lookup.state === "stale" ? `Traducción: desactualizada, el documento cambió${hint}` : `Traducción: no generada${hint}` };
	}
	const translation = lookup.translation;
	const { head } = splitWorkUnitLabel(capability.outcome);
	// A stored title may already carry the code with its own spacing, so the comparison ignores
	// whitespace: the code is what decides, not the exact bytes of the head.
	const flattened = (value: string): string => value.replace(/\s+/g, "");
	const translatedTitle = translation.title;
	const carriesHead =
		translatedTitle !== undefined && head.length > 0 && flattened(splitWorkUnitLabel(translatedTitle).head) === flattened(head);
	const outcome = translatedTitle === undefined
		? capability.outcome
		: head.length === 0 || carriesHead
			? translatedTitle
			: `${head}${translatedTitle}`;
	return {
		capability: translation.title === undefined ? capability : { ...capability, outcome },
		description: { title: description.title, lines: translation.lines },
		note: undefined,
	};
}

/**
 * Where the help overlay opens. With no rail it is the shell's own centered 70% overlay; with a
 * rail it anchors left and reserves the rail's columns, because the overlay explains a row that
 * is painted in that rail and covering it would hide the answer's own subject.
 */
function helpOverlayOptions(railColumns: number): { anchor: string; width: string; minWidth: number; maxHeight: string; margin?: { left: number; right: number } } {
	if (railColumns <= 0) return { anchor: "center", width: "70%", minWidth: 60, maxHeight: "85%" };
	// The two spare columns are the overlay's own right border column and the layout gap the rail
	// leaves behind it, so the reservation covers the rail's frame, not just its content.
	return { anchor: "left-center", width: "70%", minWidth: 60, maxHeight: "85%", margin: { left: 2, right: railColumns + 2 } };
}

export function readRepositorySources(cwd: string): { sources: { packageJson?: unknown; oddTaskDocuments?: { path: string; text: string }[] }; omissions: string[] } {
	const omissions: string[] = [];
	const sources: { packageJson?: unknown; oddTaskDocuments?: { path: string; text: string }[] } = {};
	const manifest = readSource(join(cwd, "package.json"));
	if (manifest.ok) {
		try {
			sources.packageJson = JSON.parse(manifest.text);
		} catch {
			omissions.push("package.json could not be parsed as JSON, so the project identity could not be derived from it.");
		}
	} else if (manifest.reason === "unreadable") {
		omissions.push("package.json exists but could not be read, so the project identity could not be derived from it.");
	}
	const tasksRoot = join(cwd, "odd", "tasks");
	const documents: { path: string; text: string }[] = [];
	const hasTasksRoot = existsSync(tasksRoot);
	if (hasTasksRoot) {
		for (const name of readdirSync(tasksRoot).sort()) {
			if (!name.endsWith(".md")) continue;
			const path = `odd/tasks/${name}`;
			const document = readSource(join(tasksRoot, name));
			if (document.ok) documents.push({ path, text: document.text });
			else if (document.reason === "unreadable") omissions.push(`${path} exists but could not be read, so it contributed no capability.`);
		}
	}
	if (hasTasksRoot || documents.length > 0) sources.oddTaskDocuments = documents;
	return { sources, omissions };
}

export function readProjectMapDisplay(cwd: string) {
	const repository = readRepositorySources(cwd);
	const derived = deriveProjectMap(repository.sources, basename(resolve(cwd)) || "project");
	// The rows the card, the `show` notification and the selection keys read are the functional
	// points' own order, never the identifier sort the canonical artifact keeps.
	const map = derived.map === null ? null : orderCapabilitiesForDisplay(derived.map);
	return { ...derived, map, sources: repository.sources, omissions: [...repository.omissions, ...derived.omissions] };
}

function displayCardState(cwd: string): ProjectMapCardState {
	const { map } = readProjectMapDisplay(cwd);
	const overlay = PROJECT_MAP_OVERLAY_UNAVAILABLE;
	return map === null ? { kind: "no-fp", path: cwd, overlay } : { kind: "ready", path: cwd, map, coverage: projectMapCoverage(map), overlay, derived: true };
}

export async function runProjectMapCommand(args: string, ctx: ProjectMapCommandContext, options: ProjectMapCommandOptions = {}): Promise<ProjectMapCommandReport> {
	const parsed = parseProjectMapSubAction(args);
	if (!parsed.ok) {
		ctx.ui.notify(parsed.message);
		return emptyReport(null, [refusal(parsed.message)]);
	}
	const artifactPath = join(ctx.cwd, PROJECT_MAP_ARTIFACT_PATH);
	const now = options.now ?? (() => new Date());
	const environment = options.env ?? process.env;
	/**
	 * Refuses a route that acts outside the map artifact while the opt-in gate is off. It sits
	 * after a command's own argument validation, so a malformed command still reports its usage
	 * error, and before any work, so a refusal costs nothing and writes nothing.
	 */
	const executableGate = (action: ProjectMapSubAction, path: string): ProjectMapCommandReport | undefined => {
		const message = projectMapExecutableRefusal(environment);
		if (message === undefined) return undefined;
		ctx.ui.notify(message);
		return emptyReport(action, [{ code: "project-map/executable-disabled", path, message, severity: "error" }]);
	};

	if (parsed.action === "show") {
		const derived = readProjectMapDisplay(ctx.cwd);
		options.onShow?.();
		ctx.ui.notify(derived.map === null ? "Project Map card shown for this session.\nNo FP work units were found in odd/tasks/*.md. Documents declare their prefix with **Work unit prefix:** followed by one backticked literal; without it the map expects FP-." : `Project Map card shown for this session.\nProject: ${derived.map.project.name}\n${derived.map.capabilities.map((row) => row.outcome).join("\n")}`);
		return { action: "show", wrote: false, map: derived.map, assumptions: derived.assumptions, omissions: derived.omissions, diagnostics: [] };
	}

	if (parsed.action === "hide") {
		options.onHide?.();
		ctx.ui.notify("Project Map card hidden for this session.");
		return emptyReport("hide");
	}

	/**
	 * What a translation pass still has to do, and the exact shape to write.
	 *
	 * Read-only on purpose: the extension cannot translate, so this reports the work instead of
	 * doing it. The hash is the part a human or an agent cannot reproduce by hand — it is the
	 * identity of the body the reader extracted, not of the file — so the command prints it and
	 * the writer copies it verbatim.
	 */
	const reportTranslations = (map: ProjectMapV1): ProjectMapDiagnostic[] => {
		const sidecar = readSource(join(ctx.cwd, PROJECT_MAP_TRANSLATIONS_PATH));
		const stored = sidecar.ok ? readProjectMapTranslations(sidecar.text) : { translations: null, diagnostics: [] };
		const described = map.capabilities.map((capability) => {
			const document = capability.featureDocs[0];
			const source = document === undefined ? null : readSource(join(ctx.cwd, document));
			const description = source !== null && source.ok ? readCapabilityDescription(source.text, capability.id) : null;
			return { id: capability.id, source: document ?? null, lines: description?.lines ?? null };
		});
		const worklist = projectMapTranslationWorklist(described, stored.translations);
		ctx.ui.notify(renderProjectMapTranslationReport({ worklist, targetExists: sidecar.ok, diagnostics: stored.diagnostics }));
		return stored.diagnostics.map((message) => refusal(message, "$.translations"));
	};

	if (parsed.action === "translate") {
		const read = readProjectMapFile(artifactPath);
		if (read.map === null) {
			ctx.ui.notify(`No Project Map at ${PROJECT_MAP_ARTIFACT_PATH}, so there is nothing to translate.\n${read.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return emptyReport("translate", read.diagnostics);
		}
		return { action: "translate", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: [...read.diagnostics, ...reportTranslations(read.map)] };
	}

}

interface ProjectMapSessionRecord {
	visibility: boolean | undefined;
	collapse: ProjectMapCollapseState;
	selection: string | undefined;
	tabsSelection: string | undefined;
}

export const PROJECT_MAP_TABS_CONTRIBUTOR_KEY = "orchestrator-tabs";

/**
 * The coordination store and presence are far heavier than the map artifact the
 * card re-reads every render, so the tabs snapshot is bounded to one store read
 * per window instead of one per frame. Heartbeats move on a ten-second cadence, so
 * two seconds keeps the row honest without putting directory scans on the paint path.
 */
const PROJECT_MAP_TABS_REFRESH_MS = 2_000;

const projectMapTabsReaders = {
	coordination: ({ root, mapPath, now }: { root: string; mapPath: string; now: string }) => readProjectMapCoordinationState({ root, mapPath, now }),
	worktreeBindings: (root: string) => {
		const listed = listProjectMapStoreWorktreeBindings({ root });
		return {
			bindings: listed.bindings.map((binding) => ({ capabilityId: binding.capability_id, sessionId: binding.session_id, branch: binding.branch, worktreeRoot: binding.worktree_root })),
			diagnostics: listed.diagnostics,
		};
	},
	// Presence keys a session by a hash of its id, so the hashing belongs here,
	// next to the reader that knows the format, and never in the projection.
	presenceAlive: (profile: string | undefined, sessionIds: readonly string[]) => {
		if (profile === undefined) return null;
		const page = listPresence(profile, Date.now());
		if (page.unavailable !== undefined) return null;
		const present = new Set(page.entries.map((entry) => entry.sessionHash));
		return new Set(sessionIds.filter((sessionId) => present.has(createHash("sha256").update(sessionId).digest("hex"))));
	},
	lastActivity: (root: string, sessionId: string) => readProjectMapStoreHeartbeat({ root, sessionId, now: new Date().toISOString() }).heartbeat?.beat_at,
};

export default function gentleProjectMap(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
	const sessions = new Map<string, ProjectMapSessionRecord>();
	const mounted = new Map<string, { part: Component & { dispose?(): void }; tui: TUI; disposeTabs?: () => void }>();
	const collapseKey = parseProjectMapCollapseKey(env);
	const nextKey = parseProjectMapNextKey(env);
	const prevKey = parseProjectMapPrevKey(env);
	const helpKey = parseProjectMapHelpKey(env);
	const record = (ctx: ProjectMapCommandContext): ProjectMapSessionRecord => {
		const key = sessionKey(ctx);
		const existing = sessions.get(key);
		if (existing) return existing;
		const created = { visibility: undefined, collapse: { ...PROJECT_MAP_EXPANDED }, selection: undefined, tabsSelection: undefined };
		sessions.set(key, created);
		return created;
	};
	const artifactPath = (ctx: ProjectMapCommandContext) => join(ctx.cwd, PROJECT_MAP_ARTIFACT_PATH);
	const effectiveVisibility = (ctx: ProjectMapCommandContext) => record(ctx).visibility ?? true;
	const refresh = (ctx: ProjectMapCommandContext) => {
		const current = mounted.get(sessionKey(ctx));
		if (!current) return;
		invalidateSidebar(current.tui);
		(current.tui as unknown as { requestRender?: () => void }).requestRender?.();
	};
	const unmount = (ctx: ProjectMapCommandContext) => {
		const key = sessionKey(ctx);
		const current = mounted.get(key);
		current?.disposeTabs?.();
		current?.part.dispose?.();
		ctx.ui.setWidget?.(PROJECT_MAP_WIDGET_KEY, undefined);
		if (current) refresh(ctx);
		mounted.delete(key);
	};
	const mount = (ctx: ProjectMapCommandContext) => {
		if (!effectiveVisibility(ctx) || !ctx.ui.setWidget) return;
		const key = sessionKey(ctx);
		const path = artifactPath(ctx);
		ctx.ui.setWidget(PROJECT_MAP_WIDGET_KEY, (tui, theme) => {
			const session = {
				collapse: () => record(ctx).collapse,
				selection: () => record(ctx).selection,
				select: (id: string | undefined) => {
					record(ctx).selection = id;
					refresh(ctx);
				},
				toggle: (group: ProjectMapGroup) => {
					const current = record(ctx);
					current.collapse = toggleProjectMapGroup(current.collapse, group);
					refresh(ctx);
				},
			};
			// The tabs reach the screen through two different doors, because neither surface
			// accepts a second owner: the row contributes to the single-owner header, and the
			// detail lends its rows to the card, since the rail's sections are a closed list.
			// A store root that cannot be resolved leaves both absent, never failing the card.
			const storeRoot = (() => {
				try { return resolveProjectMapStoreRoot(ctx.cwd).root; } catch { return null; }
			})();
			const tabs = storeRoot === null ? undefined : (() => {
				try {
					return createOrchestratorSessionTabsSnapshot({
						root: storeRoot,
						mapPath: path,
						profile: resolveGentlePiAgentHome(env),
						readers: projectMapTabsReaders,
						now: () => Date.now(),
						refreshMs: PROJECT_MAP_TABS_REFRESH_MS,
					});
				} catch { return undefined; }
			})();
			const part = projectMapCardPart(tui, path, theme, session, collapseKey, tabs === undefined ? undefined : {
				lines: (width: number) => renderOrchestratorSessionTabDetail({ tabs: tabs.read(), selection: record(ctx).tabsSelection, width, theme }),
				digest: () => `tabs:${orchestratorSessionTabsDigest(tabs.read(), record(ctx).tabsSelection)}`,
			}, (capabilityId) => { void explainProjectMapCapability(ctx, capabilityId, sidebarState(tui).active ? RAIL_WIDTH : 0); }, () => displayCardState(ctx.cwd));
			const disposeTabs = tabs === undefined ? undefined : sidebarHeaderContributor(tui, PROJECT_MAP_TABS_CONTRIBUTOR_KEY, orchestratorSessionTabsRail({
				read: () => tabs.read(),
				selection: {
					selected: () => record(ctx).tabsSelection,
					select: (capabilityId) => {
						record(ctx).tabsSelection = capabilityId;
						refresh(ctx);
					},
				},
				theme,
			}));
			mounted.set(key, { part, tui, disposeTabs });
			return part;
		}, { placement: "belowEditor" });
	};

	pi.registerCommand(PROJECT_MAP_COMMAND_NAME, {
		description: "Generate, declare, inspect, approve, show, hide, or provision repository Project Map worktrees.",
		handler: async (args, ctx) => {
			const commandCtx = ctx as unknown as ProjectMapCommandContext;
			await runProjectMapCommand(args, commandCtx, {
				onShow: () => { record(commandCtx).visibility = true; mount(commandCtx); },
				onHide: () => { record(commandCtx).visibility = false; unmount(commandCtx); },
				env,
			});
		},
	});

	if (collapseKey) {
		pi.registerShortcut(collapseKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Collapse or expand the Project Map groups",
			handler: async (ctx) => {
				const commandCtx = ctx as unknown as ProjectMapCommandContext;
				if (!mounted.has(sessionKey(commandCtx))) {
					commandCtx.ui.notify("Project Map card is hidden for this session.");
					return;
				}
				const current = record(commandCtx);
				const allCollapsed = current.collapse.foundations && current.collapse.capabilities;
				current.collapse = allCollapsed ? { ...PROJECT_MAP_EXPANDED } : { foundations: true, capabilities: true };
				refresh(commandCtx);
			},
		});
	}

	const selectBy = (offset: -1 | 1) => async (ctx: unknown) => {
		const commandCtx = ctx as ProjectMapCommandContext;
		if (!mounted.has(sessionKey(commandCtx))) {
			commandCtx.ui.notify("Project Map card is hidden for this session.");
			return;
		}
		const map = readProjectMapDisplay(commandCtx.cwd).map;
		const capabilities = map?.capabilities ?? [];
		const current = record(commandCtx);
		if (capabilities.length > 0) {
			const index = capabilities.findIndex((capability) => capability.id === current.selection);
			const next = capabilities[index < 0 ? 0 : Math.max(0, Math.min(capabilities.length - 1, index + offset))]!;
			current.selection = next.id;
			if (current.collapse.capabilities) current.collapse = { ...current.collapse, capabilities: false };
		}
		refresh(commandCtx);
	};
	if (nextKey) pi.registerShortcut(nextKey as Parameters<ExtensionAPI["registerShortcut"]>[0], { description: "Select the next Project Map capability", handler: selectBy(1) });
	if (prevKey) pi.registerShortcut(prevKey as Parameters<ExtensionAPI["registerShortcut"]>[0], { description: "Select the previous Project Map capability", handler: selectBy(-1) });
	if (helpKey) pi.registerShortcut(helpKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
		description: "Explain the selected Project Map capability",
		handler: async (ctx) => {
			const commandCtx = ctx as unknown as ProjectMapCommandContext;
			const selection = record(commandCtx).selection;
			if (selection === undefined) {
				commandCtx.ui.notify("Select a Project Map capability first, then explain it.");
				return;
			}
			const current = mounted.get(sessionKey(commandCtx));
			await explainProjectMapCapability(commandCtx, selection, current !== undefined && sidebarState(current.tui).active ? RAIL_WIDTH : 0);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		mount(ctx as unknown as ProjectMapCommandContext);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const commandCtx = ctx as unknown as ProjectMapCommandContext;
		unmount(commandCtx);
		sessions.delete(sessionKey(commandCtx));
	});
}
