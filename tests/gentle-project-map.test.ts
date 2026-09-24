import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import { sidebarPart, sidebarState } from "../lib/shell-sidebar.ts";
import { PROJECT_MAP_ARTIFACT_PATH, readProjectMapFile } from "../lib/shell-project-map-schema.ts";
import gentleProjectMap, {
	PROJECT_MAP_COMMAND_NAME,
	PROJECT_MAP_SUB_ACTIONS,
	parseProjectMapSubAction,
	runProjectMapCommand,
	type ProjectMapCommandContext,
} from "../extensions/gentle-project-map.ts";

const NOW = new Date("2026-09-23T12:00:00Z");

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
		writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), overrides.task ?? "- [ ] **PM-2 — Add draft generation and human plan approval**\n", "utf8");
	}
	return directory;
}

function artifactPath(directory: string): string {
	return join(directory, PROJECT_MAP_ARTIFACT_PATH);
}

/**
 * Stands in for the human correcting the draft: declaring which product surfaces each
 * capability touches. The generator never infers them, so an approved map is only
 * reachable after this edit.
 */
function declareEverySurface(directory: string): void {
	const path = artifactPath(directory);
	const map = JSON.parse(readFileSync(path, "utf8")) as { capabilities: { surfaces: string[] }[] };
	for (const capability of map.capabilities) capability.surfaces = ["web"];
	writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

function withRepository(run: (directory: string) => Promise<void> | void, overrides: Parameters<typeof repository>[0] = {}): Promise<void> {
	const directory = repository(overrides);
	return Promise.resolve(run(directory)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("parses a known sub-action and rejects everything else", () => {
	assert.deepEqual([...PROJECT_MAP_SUB_ACTIONS], ["draft", "approve", "status", "show", "hide"]);
	for (const action of PROJECT_MAP_SUB_ACTIONS) {
		const parsed = parseProjectMapSubAction(action);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.action, action);
		assert.equal(parsed.argument, "");
	}
	const withArgument = parseProjectMapSubAction("approve facundo");
	assert.equal(withArgument.ok, true);
	assert.equal(withArgument.action, "approve");
	assert.equal(withArgument.argument, "facundo");
	const unknown = parseProjectMapSubAction("publish");
	assert.equal(unknown.ok, false);
	if (!unknown.ok) {
		for (const action of PROJECT_MAP_SUB_ACTIONS) assert.ok(unknown.message.includes(action), `expected the refusal to name ${action}`);
	}
	const empty = parseProjectMapSubAction("");
	assert.equal(empty.ok, false);
});

test("status reports a missing artifact and writes nothing", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory);
		const report = await runProjectMapCommand("status", probe.ctx, { now: () => NOW });
		assert.equal(report.action, "status");
		assert.equal(report.wrote, false);
		assert.equal(report.map, null);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "project-map/unreadable-artifact"));
		assert.deepEqual(readdirSync(directory).sort(), ["odd", "openspec", "package.json"]);
	});
});

test("status reports a draft without touching it", async () => {
	await withRepository(async (directory) => {
		const draft = harness(directory);
		await runProjectMapCommand("draft", draft.ctx, { now: () => NOW });
		const before = readFileSync(artifactPath(directory), "utf8");

		const probe = harness(directory);
		const report = await runProjectMapCommand("status", probe.ctx, { now: () => NOW });
		assert.equal(report.map?.approval.state, "draft");
		assert.equal(report.wrote, false);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
		assert.ok(probe.notified.some((message) => message.toLowerCase().includes("draft")));
	});
});

test("draft writes a draft only after the human confirms", async () => {
	await withRepository(async (directory) => {
		const declined = harness(directory, [false]);
		const refused = await runProjectMapCommand("draft", declined.ctx, { now: () => NOW });
		assert.equal(refused.wrote, false);
		assert.equal(declined.confirmations, 1);
		assert.equal(readProjectMapFile(artifactPath(directory)).map, null);

		const accepted = harness(directory, [true]);
		const written = await runProjectMapCommand("draft", accepted.ctx, { now: () => NOW });
		assert.equal(written.wrote, true);
		const read = readProjectMapFile(artifactPath(directory));
		assert.deepEqual(read.diagnostics, []);
		assert.equal(read.map?.approval.state, "draft");
		assert.equal(read.map?.project.id, "example-shop");
		assert.ok((read.map?.capabilities.length ?? 0) > 0);
	});
});

test("draft reports the assumptions and omissions it could not resolve", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		assert.ok(report.assumptions.length > 0);
		assert.ok(report.omissions.length > 0);
		assert.ok(probe.notified.some((message) => message.toLowerCase().includes("omission")));
	}, { config: null, task: null });
});

test("approve refuses without an actor and writes nothing", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		const before = readFileSync(artifactPath(directory), "utf8");

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("approve", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.path === "$.approval.approvedBy"));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("approve records the actor and the injected timestamp", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		declareEverySurface(directory);

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("approve facundo", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, true);
		assert.deepEqual(report.map?.approval, { state: "approved", approvedAt: NOW.toISOString(), approvedBy: "facundo" });
		const read = readProjectMapFile(artifactPath(directory));
		assert.deepEqual(read.diagnostics, []);
		assert.equal(read.map?.approval.approvedBy, "facundo");
	});
});

test("refuses to approve a machine-generated draft until the human declares surfaces", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		const generated = await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		assert.equal(generated.wrote, true);
		assert.ok(generated.map?.capabilities.every((capability) => capability.surfaces.length === 0));

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("approve facundo", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		// The refusal happens before the confirmation, because asking to confirm something
		// that cannot succeed wastes the human's attention.
		assert.equal(probe.confirmations, 0);
		assert.ok(report.diagnostics.length > 0);
		assert.ok(probe.notified.some((message) => message.includes("$.capabilities[0].surfaces")));

		declareEverySurface(directory);
		const accepted = harness(directory, [true]);
		assert.equal((await runProjectMapCommand("approve facundo", accepted.ctx, { now: () => NOW })).wrote, true);
	});
});

test("approve writes nothing when the human declines", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		declareEverySurface(directory);
		const before = readFileSync(artifactPath(directory), "utf8");

		const probe = harness(directory, [false]);
		const report = await runProjectMapCommand("approve facundo", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 1);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("approve refuses an incomplete map and reports the exact path", async () => {
	await withRepository(async (directory) => {
		mkdirSync(join(directory, "openspec"), { recursive: true });
		writeFileSync(
			artifactPath(directory),
			JSON.stringify(
				{
					version: "gentle-shell.project-map/v1",
					project: { id: "example-shop", name: "example-shop" },
					approval: { state: "draft" },
					capabilities: [{ id: "shopping-cart", outcome: "Shoppers build a cart.", surfaces: [], state: "planned" }],
				},
				null,
				2,
			),
			"utf8",
		);
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("approve facundo", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.deepEqual(
			report.diagnostics.map((diagnostic) => diagnostic.path),
			["$.capabilities[0].surfaces"],
		);
	});
});

test("approve refuses an already approved map", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		declareEverySurface(directory);
		const first = harness(directory, [true]);
		assert.equal((await runProjectMapCommand("approve facundo", first.ctx, { now: () => NOW })).wrote, true);

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("approve someone-else", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.path === "$.approval.state"));
	});
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

test("only ever writes the artifact path", async () => {
	await withRepository(async (directory) => {
		const topLevelBefore = readdirSync(directory).sort();
		const openspecBefore = readdirSync(join(directory, "openspec")).sort();
		const manifestBefore = readFileSync(join(directory, "package.json"), "utf8");

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, true);

		// The artifact lives under openspec/, so the only observable change is there.
		assert.deepEqual(readdirSync(directory).sort(), topLevelBefore);
		assert.deepEqual(readdirSync(join(directory, "openspec")).sort(), [...openspecBefore, "project-map.json"].sort());
		assert.equal(readFileSync(join(directory, "package.json"), "utf8"), manifestBefore);
	});
});

test("reports an unreadable source as unreadable rather than absent", async () => {
	await withRepository(async (directory) => {
		// A directory where the manifest is expected fails with EISDIR, not ENOENT, so the
		// source exists and cannot be read. Reporting that as "absent" would send the operator
		// looking for a missing file that is right there.
		rmSync(join(directory, "package.json"));
		mkdirSync(join(directory, "package.json"));

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(
			report.omissions.some((omission) => omission.includes("package.json") && omission.includes("could not be read")),
			`expected an unreadable omission, got ${JSON.stringify(report.omissions)}`,
		);
	});
});

test("reports an absent source as absent, not as unreadable", async () => {
	await withRepository(async (directory) => {
		rmSync(join(directory, "package.json"));
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		assert.ok(report.omissions.some((omission) => omission.includes("package.json") && omission.includes("absent")));
		assert.equal(report.omissions.some((omission) => omission.includes("could not be read")), false);
	});
});

test("refuses to approve when the artifact changed between the read and the confirmation", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		declareEverySurface(directory);
		const before = readFileSync(artifactPath(directory), "utf8");

		// The confirmation is where a second writer gets its window, so the race is simulated
		// exactly there instead of by racing threads.
		const probe = harness(directory);
		probe.ctx.ui.confirm = async () => {
			writeFileSync(artifactPath(directory), `${before}\n`, "utf8");
			return true;
		};
		const report = await runProjectMapCommand("approve facundo", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.message.includes("changed")));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), `${before}\n`);
	});
});

test("refuses to write a draft when the artifact appeared while the human decided", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory);
		probe.ctx.ui.confirm = async () => {
			writeFileSync(artifactPath(directory), "someone else got here first\n", "utf8");
			return true;
		};
		const report = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.message.includes("changed")));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), "someone else got here first\n");
	});
});

test("refuses to write over an artifact it cannot read", async () => {
	await withRepository(async (directory) => {
		// A directory where the artifact is expected is unreadable, not absent. Conflating the
		// two would make the staleness guard see null before and null after, and wave the write
		// through over a file it never inspected.
		mkdirSync(artifactPath(directory));
		for (const args of ["draft", "approve facundo"]) {
			const probe = harness(directory, [true]);
			const report = await runProjectMapCommand(args, probe.ctx, { now: () => NOW });
			assert.equal(report.wrote, false, `expected ${args} to refuse`);
			assert.ok(
				report.diagnostics.some((diagnostic) => diagnostic.message.includes("could not be read")),
				`expected ${args} to report the unreadable artifact`,
			);
			assert.equal(statSync(artifactPath(directory)).isDirectory(), true);
		}
	});
});

type LifecycleHandler = (event: unknown, ctx: unknown) => unknown;

function projectMapExtension() {
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<unknown> }>();
	const handlers = new Map<string, LifecycleHandler[]>();
	const pi = {
		registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<unknown> }) {
			commands.set(name, command);
		},
		on(name: string, handler: LifecycleHandler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
	} as Parameters<typeof gentleProjectMap>[0];
	const fire = async (name: string, ctx: unknown) => {
		for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
	};
	gentleProjectMap(pi);
	return { commands, fire };
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

function writeReadyArtifact(directory: string): void {
	mkdirSync(join(directory, "openspec"), { recursive: true });
	writeFileSync(artifactPath(directory), JSON.stringify({
		version: "gentle-shell.project-map/v1",
		project: { id: "example-shop", name: "Example Shop" },
		approval: { state: "draft" },
		foundations: [],
		capabilities: [],
	}), "utf8");
}

test("show and hide mount only for this session and do not write the artifact", async () => {
	await withRepository(async (directory) => {
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "show-hide");
		const command = extension.commands.get(PROJECT_MAP_COMMAND_NAME)!;
		const before = readdirSync(directory).sort();
		await extension.fire("session_start", probe.ctx);
		assert.equal(probe.widgets.has("gentle-project-map"), false, "a missing map stays hidden by default");

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

test("effective visibility follows the artifact until an explicit session choice", async () => {
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
			assert.equal(invalid.widgets.has("gentle-project-map"), false, "an invalid map stays hidden by default");
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
		assert.equal(resumed.widgets.has("gentle-project-map"), false, "the missing artifact is not shown after the choice is dropped");
	});
});
