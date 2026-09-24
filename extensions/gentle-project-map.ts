import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { approveProjectMap, declareProjectMapSurfaces, writeProjectMapFile } from "../lib/shell-project-map-approval.ts";
import { generateProjectMapDraft } from "../lib/shell-project-map-draft.ts";
import { projectMapCardPart, projectMapCardVisible } from "../lib/shell-project-map-card.ts";
import type { CardTheme } from "../lib/shell-card.ts";
import { invalidateSidebar } from "../lib/shell-sidebar-layout.ts";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	readProjectMapFile,
	type ProjectMapDiagnostic,
	type ProjectMapV1,
} from "../lib/shell-project-map-schema.ts";
import {
	PROJECT_MAP_EXPANDED,
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
export const PROJECT_MAP_SUB_ACTIONS = ["draft", "declare", "approve", "status", "show", "hide"] as const;
export type ProjectMapSubAction = (typeof PROJECT_MAP_SUB_ACTIONS)[number];

const USAGE = {
	command: `Usage: /${PROJECT_MAP_COMMAND_NAME} <${PROJECT_MAP_SUB_ACTIONS.join("|")}>`,
	draft: `Usage: /${PROJECT_MAP_COMMAND_NAME} draft`,
	declare: `Usage: /${PROJECT_MAP_COMMAND_NAME} declare <capability-id> <surface>...`,
	approve: `Usage: /${PROJECT_MAP_COMMAND_NAME} approve <actor>`,
	status: `Usage: /${PROJECT_MAP_COMMAND_NAME} status`,
	show: `Usage: /${PROJECT_MAP_COMMAND_NAME} show`,
	hide: `Usage: /${PROJECT_MAP_COMMAND_NAME} hide`,
} as const;

export interface ProjectMapCommandContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: (message: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
		setWidget?: (key: string, widget: ((tui: TUI, theme: CardTheme) => Component) | undefined, options?: { placement: "belowEditor" }) => void;
	};
	sessionManager?: {
		getSessionId: () => string | undefined;
	};
}

export interface ProjectMapCommandReport {
	action: ProjectMapSubAction | null;
	wrote: boolean;
	map: ProjectMapV1 | null;
	assumptions: string[];
	omissions: string[];
	diagnostics: ProjectMapDiagnostic[];
}

export interface ProjectMapCommandOptions {
	now?: () => Date;
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
	if (head.length === 0) return { ok: false, action: null, argument: "", message: `A sub-action is required. ${USAGE.command}` };
	if (!PROJECT_MAP_SUB_ACTIONS.includes(head as ProjectMapSubAction)) {
		return { ok: false, action: null, argument: "", message: `Unknown sub-action "${head}". ${USAGE.command}` };
	}
	return { ok: true, action: head as ProjectMapSubAction, argument: rest.join(" ").trim(), message: "" };
}

function refusal(message: string, path = "$"): ProjectMapDiagnostic {
	return { code: "project-map/invalid-field", path, message, severity: "error" };
}

function emptyReport(action: ProjectMapSubAction | null, diagnostics: ProjectMapDiagnostic[] = []): ProjectMapCommandReport {
	return { action, wrote: false, map: null, assumptions: [], omissions: [], diagnostics };
}

function readText(path: string): string | undefined {
	const read = readSource(path);
	return read.ok ? read.text : undefined;
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

function readArtifactText(path: string): string | null {
	const read = readSource(path);
	return read.ok ? read.text : null;
}

/**
 * Reports whether the artifact moved since it was observed. An unreadable artifact is its
 * own state rather than an absent one, because conflating them would let a write replace a
 * file nobody could read: the observation would be `null`, the re-check would also be
 * `null`, and the guard would wave the write through.
 */
function artifactMovedSince(path: string, observed: SourceRead): boolean {
	const current = readSource(path);
	return current.ok !== observed.ok || current.reason !== observed.reason || current.text !== observed.text;
}

function unreadableArtifactRefusal(path: string): ProjectMapDiagnostic | null {
	const observed = readSource(path);
	if (observed.reason !== "unreadable") return null;
	return refusal(`The artifact at ${path} exists but could not be read, so nothing was written; writing blind would replace a file this command cannot inspect.`, "$");
}

function readRepositorySources(cwd: string): { sources: { packageJson?: unknown; openspecConfig?: string; oddTaskDocuments?: { path: string; text: string }[] }; omissions: string[] } {
	const omissions: string[] = [];
	const sources: { packageJson?: unknown; openspecConfig?: string; oddTaskDocuments?: { path: string; text: string }[] } = {};
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
	const config = readSource(join(cwd, "openspec", "config.yaml"));
	if (config.ok) sources.openspecConfig = config.text;
	else if (config.reason === "unreadable") omissions.push("openspec/config.yaml exists but could not be read, so no quality gate could be derived from it.");
	const tasksRoot = join(cwd, "odd", "tasks");
	if (existsSync(tasksRoot)) {
		const documents: { path: string; text: string }[] = [];
		for (const name of readdirSync(tasksRoot).sort()) {
			if (!name.endsWith(".md")) continue;
			const document = readSource(join(tasksRoot, name));
			if (document.ok) documents.push({ path: `odd/tasks/${name}`, text: document.text });
			else if (document.reason === "unreadable") omissions.push(`odd/tasks/${name} exists but could not be read, so it contributed no capability.`);
		}
		sources.oddTaskDocuments = documents;
	}
	return { sources, omissions };
}

function describe(map: ProjectMapV1): string {
	const done = map.capabilities.filter((capability) => capability.state === "done").length;
	const undetermined = map.capabilities.filter((capability) => capability.surfaces.length === 0).length;
	return [
		`Project Map (${map.approval.state})`,
		`Project: ${map.project.name} (${map.project.id})`,
		`Foundations: ${map.foundations.length}`,
		`Capabilities: ${map.capabilities.length} (${done} done, ${undetermined} without a declared surface)`,
	].join("\n");
}

export async function runProjectMapCommand(args: string, ctx: ProjectMapCommandContext, options: ProjectMapCommandOptions = {}): Promise<ProjectMapCommandReport> {
	const parsed = parseProjectMapSubAction(args);
	if (!parsed.ok) {
		ctx.ui.notify(parsed.message);
		return emptyReport(null, [refusal(parsed.message)]);
	}
	const artifactPath = join(ctx.cwd, PROJECT_MAP_ARTIFACT_PATH);
	const now = options.now ?? (() => new Date());

	if (parsed.action === "show") {
		options.onShow?.();
		ctx.ui.notify("Project Map card shown for this session.");
		return emptyReport("show");
	}

	if (parsed.action === "hide") {
		options.onHide?.();
		ctx.ui.notify("Project Map card hidden for this session.");
		return emptyReport("hide");
	}

	if (parsed.action === "status") {
		const read = readProjectMapFile(artifactPath);
		if (read.map === null) {
			ctx.ui.notify(`No approved or draft Project Map at ${PROJECT_MAP_ARTIFACT_PATH}.\n${read.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return emptyReport("status", read.diagnostics);
		}
		ctx.ui.notify(describe(read.map));
		return { action: "status", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: [] };
	}

	if (parsed.action === "draft") {
		const observed = readSource(artifactPath);
		const unreadable = unreadableArtifactRefusal(artifactPath);
		if (unreadable !== null) {
			ctx.ui.notify(unreadable.message);
			return emptyReport("draft", [unreadable]);
		}
		const repository = readRepositorySources(ctx.cwd);
		const generated = generateProjectMapDraft(repository.sources);
		const omissions = [...repository.omissions, ...generated.omissions];
		if (generated.map === null) {
			ctx.ui.notify(`A draft could not be generated.\n${omissions.join("\n")}`);
			return { action: "draft", wrote: false, map: null, assumptions: generated.assumptions, omissions, diagnostics: [refusal("The draft could not be generated.")] };
		}
		const summary = [describe(generated.map), "", "Assumptions:", ...generated.assumptions.map((entry) => `- ${entry}`), "", "Omissions:", ...omissions.map((entry) => `- ${entry}`)].join("\n");
		ctx.ui.notify(summary);
		const confirmed = ctx.hasUI ? await ctx.ui.confirm("Write the Project Map draft?", `Write a draft map to ${PROJECT_MAP_ARTIFACT_PATH}? It stays a draft until you approve it.`) : false;
		if (!confirmed) {
			ctx.ui.notify("Draft discarded; nothing was written.");
			return { action: "draft", wrote: false, map: generated.map, assumptions: generated.assumptions, omissions, diagnostics: [] };
		}
		if (artifactMovedSince(artifactPath, observed)) {
			const message = `The artifact at ${PROJECT_MAP_ARTIFACT_PATH} changed while the decision was pending, so nothing was written. Re-run to see the current state.`;
			ctx.ui.notify(message);
			return { action: "draft", wrote: false, map: generated.map, assumptions: generated.assumptions, omissions, diagnostics: [refusal(message, "$")] };
		}
		const written = writeProjectMapFile(artifactPath, generated.map);
		if (!written.ok) {
			ctx.ui.notify(`The draft could not be written.\n${written.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return { action: "draft", wrote: false, map: generated.map, assumptions: generated.assumptions, omissions, diagnostics: written.diagnostics };
		}
		ctx.ui.notify(`Wrote a draft map to ${PROJECT_MAP_ARTIFACT_PATH}.`);
		return { action: "draft", wrote: true, map: generated.map, assumptions: generated.assumptions, omissions, diagnostics: [] };
	}

	if (parsed.action === "declare") {
		const [capabilityId = "", ...surfaces] = parsed.argument.split(/\s+/);
		const unreadable = unreadableArtifactRefusal(artifactPath);
		if (unreadable !== null) {
			ctx.ui.notify(unreadable.message);
			return emptyReport("declare", [unreadable]);
		}
		const observed = readSource(artifactPath);
		const read = readProjectMapFile(artifactPath);
		if (read.map === null) {
			ctx.ui.notify(`No map to declare surfaces for at ${PROJECT_MAP_ARTIFACT_PATH}.\n${read.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return emptyReport("declare", read.diagnostics);
		}
		const transition = declareProjectMapSurfaces({ map: read.map, capabilityId, surfaces });
		if (!transition.ok || transition.map === null) {
			ctx.ui.notify(`The surfaces cannot be declared yet.\n${transition.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return { action: "declare", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: transition.diagnostics };
		}
		const declared = transition.map.capabilities.find((capability) => capability.id === capabilityId)?.surfaces ?? [];
		const change = declared.length === 0 ? "not yet determined" : declared.join(", ");
		ctx.ui.notify([describe(transition.map), "", `Declared surfaces for ${capabilityId}: ${change}.`].join("\n"));
		const confirmed = ctx.hasUI ? await ctx.ui.confirm("Declare Project Map surfaces?", `Replace the declared surfaces for ${capabilityId} in ${PROJECT_MAP_ARTIFACT_PATH} with ${change}?`) : false;
		if (!confirmed) {
			ctx.ui.notify("Surface declaration discarded; nothing was written.");
			return { action: "declare", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: [] };
		}
		if (artifactMovedSince(artifactPath, observed)) {
			const message = `The artifact at ${PROJECT_MAP_ARTIFACT_PATH} changed while the decision was pending, so nothing was written. Re-run to see the current state.`;
			ctx.ui.notify(message);
			return { action: "declare", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: [refusal(message, "$")] };
		}
		const written = writeProjectMapFile(artifactPath, transition.map);
		if (!written.ok) {
			ctx.ui.notify(`The surface declaration could not be written.\n${written.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return { action: "declare", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: written.diagnostics };
		}
		ctx.ui.notify(`Declared surfaces for ${capabilityId} and wrote to ${PROJECT_MAP_ARTIFACT_PATH}.`);
		return { action: "declare", wrote: true, map: transition.map, assumptions: [], omissions: [], diagnostics: [] };
	}

	const actor = parsed.argument;
	if (actor.length === 0) {
		ctx.ui.notify(`Approval requires an actor identity, because an approval nobody can attribute is not auditable.\n${USAGE.approve}`);
		return emptyReport("approve", [refusal("Approval requires an actor identity.", "$.approval.approvedBy")]);
	}
	const observed = readSource(artifactPath);
	const unreadable = unreadableArtifactRefusal(artifactPath);
	if (unreadable !== null) {
		ctx.ui.notify(unreadable.message);
		return emptyReport("approve", [unreadable]);
	}
	const read = readProjectMapFile(artifactPath);
	if (read.map === null) {
		ctx.ui.notify(`No map to approve at ${PROJECT_MAP_ARTIFACT_PATH}.\n${read.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
		return emptyReport("approve", read.diagnostics);
	}
	const approvedAt = now().toISOString();
	const transition = approveProjectMap({ map: read.map, approvedBy: actor, approvedAt });
	if (!transition.ok || transition.map === null) {
		ctx.ui.notify(`The map cannot be approved yet.\n${transition.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
		return { action: "approve", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: transition.diagnostics };
	}
	ctx.ui.notify([describe(transition.map), "", `Approving as ${actor} at ${approvedAt}. Approval grants plan authority only: it starts no writer and authorizes no commit, push, merge, or release.`].join("\n"));
	const confirmed = ctx.hasUI ? await ctx.ui.confirm("Approve the Project Map?", `Record ${actor} as the approver of ${PROJECT_MAP_ARTIFACT_PATH}?`) : false;
	if (!confirmed) {
		ctx.ui.notify("Approval discarded; nothing was written.");
		return { action: "approve", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: [] };
	}
	if (artifactMovedSince(artifactPath, observed)) {
		const message = `The artifact at ${PROJECT_MAP_ARTIFACT_PATH} changed while the decision was pending, so nothing was written. Re-run to see the current state.`;
		ctx.ui.notify(message);
		return { action: "approve", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: [refusal(message, "$")] };
	}
	const written = writeProjectMapFile(artifactPath, transition.map);
	if (!written.ok) {
		ctx.ui.notify(`The approval could not be written.\n${written.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
		return { action: "approve", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: written.diagnostics };
	}
	ctx.ui.notify(`Approved by ${actor} and written to ${PROJECT_MAP_ARTIFACT_PATH}.`);
	return { action: "approve", wrote: true, map: transition.map, assumptions: [], omissions: [], diagnostics: [] };
}

interface ProjectMapSessionRecord {
	visibility: boolean | undefined;
	collapse: ProjectMapCollapseState;
	selection: string | undefined;
}

export default function gentleProjectMap(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
	const sessions = new Map<string, ProjectMapSessionRecord>();
	const mounted = new Map<string, { part: Component & { dispose?(): void }; tui: TUI }>();
	const collapseKey = parseProjectMapCollapseKey(env);
	const nextKey = parseProjectMapNextKey(env);
	const prevKey = parseProjectMapPrevKey(env);
	const sessionKey = (ctx: ProjectMapCommandContext) => ctx.sessionManager?.getSessionId() ?? "";
	const record = (ctx: ProjectMapCommandContext): ProjectMapSessionRecord => {
		const key = sessionKey(ctx);
		const existing = sessions.get(key);
		if (existing) return existing;
		const created = { visibility: undefined, collapse: { ...PROJECT_MAP_EXPANDED }, selection: undefined };
		sessions.set(key, created);
		return created;
	};
	const artifactPath = (ctx: ProjectMapCommandContext) => join(ctx.cwd, PROJECT_MAP_ARTIFACT_PATH);
	const effectiveVisibility = (ctx: ProjectMapCommandContext) => record(ctx).visibility ?? projectMapCardVisible(artifactPath(ctx));
	const refresh = (ctx: ProjectMapCommandContext) => {
		const current = mounted.get(sessionKey(ctx));
		if (!current) return;
		invalidateSidebar(current.tui);
		(current.tui as unknown as { requestRender?: () => void }).requestRender?.();
	};
	const unmount = (ctx: ProjectMapCommandContext) => {
		const key = sessionKey(ctx);
		const current = mounted.get(key);
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
			const part = projectMapCardPart(tui, path, theme, session, collapseKey);
			mounted.set(key, { part, tui });
			return part;
		}, { placement: "belowEditor" });
	};

	pi.registerCommand(PROJECT_MAP_COMMAND_NAME, {
		description: "Generate, declare, inspect, approve, show, or hide the repository Project Map.",
		handler: async (args, ctx) => {
			const commandCtx = ctx as unknown as ProjectMapCommandContext;
			await runProjectMapCommand(args, commandCtx, { onShow: () => { record(commandCtx).visibility = true; mount(commandCtx); }, onHide: () => { record(commandCtx).visibility = false; unmount(commandCtx); } });
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
		const map = readProjectMapFile(artifactPath(commandCtx)).map;
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

	pi.on("session_start", (_event, ctx) => {
		mount(ctx as unknown as ProjectMapCommandContext);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const commandCtx = ctx as unknown as ProjectMapCommandContext;
		unmount(commandCtx);
		sessions.delete(sessionKey(commandCtx));
	});
}
