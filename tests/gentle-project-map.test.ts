import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test, { mock } from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import { sidebarHeaderContributors, sidebarPart, sidebarState } from "../lib/shell-sidebar.ts";
import { PROJECT_MAP_RAIL_KEY } from "../lib/shell-project-map-card.ts";
import { PROJECT_MAP_STATE_GLYPH } from "../lib/shell-project-map-view.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import { acquireProjectMapClaim } from "../lib/project-map-store-claims.ts";
import { beatProjectMapStoreHeartbeat, bindProjectMapStoreSession } from "../lib/project-map-store-heartbeats.ts";
import { resolveProjectMapStoreRoot } from "../lib/project-map-store-root.ts";
import { bindProjectMapStoreWorktree } from "../lib/project-map-store-worktrees.ts";
import { PROJECT_MAP_ARTIFACT_PATH, readProjectMapFile } from "../lib/shell-project-map-schema.ts";
import { generateProjectMapDraft } from "../lib/shell-project-map-draft.ts";
import { hashProjectMapDescription } from "../lib/project-map-translations.ts";
import { PROJECT_MAP_EXECUTABLE_ENV } from "../lib/shell-project-map-gate.ts";
import gentleProjectMap, {
	PROJECT_MAP_COLLAPSE_KEY_DEFAULT,
	PROJECT_MAP_NEXT_KEY_DEFAULT,
	PROJECT_MAP_PREV_KEY_DEFAULT,
	PROJECT_MAP_COMMAND_NAME,
	PROJECT_MAP_SUB_ACTIONS,
	parseProjectMapCollapseKey,
	parseProjectMapNextKey,
	parseProjectMapPrevKey,
	parseProjectMapSubAction,
	explainProjectMapCapability,
	parseProjectMapHelpKey,
	PROJECT_MAP_HELP_KEY_DEFAULT,
	readRepositorySources,
	runProjectMapCommand,
	type ProjectMapCommandContext,
} from "../extensions/gentle-project-map.ts";

const NOW = new Date("2026-09-23T12:00:00Z");
const mutableFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");

interface Harness {
	ctx: ProjectMapCommandContext;
	notified: string[];
	confirmations: number;
}

function harness(cwd: string, answers: boolean[] = []): Harness {
	const notified: string[] = [];
	const state = { confirmations: 0 };
	const ctx: ProjectMapCommandContext = {
		cwd,
		hasUI: true,
		ui: {
			notify: (message: string) => {
				notified.push(message);
			},
			confirm: async () => {
				state.confirmations += 1;
				return answers.shift() ?? true;
			},
		},
	};
	return {
		ctx,
		notified,
		get confirmations() {
			return state.confirmations;
		},
	} as Harness;
}

function repository(overrides: { manifest?: unknown; config?: string | null; task?: string | null } = {}): string {
	const directory = mkdtempSync(join(tmpdir(), "project-map-command-"));
	writeFileSync(join(directory, "package.json"), JSON.stringify(overrides.manifest ?? { name: "example-shop", scripts: { test: "pnpm test" } }, null, 2), "utf8");
	if (overrides.config !== null) {
		mkdirSync(join(directory, "openspec"), { recursive: true });
		writeFileSync(join(directory, "openspec", "config.yaml"), overrides.config ?? 'schema: spec-driven\napply:\n  test_command: "pnpm test"\n', "utf8");
	}
	if (overrides.task !== null) {
		mkdirSync(join(directory, "odd", "tasks"), { recursive: true });
		writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), overrides.task ?? "- [ ] **FP-2 — Add draft generation and human plan approval**\n", "utf8");
	}
	return directory;
}

function artifactPath(directory: string): string {
	return join(directory, PROJECT_MAP_ARTIFACT_PATH);
}

function withRepository(run: (directory: string) => Promise<void> | void, overrides: Parameters<typeof repository>[0] = {}): Promise<void> {
	const directory = repository(overrides);
	return Promise.resolve(run(directory)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("parses a known sub-action and rejects everything else", () => {
	assert.deepEqual([...PROJECT_MAP_SUB_ACTIONS], ["show", "hide", "translate"]);
	for (const action of PROJECT_MAP_SUB_ACTIONS) {
		const parsed = parseProjectMapSubAction(action);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.action, action);
		assert.equal(parsed.argument, "");
	}
	const unknown = parseProjectMapSubAction("publish");
	assert.equal(unknown.ok, false);
	if (!unknown.ok) {
		for (const action of PROJECT_MAP_SUB_ACTIONS) assert.ok(unknown.message.includes(action), `expected the refusal to name ${action}`);
	}
	const empty = parseProjectMapSubAction("");
	assert.equal(empty.ok, true);
	assert.equal(empty.action, "show", "the bare command displays derived data without an artifact workflow");
});

test("the translate command lists what needs a pass, with the hash to copy and the shape", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const generated = generateProjectMapDraft(readRepositorySources(directory).sources);
		writeFileSync(artifactPath(directory), JSON.stringify(generated.map), "utf8");
		const id = generated.map?.capabilities[0]?.id;
		const report = await runProjectMapCommand("translate", probe.ctx, { now: () => NOW });
		assert.equal(report.action, "translate");
		assert.equal(report.wrote, false, "a translation pass reports work; it writes nothing");
		const message = probe.notified.join("\n");
		assert.ok(message.includes("openspec/project-map.es.json"));
		assert.ok(message.includes(id!), "the capability is listed");
		assert.ok(message.includes(hashProjectMapDescription(["The body line the document carries."])), "the hash the writer must copy is printed");
		assert.ok(message.includes("gentle-pi.project-map-translations/v1"), "and the exact shape to write");
	}, { task: "- [ ] **FP-2 — Add draft generation and human plan approval**\n  - The body line the document carries.\n" });
});

test("the translate command refuses when there is no map to translate", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("translate", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(probe.notified.join("\n").includes("nothing to translate"));
	}, { task: "- [ ] **FP-2 — Add draft generation and human plan approval**\n" });
});

test("an unknown sub-action lists the valid ones and writes nothing", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("publish", probe.ctx, { now: () => NOW });
		assert.equal(report.action, null);
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.ok(report.diagnostics.length > 0);
		for (const action of PROJECT_MAP_SUB_ACTIONS) {
			assert.ok(probe.notified.some((message) => message.includes(action)), `expected the usage to name ${action}`);
		}
	});
});

type LifecycleHandler = (event: unknown, ctx: unknown) => unknown;

// PM9-1: the fixture drives the command surface, so its environment carries the executable
// opt-in unless a case overrides it. The gate's own cases live at the end of this file.
function projectMapExtension(env: NodeJS.ProcessEnv = {}) {
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<unknown> }>();
	const shortcuts = new Map<string, { handler(ctx: unknown): Promise<unknown> }>();
	const handlers = new Map<string, LifecycleHandler[]>();
	const pi = {
		registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<unknown> }) {
			commands.set(name, command);
		},
		registerShortcut(key: string, shortcut: { handler(ctx: unknown): Promise<unknown> }) {
			shortcuts.set(key, shortcut);
		},
		on(name: string, handler: LifecycleHandler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
	} as Parameters<typeof gentleProjectMap>[0];
	const fire = async (name: string, ctx: unknown) => {
		for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
	};
	gentleProjectMap(pi, { [PROJECT_MAP_EXECUTABLE_ENV]: "1", ...env });
	return { commands, shortcuts, fire };
}

function widgetContext(cwd: string, id: string) {
	const widgets = new Map<string, ((tui: unknown, theme: unknown) => { dispose?(): void }) | undefined>();
	const calls: Array<[string, unknown, unknown]> = [];
	const notified: string[] = [];
	const ctx = {
		cwd,
		hasUI: true,
		sessionManager: { getSessionId: () => id },
		ui: {
			notify(message: string) { notified.push(message); },
			confirm: async () => true,
			setWidget(key: string, value: ((tui: unknown, theme: unknown) => { dispose?(): void }) | undefined, options?: unknown) {
				calls.push([key, value, options]);
				if (value === undefined) widgets.delete(key);
				else widgets.set(key, value);
			},
		},
	};
	return { ctx, widgets, calls, notified };
}

function writeDisplayDocuments(directory: string, text = "- [x] **FP-1 — Catalog**\n"): void {
	mkdirSync(join(directory, "odd", "tasks"), { recursive: true });
	writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), text, "utf8");
	writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "example-shop", scripts: { test: "pnpm test" } }), "utf8");
}

function writeReadyArtifact(directory: string): void {
	writeDisplayDocuments(directory);
	mkdirSync(join(directory, "openspec"), { recursive: true });
	writeFileSync(artifactPath(directory), JSON.stringify({
		version: "gentle-shell.project-map/v1",
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "draft" },
		foundations: [],
		capabilities: [],
	}), "utf8");
}

function writeGroupedReadyArtifact(directory: string): void {
	writeReadyArtifact(directory);
	writeFileSync(artifactPath(directory), JSON.stringify({
		version: "gentle-shell.project-map/v1",
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "draft" },
		foundations: [{ id: "tooling", outcome: "Tooling", state: "done", evidence: [] }],
		capabilities: [{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "done" }],
	}), "utf8");
}

test("resolves the Project Map collapse shortcut with default, override, and off", () => {
	assert.equal(PROJECT_MAP_COLLAPSE_KEY_DEFAULT, "alt+m");
	assert.equal(parseProjectMapCollapseKey({}), "alt+m");
	assert.equal(parseProjectMapCollapseKey({ GENTLE_PI_PROJECT_MAP_KEY: "ctrl+m" }), "ctrl+m");
	assert.equal(parseProjectMapCollapseKey({ GENTLE_PI_PROJECT_MAP_KEY: "" }), "alt+m");
	assert.equal(parseProjectMapCollapseKey({ GENTLE_PI_PROJECT_MAP_KEY: "off" }), undefined);
	assert.ok(projectMapExtension().shortcuts.has("alt+m"));
	assert.ok(projectMapExtension({ GENTLE_PI_PROJECT_MAP_KEY: "ctrl+m" }).shortcuts.has("ctrl+m"));
});

test("resolves Project Map selection shortcuts with defaults, overrides, and off", () => {
	assert.equal(PROJECT_MAP_NEXT_KEY_DEFAULT, "alt+j");
	assert.equal(PROJECT_MAP_PREV_KEY_DEFAULT, "alt+k");
	assert.equal(parseProjectMapNextKey({}), "alt+j");
	assert.equal(parseProjectMapPrevKey({}), "alt+k");
	assert.equal(parseProjectMapNextKey({ GENTLE_PI_PROJECT_MAP_NEXT_KEY: "ctrl+j" }), "ctrl+j");
	assert.equal(parseProjectMapPrevKey({ GENTLE_PI_PROJECT_MAP_PREV_KEY: "off" }), undefined);
	const extension = projectMapExtension();
	assert.ok(extension.shortcuts.has("alt+j"));
	assert.ok(extension.shortcuts.has("alt+k"));
});

test("resolves the explain shortcut with a default, an override, and off", () => {
	assert.equal(PROJECT_MAP_HELP_KEY_DEFAULT, "alt+e");
	assert.equal(parseProjectMapHelpKey({}), "alt+e");
	assert.equal(parseProjectMapHelpKey({ GENTLE_PI_PROJECT_MAP_HELP_KEY: "ctrl+e" }), "ctrl+e");
	assert.equal(parseProjectMapHelpKey({ GENTLE_PI_PROJECT_MAP_HELP_KEY: "" }), "alt+e", "an empty value keeps the default");
	assert.equal(parseProjectMapHelpKey({ GENTLE_PI_PROJECT_MAP_HELP_KEY: "off" }), undefined);
	assert.ok(projectMapExtension().shortcuts.has("alt+e"));
	assert.ok(!projectMapExtension({ GENTLE_PI_PROJECT_MAP_HELP_KEY: "off" }).shortcuts.has("alt+e"));
});

/**
 * The tabs contribution reads the real coordination store, so its tests need a
 * repository Git can identify — `repository()` alone is not one — plus an
 * initialized store, exactly as the Open Pi fixture builds.
 */
function withGitRepository(run: (directory: string, store: string, agentHome: string) => Promise<void> | void): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "project-map-tabs-"));
	const empty = mkdtempSync(join(tmpdir(), "project-map-tabs-git-"));
	const agentHome = mkdtempSync(join(tmpdir(), "project-map-tabs-home-"));
	const env = { ...process.env, GIT_CONFIG_GLOBAL: join(empty, "config"), GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };
	writeFileSync(join(empty, "config"), "", "utf8");
	execFileSync("git", ["init", "--initial-branch=main", directory], { env, stdio: "ignore" });
	execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Fixture"], { env, stdio: "ignore" });
	const resolved = resolveProjectMapStoreRoot(directory);
	assert.ok(resolved.root && resolved.repositoryId, resolved.diagnostics.map((entry) => entry.message).join("\n"));
	mkdirSync(resolved.root, { recursive: true, mode: 0o700 });
	// A live instant: the snapshot compares the claim's lease against its own clock,
	// so a fixed past instant would make every session look stale by construction.
	assert.ok(initializeProjectMapStore({ root: resolved.root, repositoryId: resolved.repositoryId, epoch: "123e4567-e89b-12d3-a456-426614174000", now: new Date().toISOString() }).descriptor);
	return Promise.resolve(run(directory, resolved.root, agentHome)).finally(() => {
		rmSync(directory, { recursive: true, force: true });
		rmSync(empty, { recursive: true, force: true });
		rmSync(agentHome, { recursive: true, force: true });
	});
}

async function mountTabsCard(directory: string, agentHome: string, sessionId: string) {
	const extension = projectMapExtension({ GENTLE_PI_AGENT_HOME: agentHome });
	const probe = widgetContext(directory, sessionId);
	await extension.fire("session_start", probe.ctx);
	const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
	probe.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
	return { extension, probe, tui };
}

test("mounting the card contributes one header row group that reads the real coordination store", async () => {
	await withGitRepository(async (directory, store, agentHome) => {
		writeGroupedReadyArtifact(directory);
		const now = new Date().toISOString();
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "session-tabs", now }).claim);
		assert.ok(bindProjectMapStoreSession({ root: store, sessionId: "session-tabs", workspaceRoot: directory, pid: 1, incarnation: "123e4567-e89b-12d3-a456-426614174001", now }).binding);
		assert.ok(beatProjectMapStoreHeartbeat({ root: store, sessionId: "session-tabs", pid: 1, incarnation: "123e4567-e89b-12d3-a456-426614174001", now }).heartbeat);
		assert.ok(bindProjectMapStoreWorktree({ root: store, capabilityId: "catalog", branch: "feat/catalog", worktreeRoot: "/projects/shop-worktrees/catalog", sessionId: "session-tabs", baseCommit: "0".repeat(40), now }).binding);
		// The temp agent home has no presence data, so presence reports itself
		// unavailable and liveness falls back to the store's own lease status.
		const { tui } = await mountTabsCard(directory, agentHome, "tabs");
		const contributors = sidebarHeaderContributors(tui);
		assert.equal(contributors.length, 1, "the card contributes exactly one header row group");
		const row = contributors[0]!.render(140).join("\n");
		assert.match(row, /Web · catalog/, "the row groups the live session under the surface the map declares");
		assert.equal(typeof contributors[0]!.digest, "function", "the header memo needs a digest from the contribution");
	});
});

test("the contribution paints nothing when no session holds a capability the map declares", async () => {
	await withGitRepository(async (directory, _store, agentHome) => {
		writeGroupedReadyArtifact(directory);
		const { tui } = await mountTabsCard(directory, agentHome, "tabs-empty");
		const contributors = sidebarHeaderContributors(tui);
		assert.equal(contributors.length, 1, "the contribution is registered even when it paints nothing");
		assert.deepEqual(contributors[0]!.render(140), [], "an empty store adds no header row");
	});
});

test("selecting a tab paints its read-only detail in the card's rail", async () => {
	await withGitRepository(async (directory, store, agentHome) => {
		writeGroupedReadyArtifact(directory);
		const now = new Date().toISOString();
		assert.ok(acquireProjectMapClaim({ root: store, capabilityId: "catalog", sessionId: "session-detail", now }).claim);
		assert.ok(bindProjectMapStoreSession({ root: store, sessionId: "session-detail", workspaceRoot: directory, pid: 1, incarnation: "123e4567-e89b-12d3-a456-426614174001", now }).binding);
		assert.ok(beatProjectMapStoreHeartbeat({ root: store, sessionId: "session-detail", pid: 1, incarnation: "123e4567-e89b-12d3-a456-426614174001", now }).heartbeat);
		assert.ok(bindProjectMapStoreWorktree({ root: store, capabilityId: "catalog", branch: "feat/catalog", worktreeRoot: "/projects/shop-worktrees/catalog", sessionId: "session-detail", baseCommit: "0".repeat(40), now }).binding);
		const { tui } = await mountTabsCard(directory, agentHome, "tabs-detail");
		const rail = () => sidebarState(tui).parts.get("project-map")!;
		const before = rail().render(46).join("\n");
		assert.doesNotMatch(before, /branch feat\/catalog/, "no detail is painted before anything is selected");

		const contributor = sidebarHeaderContributors(tui)[0]!;
		const row = contributor.render(140)[0]!;
		const at = row.indexOf("catalog");
		assert.ok(at >= 0, "the row names the capability before it can be selected");
		assert.equal(contributor.handleMouse?.({ type: "click", button: "left", x: at + 1, y: 0, screenX: at + 1, screenY: 0, width: 140, height: 1, shift: false, alt: false, ctrl: false })?.handled, true);

		const after = rail().render(46).join("\n");
		assert.match(after, /▸ catalog/, "the selected capability is named");
		assert.match(after, /session-detail/);
		assert.match(after, /branch feat\/catalog/);
		assert.match(after, /worktree \/projects\/shop-worktrees\/catalog/);
		assert.ok(after.length > before.length, "the detail is stacked below the card, not instead of it");
	});
});

test("unmounting the card releases the header contribution", async () => {
	await withGitRepository(async (directory, _store, agentHome) => {
		writeGroupedReadyArtifact(directory);
		const { extension, probe, tui } = await mountTabsCard(directory, agentHome, "tabs-unmount");
		assert.equal(sidebarHeaderContributors(tui).length, 1);
		await extension.commands.get(PROJECT_MAP_COMMAND_NAME)!.handler("hide", probe.ctx);
		assert.deepEqual(sidebarHeaderContributors(tui), [], "hiding the card takes its header row with it");
	});
});

test("the collapse shortcut toggles all groups only while the card is mounted", async () => {
	await withRepository(async (directory) => {
		writeGroupedReadyArtifact(directory);
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "shortcut");
		await extension.fire("session_start", probe.ctx);
		const factory = probe.widgets.get("gentle-project-map")!;
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		factory(tui, { fg: (_color: string, text: string) => text });
		const rail = () => sidebarState(tui).parts.get("project-map")!;
		assert.match(rail().render(80).join("\n"), /▾ Foundations 1\/1/);
		assert.match(rail().render(80).join("\n"), /▾ Product capabilities 1\/1/);
		await extension.shortcuts.get("alt+m")!.handler(probe.ctx);
		assert.match(rail().render(80).join("\n"), /▸ Foundations 1\/1/);
		assert.match(rail().render(80).join("\n"), /▸ Product capabilities 1\/1/);
		await extension.shortcuts.get("alt+m")!.handler(probe.ctx);
		assert.match(rail().render(80).join("\n"), /▾ Foundations 1\/1/);
		assert.match(rail().render(80).join("\n"), /▾ Product capabilities 1\/1/);
		await extension.commands.get(PROJECT_MAP_COMMAND_NAME)!.handler("hide", probe.ctx);
		await extension.shortcuts.get("alt+m")!.handler(probe.ctx);
		assert.ok(probe.notified.some((message) => message.includes("hidden")));
	});
});

test("the card part receives a session toggle that changes only the clicked group", async () => {
	await withRepository(async (directory) => {
		writeReadyArtifact(directory);
		writeFileSync(artifactPath(directory), JSON.stringify({
			version: "gentle-shell.project-map/v1",
			project: { id: "example-shop", name: "Example Shop" },
			approval: { state: "draft" },
			foundations: [{ id: "tooling", outcome: "Tooling", state: "done", evidence: [] }],
			capabilities: [{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "done" }],
		}), "utf8");
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "part-toggle");
		await extension.fire("session_start", probe.ctx);
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		probe.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		const rail = sidebarState(tui).parts.get("project-map")!;
		const lines = rail.render(80);
		const header = lines.findIndex((line) => line.includes("Foundations"));
		rail.handleMouse?.({ type: "click", button: "left", x: 2, y: header, screenX: 2, screenY: header, width: 80, height: lines.length, shift: false, alt: false, ctrl: false });
		const body = rail.render(80).join("\n");
		assert.match(body, /▸ Foundations 1\/1/);
		assert.equal(body.includes("✓ repository-tooling"), false);
		assert.match(body, /▾ Product capabilities 1\/1/);
		assert.ok(body.includes("✓ FP-1 — Catalog"));
	});
});

test("selection shortcuts clamp, expand capabilities, and reset at session shutdown", async () => {
	await withRepository(async (directory) => {
		writeGroupedReadyArtifact(directory);
		const artifact = JSON.parse(readFileSync(artifactPath(directory), "utf8"));
		artifact.capabilities = [
			{ id: "alpha", outcome: "Alpha", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "done" },
			{ id: "beta", outcome: "Beta", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "planned" },
		];
		writeFileSync(artifactPath(directory), JSON.stringify(artifact), "utf8");
		writeDisplayDocuments(directory, "- [x] **FP-1 — Alpha**\n- [ ] **FP-2 — Beta**\n");
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "selection");
		await extension.fire("session_start", probe.ctx);
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		probe.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		const body = () => sidebarState(tui).parts.get("project-map")!.render(80).join("\n");
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ✓ FP-1 — Alpha/);
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ○ FP-2 — Beta/);
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ○ FP-2 — Beta/, "next clamps at the end");
		await extension.shortcuts.get("alt+k")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ✓ FP-1 — Alpha/);
		await extension.shortcuts.get("alt+k")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ✓ FP-1 — Alpha/, "previous clamps at the start");
		await extension.shortcuts.get("alt+m")!.handler(probe.ctx);
		assert.match(body(), /▸ Product capabilities/);
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▾ Product capabilities/, "moving selection expands the hidden group");
		await extension.fire("session_shutdown", probe.ctx);
		const resumed = widgetContext(directory, "selection");
		await extension.fire("session_start", resumed.ctx);
		resumed.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		assert.equal(sidebarState(tui).parts.get("project-map")!.render(80).join("\n").includes("▸ ? ✓"), false, "selection is session-scoped");
	});
});

test("collapse survives a widget remount but is dropped at session shutdown without disk writes", async () => {
	await withRepository(async (directory) => {
		writeReadyArtifact(directory);
		const extension = projectMapExtension();
		const first = widgetContext(directory, "same-collapse");
		const before = readFileSync(artifactPath(directory), "utf8");
		await extension.fire("session_start", first.ctx);
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		first.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		await extension.shortcuts.get("alt+m")!.handler(first.ctx);
		assert.match(sidebarState(tui).parts.get("project-map")!.render(80).join("\n"), /▸ Product capabilities/);
		first.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		assert.match(sidebarState(tui).parts.get("project-map")!.render(80).join("\n"), /▸ Product capabilities/);
		await extension.fire("session_shutdown", first.ctx);
		const resumed = widgetContext(directory, "same-collapse");
		await extension.fire("session_start", resumed.ctx);
		resumed.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		assert.match(sidebarState(tui).parts.get("project-map")!.render(80).join("\n"), /▾ Product capabilities/);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("the Project Map card renders by default with the executable gate unset", async () => {
	await withRepository(async (directory) => {
		writeDisplayDocuments(directory);
		const extension = projectMapExtension({ [PROJECT_MAP_EXECUTABLE_ENV]: undefined });
		const probe = widgetContext(directory, "gate-unset-visible");
		await extension.fire("session_start", probe.ctx);
		const factory = probe.widgets.get("gentle-project-map");
		assert.ok(factory, "the card mounts by default with the executable gate unset");
		assert.deepEqual(probe.calls.at(-1)?.[2], { placement: "belowEditor" });
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		factory(tui, { fg: (_color: string, text: string) => text });
		const card = sidebarState(tui).parts.get(PROJECT_MAP_RAIL_KEY);
		assert.ok(card, "the visible card registers its rail part");
		assert.match(card.render(80).join("\n"), /FP-1 — Catalog/, "the default card renders the project's functional points");
		await extension.fire("session_shutdown", probe.ctx);
	});
});

test("hiding the Project Map card stops rendering for the session with the executable gate unset", async () => {
	await withRepository(async (directory) => {
		writeDisplayDocuments(directory);
		const extension = projectMapExtension({ [PROJECT_MAP_EXECUTABLE_ENV]: undefined });
		const probe = widgetContext(directory, "gate-unset-hidden");
		await extension.fire("session_start", probe.ctx);
		const factory = probe.widgets.get("gentle-project-map");
		assert.ok(factory, "the card mounts before the session hides it with the gate unset");
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		factory(tui, { fg: (_color: string, text: string) => text });
		assert.match(sidebarState(tui).parts.get(PROJECT_MAP_RAIL_KEY)!.render(80).join("\n"), /FP-1 — Catalog/);

		await extension.commands.get(PROJECT_MAP_COMMAND_NAME)!.handler("hide", probe.ctx);
		assert.equal(probe.widgets.has("gentle-project-map"), false, "hide clears the widget with the gate unset");
		assert.equal(sidebarState(tui).parts.has(PROJECT_MAP_RAIL_KEY), false, "hide removes the rendering rail part");
		assert.equal(probe.calls.at(-1)?.[1], undefined);
		await extension.fire("session_start", probe.ctx);
		assert.equal(probe.widgets.has("gentle-project-map"), false, "the explicit hide choice survives a mount attempt in the same session");
		await extension.fire("session_shutdown", probe.ctx);
	});
});

test("show and hide mount only for this session and do not write the artifact", async () => {
	await withRepository(async (directory) => {
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "show-hide");
		const command = extension.commands.get(PROJECT_MAP_COMMAND_NAME)!;
		const before = readdirSync(directory).sort();
		await extension.fire("session_start", probe.ctx);
		assert.equal(probe.widgets.has("gentle-project-map"), true, "the derived display mounts without an artifact");

		await command.handler("show", probe.ctx);
		assert.deepEqual(probe.calls.at(-1)?.[2], { placement: "belowEditor" });
		const factory = probe.widgets.get("gentle-project-map");
		assert.ok(factory, "show mounts the widget immediately");
		const tui = { terminal: {} } as unknown as TUI;
		sidebarPart(tui, "todo", { render: () => [], invalidate() {} });
		factory!(tui, { fg: (_color: string, text: string) => text });
		assert.equal(sidebarState(tui).parts.has("project-map"), true);
		await command.handler("hide", probe.ctx);
		assert.equal(probe.widgets.has("gentle-project-map"), false, "hide clears the widget immediately");
		assert.equal(sidebarState(tui).parts.has("project-map"), false, "hide unregisters the Project Map rail part");
		assert.equal(sidebarState(tui).parts.has("todo"), true, "hide preserves sibling rail parts");
		assert.equal(probe.calls.at(-1)?.[1], undefined);
		assert.deepEqual(readdirSync(directory).sort(), before, "show and hide do not write to disk");
		assert.ok(probe.notified.some((message) => message.includes("shown")));
		assert.ok(probe.notified.some((message) => message.includes("hidden")));
	});
});

test("effective visibility is independent of the artifact until an explicit session choice", async () => {
	await withRepository(async (directory) => {
		const extension = projectMapExtension();
		const ready = widgetContext(directory, "ready");
		writeReadyArtifact(directory);
		await extension.fire("session_start", ready.ctx);
		assert.ok(ready.widgets.has("gentle-project-map"), "a ready map mounts by default");

		const invalidDirectory = repository();
		try {
			writeFileSync(artifactPath(invalidDirectory), "{", "utf8");
			const invalid = widgetContext(invalidDirectory, "invalid");
			await extension.fire("session_start", invalid.ctx);
			assert.equal(invalid.widgets.has("gentle-project-map"), true, "an invalid artifact cannot hide the derived display");
			await extension.commands.get(PROJECT_MAP_COMMAND_NAME)!.handler("show", invalid.ctx);
			assert.ok(invalid.widgets.has("gentle-project-map"), "show overrides invalid visibility for this session");
		} finally {
			rmSync(invalidDirectory, { recursive: true, force: true });
		}
	});
});

test("session shutdown drops an explicit visibility choice", async () => {
	await withRepository(async (directory) => {
		const extension = projectMapExtension();
		const first = widgetContext(directory, "same-session");
		await extension.commands.get(PROJECT_MAP_COMMAND_NAME)!.handler("show", first.ctx);
		const factory = first.widgets.get("gentle-project-map");
		assert.ok(factory);
		const tui = { terminal: {} } as unknown as TUI;
		sidebarPart(tui, "todo", { render: () => [], invalidate() {} });
		factory!(tui, { fg: (_color: string, text: string) => text });
		assert.equal(sidebarState(tui).parts.has("project-map"), true);
		await extension.fire("session_shutdown", first.ctx);
		assert.equal(sidebarState(tui).parts.has("project-map"), false, "shutdown unregisters the Project Map rail part");
		assert.equal(sidebarState(tui).parts.has("todo"), true, "shutdown preserves sibling rail parts");

		const resumed = widgetContext(directory, "same-session");
		await extension.fire("session_start", resumed.ctx);
		assert.equal(resumed.widgets.has("gentle-project-map"), true, "the derived display mounts after the visibility choice is dropped");
	});
});

test("the bare display derives FP rows without declarations, openspec, or writes", async () => {
	await withRepository(async (directory) => {
		const before = readdirSync(directory).sort();
		const probe = harness(directory);
		let shown = 0;
		const report = await runProjectMapCommand("", probe.ctx, { onShow: () => { shown += 1; } });
		assert.equal(report.action, "show");
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.equal(shown, 1);
		assert.equal(report.map?.project.name, "example-shop");
		assert.deepEqual(report.map?.capabilities.map((row) => row.outcome).sort(), ["FP-0 — Zero", "FP-1 — One", "FP-1-2 — Separate row", "FP-9 — Nine"].sort());
		assert.deepEqual(readdirSync(directory).sort(), before);
		assert.equal(readdirSync(directory).includes("openspec"), false);
		assert.equal(probe.notified.some((line) => /ensure|draft|declare|approve/.test(line)), false);
	}, { config: null, task: "- [x] **FP-0 — Zero**\n- [~] **FP-1 — One**\n- [ ] **FP-1-2 — Separate row**\n- [ ] **FP-9 — Nine**\n- [ ] **FP-1b — A continuation**\n- [ ] **FP-77b — An orphan**\n- [ ] **PM-2 — Not a row**\n" });
});

test("display maps document declarations without creating openspec", async () => {
	await withRepository(async (directory) => {
		const before = readdirSync(directory).sort();
		const report = await runProjectMapCommand("", harness(directory).ctx);
		assert.deepEqual(report.map?.capabilities[0]?.surfaces, ["web"]);
		assert.deepEqual(readdirSync(directory).sort(), before);
		assert.equal(readdirSync(directory).includes("openspec"), false);
	}, { config: null, task: "- [ ] **FP-1 — One**\n  **Allowed edit surfaces:** `web/one.ts`\n" });
});

test("display names unmappable declared paths", async () => {
	await withRepository(async (directory) => {
		const report = await runProjectMapCommand("", harness(directory).ctx);
		assert.deepEqual(report.map?.capabilities[0]?.surfaces, []);
		assert.match(report.omissions.join("\n"), /one.*odd\/tasks\/roadmap\.md.*src\/one\.ts/);
		assert.equal(readdirSync(directory).includes("openspec"), false);
	}, { config: null, task: "- [ ] **FP-1 — One**\n  **Allowed edit surfaces:** `src/one.ts`\n" });
});

test("distinct FP codes with the same title remain distinct, explainable rows", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory);
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.map?.capabilities.length, 2);
		assert.equal(new Set(report.map?.capabilities.map((row) => row.id)).size, 2);
		let body = "";
		probe.ctx.ui.custom = async (factory) => {
			body = factory({ terminal: { rows: 100 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {}).render(120).join("\n");
			return {} as never;
		};
		for (const row of report.map!.capabilities) {
			await explainProjectMapCapability(probe.ctx, row.id);
			assert.ok(body.includes(row.outcome));
			assert.ok(body.includes("Same body."));
		}
	}, { config: null, task: "- [x] **FP-1 — Same**\n  Same body.\n- [ ] **FP-2 — Same**\n  Same body.\n" });
});

test("display ignores conflicting map configuration, roadmap pointers, and artifact rows", async () => {
	await withRepository(async (directory) => {
		writeFileSync(join(directory, "openspec/config.yaml"), "project_map:\n  delegable: PM-\n  roadmap: docs/other.md\n  surfaces:\n    web: web/\n");
		mkdirSync(join(directory, "docs"));
		writeFileSync(join(directory, "docs/other.md"), "- [x] **FP-9 — Outside tasks**\n");
		writeFileSync(artifactPath(directory), JSON.stringify({ version: "gentle-shell.project-map/v1", project: { id: "other", name: "Other" }, capabilities: [{ id: "artifact-only", outcome: "Artifact only", state: "done", surfaces: ["web"] }] }));
		const before = readFileSync(artifactPath(directory), "utf8");
		const probe = harness(directory);
		const report = await runProjectMapCommand("", probe.ctx);
		assert.deepEqual(report.map?.capabilities.map((row) => row.outcome), ["FP-1 — One"]);
		assert.deepEqual(report.map?.capabilities[0]?.surfaces, ["web"]);
		assert.equal(report.map?.project.name, "example-shop");
		assert.equal(probe.confirmations, 0);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	}, { task: "- [ ] **FP-1 — One**\n  **Allowed edit surfaces:** `web/one.ts`\n" });
});

test("artifact-free sessions render derived data and preserve git status", async () => {
	await withGitRepository(async (directory, _store, agentHome) => {
		mkdirSync(join(directory, "odd", "tasks"), { recursive: true });
		writeFileSync(join(directory, "odd", "tasks", "points.md"), "- [x] **FP-1 — One**\n- [~] **FP-9 — Nine**\n");
		const before = execFileSync("git", ["-C", directory, "status", "--porcelain"], { encoding: "utf8" });
		const { tui } = await mountTabsCard(directory, agentHome, "derived");
		const body = sidebarState(tui).parts.get(PROJECT_MAP_RAIL_KEY)!.render(80).join("\n");
		assert.match(body, /✓ FP-1 — One/);
		assert.match(body, /◉ FP-9 — Nine/);
		assert.doesNotMatch(body, /ensure|draft|declare|approve|openspec/);
		assert.equal(execFileSync("git", ["-C", directory, "status", "--porcelain"], { encoding: "utf8" }), before);
		assert.equal(readdirSync(directory).includes("openspec"), false);
	});
});

test("document-only explanations deduce Unicode and dotted steps and honor declared parents", async () => {
	await withRepository(async (directory) => {
		writeFileSync(join(directory, "odd/tasks/cuts.md"), "- [~] **FP-1é — Accent**\n- [x] **FP-1𐐀 — Astral letter**\n- [ ] **FP-1.2 — Dot**\n- [ ] **FP-10a — Other row**\n- [ ] **FP-77b — Orphan**\n");
		writeFileSync(join(directory, "odd/tasks/override.md"), "**Belongs to:** `FP-9`\n- [x] **FP-1b — Reparented**\n- [ ] **CUT-1 — Other family**\n");
		const probe = harness(directory);
		let body = "";
		probe.ctx.ui.custom = async (factory) => {
			body = factory({ terminal: { rows: 100 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {}).render(120).join("\n");
			return {} as never;
		};
		await explainProjectMapCapability(probe.ctx, "one");
		assert.match(body, /FP-1é — Accent/);
		assert.match(body, /FP-1𐐀 — Astral letter/);
		assert.match(body, /FP-1\.2 — Dot/);
		assert.doesNotMatch(body, /Reparented|Other family|Orphan|Other row/);
		await explainProjectMapCapability(probe.ctx, "nine");
		assert.match(body, /FP-1b — Reparented/);
		assert.match(body, /CUT-1 — Other family/);
		assert.doesNotMatch(body, /Accent|Astral letter|Dot|Orphan/);
		assert.equal(readdirSync(directory).includes("openspec"), false);
	}, { config: null, task: "- [ ] **FP-1 — One**\n- [ ] **FP-9 — Nine**\n" });
});

test("a project without FP rows reports their absence instead of an empty map", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory);
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.map, null);
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.match(probe.notified.join("\n"), /No FP work units/);
		assert.match(probe.notified.join("\n"), /\*\*Work unit prefix:\*\*.*without it the map expects FP-/);
		const extension = projectMapExtension();
		const widget = widgetContext(directory, "no-fp");
		await extension.fire("session_start", widget.ctx);
		const tui = { terminal: {} } as unknown as TUI;
		widget.widgets.get("gentle-project-map")!(tui, { fg: (_role: string, text: string) => text });
		const body = sidebarState(tui).parts.get(PROJECT_MAP_RAIL_KEY)!.render(80).join("\n");
		assert.match(body, /No FP work units/);
		assert.match(body, /\*\*Work unit prefix:\*\*/);
		assert.match(body, /default: FP-/);
		assert.doesNotMatch(body, /Product capabilities 0\/0|generate|ensure|draft|approve/);
	}, { config: null, task: "- [ ] **FP-77b — Orphan**\n- [ ] **PM-2 — Not FP**\n" });
});

// PM9-1: the executable half sits behind an explicit opt-in. These cases pin the refusal,
// the routes it must never reach, and the offer it must withdraw.
const GATE_OFF: NodeJS.ProcessEnv = {};
const GATE_ON: NodeJS.ProcessEnv = { GENTLE_PI_PROJECT_MAP: "1" };

const GATED_COMMANDS: Array<[string, string]> = [
];

test("every route that acts outside the artifact is refused while the gate is off", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pm9-gate-"));
	try {
		for (const [command, action] of GATED_COMMANDS) {
			const h = harness(directory);
			const report = await runProjectMapCommand(command, h.ctx, { env: GATE_OFF });
			assert.equal(report.action, action, command);
			assert.equal(report.wrote, false, command);
			assert.equal(report.diagnostics[0]?.code, "project-map/executable-disabled", command);
			assert.match(report.diagnostics[0]!.message, /GENTLE_PI_PROJECT_MAP=1/, command);
			assert.equal(h.confirmations, 0, `${command} must not ask for a confirmation it cannot honor`);
		}
		assert.deepEqual(readdirSync(directory), [], "a refused route creates nothing, the artifact included");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("reads, releases and usage errors keep their own answer while the gate is off", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pm9-gate-read-"));
	try {
		const reachable = ["show", "hide"];
		for (const command of reachable) {
			const h = harness(directory);
			const report = await runProjectMapCommand(command, h.ctx, { env: GATE_OFF });
			assert.equal(report.diagnostics.some((entry) => entry.code === "project-map/executable-disabled"), false, `${command} must not be gated`);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

async function recordReads<T>(path: string, run: () => Promise<T>): Promise<{ result: T; reads: string[] }> {
	const original = mutableFs.readFileSync;
	const reads: string[] = [];
	const patched = mock.method(mutableFs, "readFileSync", ((...args: any[]) => {
		if (String(args[0]) === path) reads.push(path);
		return Reflect.apply(original, mutableFs, args);
	}) as never);
	syncBuiltinESMExports();
	try {
		return { result: await run(), reads };
	} finally {
		patched.mock.restore();
		syncBuiltinESMExports();
	}
}
