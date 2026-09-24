import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { approveProjectMap, writeProjectMapFile } from "../lib/shell-project-map-approval.ts";
import { generateProjectMapDraft } from "../lib/shell-project-map-draft.ts";
import {
	PROJECT_MAP_ARTIFACT_PATH,
	readProjectMapFile,
	type ProjectMapDiagnostic,
	type ProjectMapV1,
} from "../lib/shell-project-map-schema.ts";

// Project Map: the repository-owned definition of what the product is, kept below
// Status. This extension owns only the human entry point — generating a draft,
// reviewing it, and recording an approval. Rendering the map is a later unit, and
// approval is deliberately a declaration of plan authority: this command starts no
// writer, provisions no worktree, and authorizes no commit, push, or merge.

export const PROJECT_MAP_COMMAND_NAME = "gentle:project-map";
export const PROJECT_MAP_SUB_ACTIONS = ["draft", "approve", "status"] as const;
export type ProjectMapSubAction = (typeof PROJECT_MAP_SUB_ACTIONS)[number];

const USAGE = `Usage: /${PROJECT_MAP_COMMAND_NAME} <${PROJECT_MAP_SUB_ACTIONS.join("|")}> [actor]`;

export interface ProjectMapCommandContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: (message: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
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
}

export type ProjectMapSubActionParse = { ok: true; action: ProjectMapSubAction; argument: string } | { ok: false; message: string };

export function parseProjectMapSubAction(args: string): ProjectMapSubActionParse {
	const [head = "", ...rest] = args.trim().split(/\s+/);
	if (head.length === 0) return { ok: false, message: `A sub-action is required. ${USAGE}` };
	if (!PROJECT_MAP_SUB_ACTIONS.includes(head as ProjectMapSubAction)) {
		return { ok: false, message: `Unknown sub-action "${head}". ${USAGE}` };
	}
	return { ok: true, action: head as ProjectMapSubAction, argument: rest.join(" ").trim() };
}

function refusal(message: string, path = "$"): ProjectMapDiagnostic {
	return { code: "project-map/invalid-field", path, message, severity: "error" };
}

function emptyReport(action: ProjectMapSubAction | null, diagnostics: ProjectMapDiagnostic[] = []): ProjectMapCommandReport {
	return { action, wrote: false, map: null, assumptions: [], omissions: [], diagnostics };
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function readRepositorySources(cwd: string): { packageJson?: unknown; openspecConfig?: string; oddTaskDocuments?: { path: string; text: string }[] } {
	const sources: { packageJson?: unknown; openspecConfig?: string; oddTaskDocuments?: { path: string; text: string }[] } = {};
	const manifestText = readText(join(cwd, "package.json"));
	if (manifestText !== undefined) {
		try {
			sources.packageJson = JSON.parse(manifestText);
		} catch {
			// A manifest that is not JSON is left absent, and the generator reports the omission.
		}
	}
	const config = readText(join(cwd, "openspec", "config.yaml"));
	if (config !== undefined) sources.openspecConfig = config;
	const tasksRoot = join(cwd, "odd", "tasks");
	if (existsSync(tasksRoot)) {
		const documents: { path: string; text: string }[] = [];
		for (const name of readdirSync(tasksRoot).sort()) {
			if (!name.endsWith(".md")) continue;
			const text = readText(join(tasksRoot, name));
			if (text !== undefined) documents.push({ path: `odd/tasks/${name}`, text });
		}
		sources.oddTaskDocuments = documents;
	}
	return sources;
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
		const generated = generateProjectMapDraft(readRepositorySources(ctx.cwd));
		if (generated.map === null) {
			ctx.ui.notify(`A draft could not be generated.\n${generated.omissions.join("\n")}`);
			return { action: "draft", wrote: false, map: null, assumptions: generated.assumptions, omissions: generated.omissions, diagnostics: [refusal("The draft could not be generated.")] };
		}
		const summary = [describe(generated.map), "", "Assumptions:", ...generated.assumptions.map((entry) => `- ${entry}`), "", "Omissions:", ...generated.omissions.map((entry) => `- ${entry}`)].join("\n");
		ctx.ui.notify(summary);
		const confirmed = ctx.hasUI ? await ctx.ui.confirm("Write the Project Map draft?", `Write a draft map to ${PROJECT_MAP_ARTIFACT_PATH}? It stays a draft until you approve it.`) : false;
		if (!confirmed) {
			ctx.ui.notify("Draft discarded; nothing was written.");
			return { action: "draft", wrote: false, map: generated.map, assumptions: generated.assumptions, omissions: generated.omissions, diagnostics: [] };
		}
		const written = writeProjectMapFile(artifactPath, generated.map);
		if (!written.ok) {
			ctx.ui.notify(`The draft could not be written.\n${written.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
			return { action: "draft", wrote: false, map: generated.map, assumptions: generated.assumptions, omissions: generated.omissions, diagnostics: written.diagnostics };
		}
		ctx.ui.notify(`Wrote a draft map to ${PROJECT_MAP_ARTIFACT_PATH}.`);
		return { action: "draft", wrote: true, map: generated.map, assumptions: generated.assumptions, omissions: generated.omissions, diagnostics: [] };
	}

	const actor = parsed.argument;
	if (actor.length === 0) {
		ctx.ui.notify(`Approval requires an actor identity, because an approval nobody can attribute is not auditable.\n${USAGE}`);
		return emptyReport("approve", [refusal("Approval requires an actor identity.", "$.approval.approvedBy")]);
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
	const written = writeProjectMapFile(artifactPath, transition.map);
	if (!written.ok) {
		ctx.ui.notify(`The approval could not be written.\n${written.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
		return { action: "approve", wrote: false, map: read.map, assumptions: [], omissions: [], diagnostics: written.diagnostics };
	}
	ctx.ui.notify(`Approved by ${actor} and written to ${PROJECT_MAP_ARTIFACT_PATH}.`);
	return { action: "approve", wrote: true, map: transition.map, assumptions: [], omissions: [], diagnostics: [] };
}

export default function gentleProjectMap(pi: ExtensionAPI): void {
	pi.registerCommand(PROJECT_MAP_COMMAND_NAME, {
		description: "Generate, inspect, or approve the repository Project Map.",
		handler: async (args, ctx) => {
			await runProjectMapCommand(args, ctx as unknown as ProjectMapCommandContext, {});
		},
	});
}
