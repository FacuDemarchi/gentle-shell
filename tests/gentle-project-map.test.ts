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
import { issueProjectMapStoreReadinessReceipt, readProjectMapStoreReadinessReceipts } from "../lib/project-map-store-receipts.ts";
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
	projectMapOpenPiDecision,
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
		writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), overrides.task ?? "- [ ] **PM-2 — Add draft generation and human plan approval**\n", "utf8");
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
	assert.deepEqual([...PROJECT_MAP_SUB_ACTIONS], ["ensure", "draft", "declare", "approve", "status", "show", "hide", "lead", "contract", "worktree", "open", "integrate", "translate"]);
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
	const declaration = parseProjectMapSubAction("declare pm-2 web api");
	assert.equal(declaration.ok, true);
	assert.equal(declaration.action, "declare");
	assert.equal(declaration.argument, "pm-2 web api");
	const unknown = parseProjectMapSubAction("publish");
	assert.equal(unknown.ok, false);
	if (!unknown.ok) {
		for (const action of PROJECT_MAP_SUB_ACTIONS) assert.ok(unknown.message.includes(action), `expected the refusal to name ${action}`);
	}
	const empty = parseProjectMapSubAction("");
	assert.equal(empty.ok, true);
	assert.equal(empty.action, "ensure", "the bare command is the feature's own gesture, not a usage error");
});

test("explaining a capability opens the overlay with what its document says", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const opened: string[] = [];
		probe.ctx.ui.custom = async (factory) => {
			const component = factory({ terminal: { rows: 40 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			opened.push(...component.render(90));
			return {} as never;
		};
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities[0]?.id;
		assert.ok(id, "the fixture drafted a capability");
		await explainProjectMapCapability(probe.ctx, id);
		const body = opened.join("\n");
		assert.ok(body.includes(id), "the overlay names the capability");
		assert.ok(body.includes("The body line the document carries."), "the overlay shows the document's own words");
		assert.ok(body.includes("Lo que dice el documento:"), "and labels them as the document's, in Spanish");
	}, { task: "- [ ] **PM-2 — Add draft generation and human plan approval**\n  - The body line the document carries.\n" });
});

test("the explanation renders every lettered cut and dotted step inside its functional-point row", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const opened: string[] = [];
		probe.ctx.ui.custom = async (factory) => {
			const component = factory({ terminal: { rows: 100 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			opened.push(...component.render(120));
			return {} as never;
		};
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities.find((capability) => capability.outcome === "FP-1 — Provisioning")?.id;
		assert.equal(id, "provisioning");
		const steps = [
			["~", "FP-1a", "First cut"], ["x", "FP-1a.1", "First cut one"], [" ", "FP-1a.2", "First cut two"], ["x", "FP-1a.3", "First cut three"], [" ", "FP-1a.4", "First cut four"], ["~", "FP-1a.5", "First cut five"], ["x", "FP-1a.6", "First cut six"],
			[" ", "FP-1b", "Second cut"], ["x", "FP-1b.0", "Second cut zero"], ["~", "FP-1b.1a", "Second cut one-a"], [" ", "FP-1b.1", "Second cut one"], ["x", "FP-1b.2", "Second cut two"], [" ", "FP-1b.3", "Second cut three"], ["x", "FP-1b.3a", "Second cut three-a"], ["x", "FP-1b.3a-b", "Second cut three-a-b"], ["~", "FP-1b.3b", "Second cut three-b"], ["x", "FP-1b.4", "Second cut four"], [" ", "FP-1b.5", "Second cut five"], ["x", "FP-1b.6", "Second cut six"], ["~", "FP-1b.7", "Second cut seven"], ["x", "FP-1b.8", "Second cut eight"],
		] as const;
		writeFileSync(join(directory, "odd", "tasks", "provisioning-steps.md"), `${steps.map(([checkbox, code, title]) => `- [${checkbox}] **${code} — ${title}**`).join("\n")}\n`, "utf8");
		await explainProjectMapCapability(probe.ctx, id);
		const body = opened.join("\n");
		assert.ok(body.includes("Subelementos: 21"));
		for (const [checkbox, code, title] of steps) {
			const state = checkbox === "x" ? "done" : checkbox === "~" ? "active" : "planned";
			const indentation = "  ".repeat((code.match(/\./g) ?? []).length + 1);
			assert.ok(body.includes(`${indentation}· ${code} — ${title} · ${PROJECT_MAP_STATE_GLYPH[state]}`), code);
		}
		assert.ok(body.includes("The body line the document carries."), "the original description remains present");
	}, { task: "- [ ] **FP-1 — Provisioning**\n  The body line the document carries.\n" });
});

test("the explanation honors a document's declared parent for coded and uncoded sub-elements", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const opened: string[] = [];
		probe.ctx.ui.custom = async (factory) => {
			const component = factory({ terminal: { rows: 40 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			opened.push(...component.render(100));
			return {} as never;
		};
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  delegable: FP-\n", "utf8");
		writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), [
			"**Belongs to:** `FP-5`",
			"- [ ] **FP-5 — Five**",
		].join("\n"), "utf8");
		writeFileSync(join(directory, "odd", "tasks", "five-steps.md"), [
			"  * **Belongs to:** `FP-5`",
			"- [~] **F5b-1 — A different code family**",
			"  - [x] **A bare declared unit**",
			"- [ ] **FP-9 — A row is excluded**",
		].join("\n"), "utf8");
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities.find((capability) => capability.outcome === "FP-5 — Five")?.id;
		assert.equal(id, "five");
		await explainProjectMapCapability(probe.ctx, id);
		const body = opened.join("\n");
		assert.ok(body.includes("Subelementos: 2"));
		assert.ok(body.includes(`  · F5b-1 — A different code family · ${PROJECT_MAP_STATE_GLYPH.active}`));
		assert.ok(body.includes(`  · A bare declared unit · ${PROJECT_MAP_STATE_GLYPH.done}`));
		assert.equal(body.includes("A row is excluded"), false);
	});
});

test("the help overlay reserves the rail when the fullscreen sidebar owns it", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		type Options = { overlay?: boolean; overlayOptions?: { anchor?: string; width?: number | string; minWidth?: number; maxHeight?: number | string; margin?: number | { top?: number; right?: number; bottom?: number; left?: number } } };
		const opened: Options[] = [];
		probe.ctx.ui.custom = async (factory, options) => {
			opened.push(options ?? {});
			factory({ terminal: { rows: 40 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			return {} as never;
		};
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities[0]?.id;
		assert.ok(id, "the fixture drafted a capability");

		await explainProjectMapCapability(probe.ctx, id);
		assert.equal(opened[0]?.overlayOptions?.anchor, "center", "no rail: the shell's centered overlay");
		assert.equal(opened[0]?.overlayOptions?.width, "70%", "and the shell's own overlay width");

		await explainProjectMapCapability(probe.ctx, id, 50);
		assert.equal(opened[1]?.overlayOptions?.anchor, "left-center", "rail active: the overlay anchors left, never over the rail");
		assert.deepEqual(opened[1]?.overlayOptions?.margin, { left: 2, right: 52 }, "and reserves the rail's columns plus the frame gap");
	}, { task: "- [ ] **PM-2 — Add draft generation and human plan approval**\n" });
});

test("the explanation shows a current translation, and says why it is not translated otherwise", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const opened: string[] = [];
		probe.ctx.ui.custom = async (factory) => {
			const component = factory({ terminal: { rows: 40 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			opened.push(...component.render(90));
			return {} as never;
		};
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities[0]?.id;
		assert.ok(id, "the fixture drafted a capability");
		const target = join(directory, "openspec", "project-map.es.json");
		const write = (sourceHash: string, title = "Agregar generación de borrador y aprobación humana del plan") => writeFileSync(target, JSON.stringify({
			version: "gentle-pi.project-map-translations/v1",
			language: "es",
			capabilities: { [id]: { source: "odd/tasks/roadmap.md", sourceHash, title, lines: ["La línea de cuerpo que el documento trae."] } },
		}), "utf8");

		// No target yet: the document's own words, and the note says why.
		await explainProjectMapCapability(probe.ctx, id);
		const untranslated = opened.join("\n");
		assert.ok(untranslated.includes("The body line the document carries."));
		assert.ok(untranslated.includes("Traducción: no generada"), "an English paragraph in a Spanish frame is explained");

		// A current translation wins, title included, and the note disappears.
		opened.length = 0;
		write(hashProjectMapDescription(["The body line the document carries."]));
		await explainProjectMapCapability(probe.ctx, id);
		const translated = opened.join("\n");
		assert.ok(translated.includes("La línea de cuerpo que el documento trae."));
		assert.ok(translated.includes("Resultado: PM-2 — Agregar generación de borrador"), "the translated title preserves the functional-point prefix");
		assert.equal(translated.includes("Traducción:"), false, "and no note is shown");
		assert.equal(translated.includes("The body line the document carries."), false, "the original body is not shown next to it");

		// A translated title that already has the functional-point head must not receive it twice.
		opened.length = 0;
		write(hashProjectMapDescription(["The body line the document carries."]), "PM-2 — Agregar generación de borrador y aprobación humana del plan");
		await explainProjectMapCapability(probe.ctx, id);
		const alreadyPrefixed = opened.join("\n");
		assert.equal((alreadyPrefixed.match(/Resultado: PM-2 — Agregar generación de borrador/g) ?? []).length, 1);
		assert.equal(alreadyPrefixed.includes("PM-2 — PM-2 —"), false);

		// A body that moved invalidates its translation instead of showing a stale one.
		opened.length = 0;
		write(hashProjectMapDescription(["A different body."]));
		await explainProjectMapCapability(probe.ctx, id);
		const stale = opened.join("\n");
		assert.ok(stale.includes("Traducción: desactualizada"), "staleness is named");
		assert.ok(stale.includes("The body line the document carries."), "and the current words are shown");
	}, { task: "- [ ] **PM-2 — Add draft generation and human plan approval**\n  - The body line the document carries.\n" });
});

test("the explanation preserves an unspaced functional-point prefix in a translated title", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const opened: string[] = [];
		probe.ctx.ui.custom = async (factory) => {
			const component = factory({ terminal: { rows: 40 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			opened.push(...component.render(90));
			return {} as never;
		};
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities[0]?.id;
		assert.equal(id, "provisioning");
		writeFileSync(join(directory, "openspec", "project-map.es.json"), JSON.stringify({
			version: "gentle-pi.project-map-translations/v1",
			language: "es",
			capabilities: { [id]: { source: "odd/tasks/roadmap.md", sourceHash: hashProjectMapDescription(["The body line the document carries."]), title: "Traducido", lines: ["La línea de cuerpo que el documento trae."] } },
		}), "utf8");
		await explainProjectMapCapability(probe.ctx, id);
		assert.ok(opened.join("\n").includes("Resultado: FP-1—Traducido"));
	}, { task: "- [ ] **FP-1—Provisioning**\n  - The body line the document carries.\n" });
});

test("does not double a stored title that already carries the code with other spacing", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const opened: string[] = [];
		probe.ctx.ui.custom = async (factory) => {
			const component = factory({ terminal: { rows: 40 } } as unknown as TUI, { fg: (_role: string, text: string) => text }, {}, () => {});
			opened.push(...component.render(90));
			return {} as never;
		};
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities[0]?.id;
		assert.equal(id, "provisioning");
		// The label separates with no spaces while the stored title separates with them, so the
		// exact head does not match and only the code decides that it is already there.
		writeFileSync(join(directory, "openspec", "project-map.es.json"), JSON.stringify({
			version: "gentle-pi.project-map-translations/v1",
			language: "es",
			capabilities: { [id]: { source: "odd/tasks/roadmap.md", sourceHash: hashProjectMapDescription(["The body line the document carries."]), title: "FP-1 — Traducido", lines: ["La línea de cuerpo que el documento trae."] } },
		}), "utf8");
		await explainProjectMapCapability(probe.ctx, id);
		const rendered = opened.join("\n");
		assert.ok(rendered.includes("Resultado: FP-1 — Traducido"), "the translated title keeps its own spacing");
		assert.equal(rendered.includes("FP-1—FP-1"), false, "the code is not written twice");
	}, { task: "- [ ] **FP-1—Provisioning**\n  - The body line the document carries.\n" });
});

test("the translate command lists what needs a pass, with the hash to copy and the shape", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const drafted = await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		const id = drafted.map?.capabilities[0]?.id;
		const report = await runProjectMapCommand("translate", probe.ctx, { now: () => NOW });
		assert.equal(report.action, "translate");
		assert.equal(report.wrote, false, "a translation pass reports work; it writes nothing");
		const message = probe.notified.join("\n");
		assert.ok(message.includes("openspec/project-map.es.json"));
		assert.ok(message.includes(id!), "the capability is listed");
		assert.ok(message.includes(hashProjectMapDescription(["The body line the document carries."])), "the hash the writer must copy is printed");
		assert.ok(message.includes("gentle-pi.project-map-translations/v1"), "and the exact shape to write");
	}, { task: "- [ ] **PM-2 — Add draft generation and human plan approval**\n  - The body line the document carries.\n" });
});

test("the translate command refuses when there is no map to translate", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("translate", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(probe.notified.join("\n").includes("nothing to translate"));
	}, { task: "- [ ] **PM-2 — Add draft generation and human plan approval**\n" });
});

test("explaining an unknown capability says so instead of opening an empty overlay", async () => {
	await withRepository(async (directory) => {
		const probe = harness(directory, [true]);
		let opened = 0;
		probe.ctx.ui.custom = async () => {
			opened += 1;
			return {} as never;
		};
		await runProjectMapCommand("draft", probe.ctx, { now: () => NOW });
		await explainProjectMapCapability(probe.ctx, "not-a-capability");
		assert.equal(opened, 0, "nothing is opened for a capability the map does not declare");
		assert.ok(probe.notified.some((message) => message.includes("not-a-capability")));
	});
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

test("generating the plan asks through the confirmation dialog and writes only when it is accepted", async () => {
	await withRepository(async (directory) => {
		const declined = harness(directory, [false]);
		const first = await runProjectMapCommand("draft", declined.ctx, { now: () => NOW });
		assert.equal(first.wrote, false);
		assert.equal(declined.confirmations, 1);
		assert.equal(readProjectMapFile(artifactPath(directory)).map, null);
		assert.ok(declined.notified.some((message) => message.includes("nothing was written")));

		const accepted = harness(directory, [true]);
		const second = await runProjectMapCommand("draft", accepted.ctx, { now: () => NOW });
		assert.equal(second.wrote, true);
		assert.equal(accepted.confirmations, 1);
		assert.equal(readProjectMapFile(artifactPath(directory)).map?.approval.state, "draft");
	});
});

test("the bare command ensures a map, shows it, and leaves an existing one alone", async () => {
	await withRepository(async (directory) => {
		let shown = 0;
		const first = harness(directory, [true]);
		const generated = await runProjectMapCommand("", first.ctx, { now: () => NOW, onShow: () => { shown += 1; } });
		assert.equal(generated.action, "ensure");
		assert.equal(generated.wrote, true);
		assert.equal(first.confirmations, 1);
		assert.equal(shown, 1);
		assert.ok(first.notified.some((message) => message.toLowerCase().includes("assumption")));
		const written = readFileSync(artifactPath(directory), "utf8");

		const second = harness(directory);
		const again = await runProjectMapCommand("ensure", second.ctx, { now: () => NOW, onShow: () => { shown += 1; } });
		assert.equal(again.action, "ensure");
		assert.equal(again.wrote, false);
		assert.equal(second.confirmations, 0, "an existing map is never regenerated behind the human's back");
		assert.equal(shown, 2, "ensuring makes the card visible either way");
		assert.equal(readFileSync(artifactPath(directory), "utf8"), written);
		assert.equal(again.map?.project.id, "example-shop");
	});
});

test("ensure refresh reports canonical source changes before the generation confirmation and keeps a decline byte-identical", async () => {
	await withRepository(async (directory) => {
		await runProjectMapCommand("draft", harness(directory).ctx);
		const before = readFileSync(artifactPath(directory), "utf8");
		writeFileSync(join(directory, "odd/tasks/roadmap.md"), "- [x] **PM-2 — Keep**\n- [ ] **PM-4 — Added**\n");
		const probe = harness(directory);
		probe.ctx.ui.confirm = async (title, message) => {
			assert.equal(title, "Write the Project Map draft?");
			assert.equal(message, `Write a draft map to ${PROJECT_MAP_ARTIFACT_PATH}? It stays a draft until you approve it.`);
			assert.ok(probe.notified.at(-1)?.includes('Capability "keep": state planned → done.'));
			return false;
		};
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.wrote, false);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
		assert.deepEqual(report.map, readProjectMapFile(artifactPath(directory)).map);
		const changes = probe.notified.find((message) => message.includes("sources changed:"));
		assert.equal(changes, 'Project Map sources changed:\n- Capability "keep": state planned → done.\n- Capability "removed" was removed.\n- Capability "added" was added.');
		const translate = harness(directory);
		await runProjectMapCommand("translate", translate.ctx);
		assert.equal(probe.notified.at(-1), translate.notified[0], "the kept map feeds the identical translation report");
	}, { task: "- [ ] **PM-2 — Keep**\n- [ ] **PM-3 — Removed**\n" });
});

test("ensure preserves human surfaces without staleness and carries only those surfaces through an accepted refresh", async () => {
	await withRepository(async (directory) => {
		const draft = await runProjectMapCommand("draft", harness(directory).ctx);
		const id = draft.map!.capabilities[0]!.id;
		await runProjectMapCommand(`declare ${id} web`, harness(directory).ctx);
		const unchanged = harness(directory);
		const kept = await runProjectMapCommand("", unchanged.ctx);
		assert.equal(unchanged.confirmations, 0);
		assert.equal(kept.wrote, false);
		assert.deepEqual(kept.map!.capabilities[0]!.surfaces, ["web"]);
		assert.equal(unchanged.notified.length, 2, "only the card and shared report are printed");
		assert.equal(unchanged.notified.some((message) => message.includes("sources changed")), false);

		writeFileSync(join(directory, "odd/tasks/roadmap.md"), "- [x] **PM-2 — Keep**\n");
		const accepted = harness(directory, [true]);
		const refreshed = await runProjectMapCommand("", accepted.ctx);
		assert.equal(accepted.confirmations, 1);
		assert.equal(refreshed.wrote, true);
		assert.deepEqual(refreshed.map!.capabilities[0]!.surfaces, ["web"]);
		assert.equal(refreshed.map!.capabilities[0]!.state, "done");
		assert.deepEqual(refreshed.map, readProjectMapFile(artifactPath(directory)).map);
		const expected = generateProjectMapDraft(readRepositorySources(directory).sources).map!;
		expected.capabilities[0]!.surfaces = ["web"];
		assert.deepEqual(refreshed.map, expected, "the human surfaces are the only merge into the generated draft");
		const translate = harness(directory);
		await runProjectMapCommand("translate", translate.ctx);
		assert.equal(accepted.notified.at(-1), translate.notified[0]);
	}, { task: "- [ ] **PM-2 — Keep**\n" });
});

test("ensure ignores approval alone, reports outcome changes, and warns that an accepted approved refresh returns to draft", async () => {
	await withRepository(async (directory) => {
		await runProjectMapCommand("draft", harness(directory).ctx);
		await runProjectMapCommand("declare keep web", harness(directory).ctx);
		await runProjectMapCommand("approve maintainer", harness(directory).ctx, { now: () => NOW });
		const unchanged = harness(directory);
		const kept = await runProjectMapCommand("", unchanged.ctx);
		assert.equal(kept.map!.approval.state, "approved");
		assert.equal(unchanged.confirmations, 0);
		assert.equal(kept.wrote, false);
		writeFileSync(join(directory, "odd/tasks/roadmap.md"), "- [ ] **PM-3 — Keep**\n");
		const probe = harness(directory);
		let confirmations = 0;
		probe.ctx.ui.confirm = async (title, message) => {
			confirmations += 1;
			assert.equal(title, "Write the Project Map draft?");
			assert.ok(message.includes("returns the approved map to draft"));
			assert.ok(probe.notified.at(-1)?.includes('Capability "keep": outcome PM-2 — Keep → PM-3 — Keep.'));
			return true;
		};
		const refreshed = await runProjectMapCommand("", probe.ctx);
		assert.equal(confirmations, 1);
		assert.equal(refreshed.wrote, true);
		assert.deepEqual(readProjectMapFile(artifactPath(directory)).map!.approval, { state: "draft" });
	}, { task: "- [ ] **PM-2 — Keep**\n" });
});

test("ensure reports and replaces document-declared surfaces", async () => {
	await withRepository(async (directory) => {
		await runProjectMapCommand("draft", harness(directory).ctx);
		writeFileSync(join(directory, "odd/tasks/roadmap.md"), "- [ ] **PM-2 — Keep**\n  **Allowed edit surfaces:** `api/keep.ts`\n");
		const probe = harness(directory);
		const refreshed = await runProjectMapCommand("", probe.ctx);
		assert.equal(refreshed.wrote, true);
		assert.equal(probe.confirmations, 1);
		assert.ok(probe.notified.some((message) => message.includes('Capability "keep": surfaces ["web"] → ["api"].')));
		assert.deepEqual(refreshed.map!.capabilities[0]!.surfaces, ["api"]);
	}, { config: "project_map:\n  surfaces:\n    web: web/\n    api: api/\n", task: "- [ ] **PM-2 — Keep**\n  **Allowed edit surfaces:** `web/keep.ts`\n" });
});

test("ensure refuses a refresh when the artifact moves during confirmation and translates the settled artifact", async () => {
	await withRepository(async (directory) => {
		await runProjectMapCommand("draft", harness(directory).ctx);
		writeFileSync(join(directory, "odd/tasks/roadmap.md"), "- [x] **PM-2 — Keep**\n");
		const probe = harness(directory);
		let moved = "";
		probe.ctx.ui.confirm = async () => {
			const map = readProjectMapFile(artifactPath(directory)).map!;
			map.capabilities = [];
			moved = JSON.stringify(map);
			writeFileSync(artifactPath(directory), moved);
			return true;
		};
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.wrote, false);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), moved);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.message.includes("changed while the decision was pending")));
		const translate = harness(directory);
		await runProjectMapCommand("translate", translate.ctx);
		assert.equal(probe.notified.at(-1), translate.notified[0]);
	}, { task: "- [ ] **PM-2 — Keep**\n" });
});

test("ensure never asks or refreshes without a UI even when the sources moved", async () => {
	await withRepository(async (directory) => {
		await runProjectMapCommand("draft", harness(directory).ctx);
		const before = readFileSync(artifactPath(directory), "utf8");
		writeFileSync(join(directory, "odd/tasks/roadmap.md"), "- [x] **PM-2 — Keep**\n");
		const probe = harness(directory);
		probe.ctx.hasUI = false;
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
		assert.ok(probe.notified.some((message) => message.includes("sources changed")));
		const translate = harness(directory);
		await runProjectMapCommand("translate", translate.ctx);
		assert.equal(probe.notified.at(-1), translate.notified[0]);
	}, { task: "- [ ] **PM-2 — Keep**\n" });
});

test("ensure keeps the stored map and reports omissions when project identity cannot be regenerated", async () => {
	await withRepository(async (directory) => {
		await runProjectMapCommand("draft", harness(directory).ctx);
		const before = readFileSync(artifactPath(directory), "utf8");
		writeFileSync(join(directory, "package.json"), "{}");
		const probe = harness(directory);
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
		assert.ok(report.omissions.length > 0);
		assert.ok(probe.notified.some((message) => message.includes("A draft could not be generated.")));
		const translate = harness(directory);
		await runProjectMapCommand("translate", translate.ctx);
		assert.equal(probe.notified.at(-1), translate.notified[0]);
	});
});

test("ensure with current translations stays quiet, and first-run ensure also hands over the shared report", async () => {
	await withRepository(async (directory) => {
		const first = harness(directory);
		const drafted = await runProjectMapCommand("", first.ctx);
		const translate = harness(directory);
		await runProjectMapCommand("translate", translate.ctx);
		assert.equal(first.notified.at(-1), translate.notified[0]);
		writeFileSync(join(directory, "openspec/project-map.es.json"), JSON.stringify({
			version: "gentle-pi.project-map-translations/v1", language: "es",
			capabilities: { [drafted.map!.capabilities[0]!.id]: { source: "odd/tasks/roadmap.md", sourceHash: hashProjectMapDescription(["Body."]), lines: ["Cuerpo."] } },
		}));
		const probe = harness(directory);
		const report = await runProjectMapCommand("", probe.ctx);
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.equal(probe.notified.length, 2);
		assert.ok(probe.notified[1]!.includes("Every capability the map declares with a document is translated and current."));
	}, { task: "- [ ] **PM-2 — Keep**\n  Body.\n" });
});

test("the bare command replaces an unusable artifact only after saying so", async () => {
	await withRepository(async (directory) => {
		mkdirSync(join(directory, "openspec"), { recursive: true });
		writeFileSync(artifactPath(directory), "{ not json", "utf8");
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand("", probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, true);
		assert.ok(probe.notified.some((message) => message.includes("not a usable map")));
		assert.deepEqual(readProjectMapFile(artifactPath(directory)).diagnostics, []);
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

test("declare persists a capability surface only after confirmation", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand(`declare ${capabilityId} web`, probe.ctx, { now: () => NOW });
		assert.equal(report.action, "declare");
		assert.equal(report.wrote, true);
		assert.equal(probe.confirmations, 1);
		assert.deepEqual(readProjectMapFile(artifactPath(directory)).map?.capabilities[0]?.surfaces, ["web"]);
		assert.ok(probe.notified.some((message) => message.includes("Declared surfaces for")));
	});
});

test("declare refuses an unknown surface without writing", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		const before = readFileSync(artifactPath(directory), "utf8");
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand(`declare ${capabilityId} unknown`, probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.path === "$.capabilities[0].surfaces"));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("declare writes nothing when the human declines", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		const before = readFileSync(artifactPath(directory), "utf8");
		const probe = harness(directory, [false]);
		const report = await runProjectMapCommand(`declare ${capabilityId} web`, probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 1);
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("declare refuses an approved map without writing", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
		assert.equal((await runProjectMapCommand("approve facundo", harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
		const before = readFileSync(artifactPath(directory), "utf8");
		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand(`declare ${capabilityId} api`, probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(probe.confirmations, 0);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.path === "$.approval.state"));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
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

test("draft then declare then approve records the actor and injected timestamp", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		const drafted = await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);

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

		const capabilityId = generated.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
		const accepted = harness(directory, [true]);
		assert.equal((await runProjectMapCommand("approve facundo", accepted.ctx, { now: () => NOW })).wrote, true);
	});
});

test("approve writes nothing when the human declines", async () => {
	await withRepository(async (directory) => {
		const seed = harness(directory, [true]);
		const drafted = await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
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
		const drafted = await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
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
		const drafted = await runProjectMapCommand("draft", seed.ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
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
		assert.ok(probe.notified.some((message) => message.includes(PROJECT_MAP_ARTIFACT_PATH) && message.includes("changed")));
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
		assert.ok(probe.notified.some((message) => message.includes(PROJECT_MAP_ARTIFACT_PATH) && message.includes("changed")));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), "someone else got here first\n");
	});
});

test("refuses to declare when the artifact changed between the read and the confirmation", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		const before = readFileSync(artifactPath(directory), "utf8");

		const probe = harness(directory);
		probe.ctx.ui.confirm = async () => {
			writeFileSync(artifactPath(directory), `${before}\n`, "utf8");
			return true;
		};
		const report = await runProjectMapCommand(`declare ${capabilityId} web`, probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.message.includes("changed")));
		assert.ok(probe.notified.some((message) => message.includes(PROJECT_MAP_ARTIFACT_PATH) && message.includes("changed")));
		assert.equal(readFileSync(artifactPath(directory), "utf8"), `${before}\n`);
	});
});

test("clears the declared surfaces when no surface is given", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web api`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
		assert.deepEqual(readProjectMapFile(artifactPath(directory)).map?.capabilities[0]?.surfaces, ["web", "api"]);

		const probe = harness(directory, [true]);
		const report = await runProjectMapCommand(`declare ${capabilityId}`, probe.ctx, { now: () => NOW });
		assert.equal(report.wrote, true);
		assert.equal(probe.confirmations, 1);
		assert.deepEqual(readProjectMapFile(artifactPath(directory)).map?.capabilities[0]?.surfaces, []);
	});
});

test("never asks and never writes when there is nothing to declare against", async () => {
	await withRepository(async (directory) => {
		const absent = harness(directory, [true]);
		const noArtifact = await runProjectMapCommand("declare anything web", absent.ctx, { now: () => NOW });
		assert.equal(noArtifact.wrote, false);
		assert.equal(absent.confirmations, 0);

		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		const before = readFileSync(artifactPath(directory), "utf8");
		const unknown = harness(directory, [true]);
		const report = await runProjectMapCommand(`declare not-a-capability web`, unknown.ctx, { now: () => NOW });
		assert.equal(report.wrote, false);
		assert.equal(unknown.confirmations, 0, "a refusal never reaches the prompt");
		assert.ok(report.diagnostics.some((diagnostic) => diagnostic.message.includes(capabilityId)), "the refusal names the ids the map does declare");
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("never writes and never asks without a UI, for every action that can write", async () => {
	await withRepository(async (directory) => {
		const drafted = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		const capabilityId = drafted.map?.capabilities[0]?.id;
		assert.ok(capabilityId);
		// A surface must be declared first, or the approve iteration below would be refused
		// as an incomplete map and would pass without ever reaching the UI guard it claims to test.
		assert.equal((await runProjectMapCommand(`declare ${capabilityId} web`, harness(directory, [true]).ctx, { now: () => NOW })).wrote, true);
		const before = readFileSync(artifactPath(directory), "utf8");

		for (const args of ["draft", `declare ${capabilityId} api`, "approve facundo"]) {
			const probe = harness(directory, [true]);
			probe.ctx.hasUI = false;
			const report = await runProjectMapCommand(args, probe.ctx, { now: () => NOW });
			assert.equal(report.wrote, false, `expected ${args} to write nothing without a UI`);
			assert.equal(probe.confirmations, 0, `expected ${args} to ask nothing without a UI`);
		}
		assert.equal(readFileSync(artifactPath(directory), "utf8"), before);
	});
});

test("refuses to write over an artifact it cannot read", async () => {
	await withRepository(async (directory) => {
		// A directory where the artifact is expected is unreadable, not absent. Conflating the
		// two would make the staleness guard see null before and null after, and wave the write
		// through over a file it never inspected.
		mkdirSync(artifactPath(directory));
		for (const args of ["draft", "declare merchant-catalog web", "approve facundo"]) {
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

test("the card marks a launchable capability and its marker runs the open plan", async () => {
	await withGitRepository(async (directory, store, agentHome) => {
		// An approved map whose only capability can still be worked on, plus the binding the
		// launchable projection reads. The real worktree does not exist, so the plan the marker
		// runs refuses — which is the point: the marker is a hint and the click re-verifies.
		mkdirSync(join(directory, "openspec"), { recursive: true });
		writeFileSync(artifactPath(directory), JSON.stringify({
			version: "gentle-shell.project-map/v1",
			project: { id: "example-shop", name: "Example Shop" },
			approval: { state: "approved", approvedAt: new Date().toISOString(), approvedBy: "tester" },
			foundations: [],
			capabilities: [{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "planned" }],
		}), "utf8");
		assert.ok(bindProjectMapStoreWorktree({ root: store, capabilityId: "catalog", branch: "feat/catalog", worktreeRoot: "/projects/shop-worktrees/catalog", sessionId: "session-launch", baseCommit: "0".repeat(40), now: new Date().toISOString() }).binding);

		const extension = projectMapExtension({ GENTLE_PI_AGENT_HOME: agentHome, GENTLE_PI_PROJECT_MAP: "1" });
		const probe = widgetContext(directory, "session-launch");
		await extension.fire("session_start", probe.ctx);
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		probe.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		const rail = sidebarState(tui).parts.get(PROJECT_MAP_RAIL_KEY)!;
		const lines = rail.render(56);
		const row = lines.findIndex((line) => line.includes("✿") && line.includes("Catalog"));
		assert.ok(row > 0, "the launchable capability carries the marker");
		// Four body columns in, plus the frame's two.
		rail.handleMouse?.({ type: "click", button: "left", x: 6, y: row, screenX: 6, screenY: row, width: 56, height: lines.length, shift: false, alt: false, ctrl: false });
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(probe.notified.some((message) => message.includes("Open Pi plan")), "the marker runs the product's own open plan");
	});
});

test("the card leaves an unlaunchable capability unmarked", async () => {
	await withGitRepository(async (directory, _store, agentHome) => {
		// The same approved map with no worktree binding: the projection has nothing to back.
		mkdirSync(join(directory, "openspec"), { recursive: true });
		writeFileSync(artifactPath(directory), JSON.stringify({
			version: "gentle-shell.project-map/v1",
			project: { id: "example-shop", name: "Example Shop" },
			approval: { state: "approved", approvedAt: new Date().toISOString(), approvedBy: "tester" },
			foundations: [],
			capabilities: [{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: [], surfaces: ["web"], state: "planned" }],
		}), "utf8");
		const extension = projectMapExtension({ GENTLE_PI_AGENT_HOME: agentHome, GENTLE_PI_PROJECT_MAP: "1" });
		const probe = widgetContext(directory, "session-plain");
		await extension.fire("session_start", probe.ctx);
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		probe.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		const lines = sidebarState(tui).parts.get(PROJECT_MAP_RAIL_KEY)!.render(56);
		const row = lines.findIndex((line) => line.includes("Catalog"));
		assert.ok(row > 0, "the capability still renders");
		assert.equal(lines[row]!.includes("✿"), false, "and carries no launch marker");
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

test("the integrate sub-action is advertised and parses without an argument", () => {
	assert.ok((PROJECT_MAP_SUB_ACTIONS as readonly string[]).includes("integrate"));
	const parsed = parseProjectMapSubAction("integrate");
	assert.equal(parsed.ok, true);
	assert.equal(parsed.action, "integrate");
	assert.equal(parsed.argument, "");
});

test("integrate refuses an argument and reports that readiness cannot be measured without coordination", async () => {
	await withRepository(async (directory) => {
		writeGroupedReadyArtifact(directory);
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "integrate-unavailable");
		await extension.fire("session_start", probe.ctx);
		const command = extension.commands.get(PROJECT_MAP_COMMAND_NAME)!;
		await command.handler("integrate catalog", probe.ctx);
		assert.ok(probe.notified.some((message) => /integrate takes no argument/.test(message)), probe.notified.join("\n"));
		const report = await runProjectMapCommand("integrate", probe.ctx as unknown as ProjectMapCommandContext, { env: GATE_ON });
		assert.equal(report.action, "integrate");
		assert.ok(probe.notified.some((message) => /coordination is unavailable/i.test(message)), probe.notified.join("\n"));
	});
});

test("integrate names the next safe integration action and issues a receipt for it", async () => {
	await withGitRepository(async (directory, store, agentHome) => {
		const now = new Date().toISOString();
		// A capability in flight whose document agrees, with every repository-facing check satisfiable.
		mkdirSync(join(directory, "odd", "tasks"), { recursive: true });
		writeFileSync(join(directory, "odd", "tasks", "catalog.md"), "- [x] one\n- [ ] two\n", "utf8");
		mkdirSync(join(directory, "openspec"), { recursive: true });
		writeFileSync(join(directory, "openspec", "config.yaml"), 'schema: spec-driven\napply:\n  test_command: "pnpm test"\n', "utf8");
		writeFileSync(artifactPath(directory), JSON.stringify({
			version: "gentle-shell.project-map/v1",
			project: { id: "example-shop", name: "Example Shop" },
			approval: { state: "draft" },
			foundations: [],
			capabilities: [{ id: "catalog", outcome: "Catalog", foundationRefs: [], dependsOn: [], contracts: [], featureDocs: ["odd/tasks/catalog.md"], surfaces: ["web"], state: "active" }],
		}), "utf8");
		const head = String(execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" })).trim();
		execFileSync("git", ["-C", directory, "branch", "feat/catalog"], { stdio: "ignore" });
		// No receipt is planted: the run below has to issue the first one itself, which is the whole
		// point of the coverage check no longer gating on its own product.
		assert.ok(bindProjectMapStoreWorktree({ root: store, capabilityId: "catalog", branch: "feat/catalog", worktreeRoot: directory, sessionId: "session-catalog", baseCommit: head, now }).binding);

		const extension = projectMapExtension({ GENTLE_PI_AGENT_HOME: agentHome });
		const probe = widgetContext(directory, "integrate-ready");
		await extension.fire("session_start", probe.ctx);
		await extension.commands.get(PROJECT_MAP_COMMAND_NAME)!.handler("integrate", probe.ctx);
		const printed = probe.notified.join("\n");
		assert.match(printed, /Next safe integration action: catalog/, printed);
		assert.match(printed, /grants nothing/i);
		assert.match(printed, /verification: pnpm test/);
		assert.match(printed, /tasks: odd\/tasks\/catalog\.md 1\/2/);
		assert.match(printed, /the review store records candidates, not capabilities/);
		assert.equal(readProjectMapStoreReadinessReceipts({ root: store, capabilityId: "catalog", limit: 5 }).receipts.length, 1, "the run issued the first receipt, with nothing planted for it");
		assert.ok(probe.notified.some((message) => /authority "none"/.test(message)), printed);
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
		assert.equal(body.includes("✓ tooling"), false);
		assert.match(body, /▾ Product capabilities 1\/1/);
		assert.ok(body.includes("✓ Catalog"));
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
		const extension = projectMapExtension();
		const probe = widgetContext(directory, "selection");
		await extension.fire("session_start", probe.ctx);
		const tui = { terminal: {}, requestRender() {} } as unknown as TUI;
		probe.widgets.get("gentle-project-map")!(tui, { fg: (_color: string, text: string) => text });
		const body = () => sidebarState(tui).parts.get("project-map")!.render(80).join("\n");
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ✓ Alpha/);
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ○ Beta/);
		await extension.shortcuts.get("alt+j")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ○ Beta/, "next clamps at the end");
		await extension.shortcuts.get("alt+k")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ✓ Alpha/);
		await extension.shortcuts.get("alt+k")!.handler(probe.ctx);
		assert.match(body(), /▸ \? ✓ Alpha/, "previous clamps at the start");
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

// PM9-1: the executable half sits behind an explicit opt-in. These cases pin the refusal,
// the routes it must never reach, and the offer it must withdraw.
const GATE_OFF: NodeJS.ProcessEnv = {};
const GATE_ON: NodeJS.ProcessEnv = { GENTLE_PI_PROJECT_MAP: "1" };

const GATED_COMMANDS: Array<[string, string]> = [
	["worktree provision catalog", "worktree"],
	["open catalog", "open"],
	["lead claim", "lead"],
	["lead renew", "lead"],
	["contract propose catalog checkout-1 Title body.md", "contract"],
	["contract accept catalog checkout-1 because it is shared", "contract"],
	["contract reject catalog checkout-1 because it is not", "contract"],
	["integrate", "integrate"],
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
		const reachable = ["status", "show", "hide", "lead status", "lead release", "contract list", "worktree inspect catalog", "worktree list"];
		for (const command of reachable) {
			const h = harness(directory);
			const report = await runProjectMapCommand(command, h.ctx, { env: GATE_OFF });
			assert.equal(report.diagnostics.some((entry) => entry.code === "project-map/executable-disabled"), false, `${command} must not be gated`);
		}
		// A malformed gated command is a usage error first: the gate never masks a typo.
		const malformed = await runProjectMapCommand("worktree provision", harness(directory).ctx, { env: GATE_OFF });
		assert.equal(malformed.diagnostics[0]?.code, "project-map/invalid-field");
		assert.match(malformed.diagnostics[0]!.message, /capability id/i);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the gate is open when it is explicitly enabled", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pm9-gate-on-"));
	try {
		// Without a repository there is nothing to provision, so the gate being open is
		// shown by the answer that follows it rather than by a successful provisioning.
		const report = await runProjectMapCommand("worktree provision catalog", harness(directory).ctx, { env: GATE_ON });
		assert.equal(report.diagnostics.some((entry) => entry.code === "project-map/executable-disabled"), false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the Open Pi offer is withdrawn while the gate is off, and the switch is named", () => {
	const readiness = { permitted: true, capability: null, claim: null, worktree: null, host: null, diagnostics: [{ code: "project-map-open-pi/prior", path: "$.host", message: "prior", severity: "warning" }] } as never;
	const withheld = projectMapOpenPiDecision(readiness, GATE_OFF);
	assert.equal(withheld.permitted, false);
	assert.ok(withheld.diagnostics.some((entry) => entry.code === "project-map-open-pi/executable-disabled"));
	assert.ok(withheld.diagnostics.some((entry) => entry.code === "project-map-open-pi/prior"), "the original diagnostics survive");
	assert.equal(projectMapOpenPiDecision(readiness, GATE_ON), readiness, "an enabled gate changes nothing");
});

test("draft reads a declared roadmap outside odd/tasks", async () => {
	await withRepository(async (directory) => {
		mkdirSync(join(directory, "roadmaps"), { recursive: true });
		writeFileSync(join(directory, "roadmaps", "launch.md"), "- [ ] **Launch — External roadmap capability**\n", "utf8");
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  roadmap: roadmaps/launch.md\n", "utf8");
		const report = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		assert.deepEqual(report.map?.capabilities.map((capability) => capability.id), ["external-roadmap-capability"]);
		assert.equal(report.map?.capabilities.some((capability) => capability.id === "add-draft-generation-and-human-plan-approval"), false);
	});
});

test("draft does not read a declared odd task roadmap twice", async () => {
	await withRepository(async (directory) => {
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  roadmap: odd/tasks/roadmap.md\n", "utf8");
		writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), "- [ ] **One — First capability**\n- [ ] **Two — Second capability**\n", "utf8");
		const report = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		assert.deepEqual(report.map?.capabilities.map((capability) => capability.id), ["first-capability", "second-capability"]);
		assert.equal(report.omissions.some((omission) => omission.includes("declared twice in odd/tasks/roadmap.md")), false);
	});
});

test("repository sources normalize roadmap aliases without duplicate entries", async () => {
	for (const config of ["project_map:\n  roadmap: odd/./tasks/a.md\n", "project_map.roadmap: odd/./tasks/a.md\n"]) {
		await withRepository(async (directory) => {
			writeFileSync(join(directory, "openspec", "config.yaml"), config, "utf8");
			writeFileSync(join(directory, "odd", "tasks", "roadmap.md"), "- [ ] **A — Canonical capability**\n", "utf8");
			const result = readRepositorySources(directory);
			assert.deepEqual(result.sources.oddTaskDocuments, [{ path: "odd/tasks/roadmap.md", text: "- [ ] **A — Canonical capability**\n" }]);
		});
	}
	await withRepository(async (directory) => {
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  roadmap: ../outside.md\n", "utf8");
		const result = readRepositorySources(directory);
		assert.equal(result.sources.oddTaskDocuments?.some((document) => document.path === "../outside.md"), false);
	});
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

test("draft reports absent and unreadable declared roadmaps with one read per path", async () => {
	await withRepository(async (directory) => {
		mkdirSync(join(directory, "roadmaps", "unreadable.md"), { recursive: true });
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  roadmap: roadmaps/missing.md\n", "utf8");
		const absent = await runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW });
		assert.deepEqual(absent.omissions.filter((omission) => omission.includes("roadmaps/missing.md")), ["openspec/config.yaml declares the roadmap \"roadmaps/missing.md\", but no document with that path could be read, so no capability could be extracted from it."]);

		const externalPath = join(directory, "roadmaps", "unreadable.md");
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  roadmap: roadmaps/unreadable.md\n", "utf8");
		const external = await recordReads(externalPath, () => runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW }));
		assert.deepEqual(external.reads, [externalPath]);
		assert.deepEqual(external.result.omissions.filter((omission) => omission.includes("roadmaps/unreadable.md")), [
			"roadmaps/unreadable.md exists but could not be read, so it contributed no capability.",
			"openspec/config.yaml declares the roadmap \"roadmaps/unreadable.md\", but no document with that path could be read, so no capability could be extracted from it.",
		]);
	});

	await withRepository(async (directory) => {
		const internalPath = join(directory, "odd", "tasks", "roadmap.md");
		rmSync(internalPath);
		mkdirSync(internalPath);
		writeFileSync(join(directory, "openspec", "config.yaml"), "project_map:\n  roadmap: odd/tasks/roadmap.md\n", "utf8");
		const internal = await recordReads(internalPath, () => runProjectMapCommand("draft", harness(directory, [true]).ctx, { now: () => NOW }));
		assert.deepEqual(internal.reads, [internalPath]);
		assert.deepEqual(internal.result.omissions.filter((omission) => omission.includes("odd/tasks/roadmap.md")), [
			"odd/tasks/roadmap.md exists but could not be read, so it contributed no capability.",
			"openspec/config.yaml declares the roadmap \"odd/tasks/roadmap.md\", but no document with that path could be read, so no capability could be extracted from it.",
		]);
	});
});
