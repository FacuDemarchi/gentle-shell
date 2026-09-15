import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// These are instruction-delivery contracts, not proof of autonomous model adherence.
const read = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const core = read("assets/orchestrator.md");
const delegation = read("assets/orchestrator-delegation.md");
const memory = read("assets/orchestrator-memory.md");
const wrapper = read("extensions/gentle-ai.ts");

function containsAll(text: string, clauses: readonly string[]): void {
	for (const clause of clauses) assert.ok(text.includes(clause), `missing contract: ${clause}`);
}

test("organic entry stays read-only without authorization and loads detail before work", () => {
	containsAll(core, [
		"Substantial authorized work: use ODD",
		"Before organic exploration, implementation, or resume",
		"orchestrator-delegation.md",
		"orchestrator-memory.md",
	]);
	containsAll(delegation, [
		"Investigation, explanation, review, comparison, and proposal-only requests remain read-only",
		"without a task or storage permission prompt",
		"Small, understood work creates no durable task artifacts",
	]);
	assert.doesNotMatch(core + wrapper, /Prefer SDD\/OpenSpec artifacts|Substantial feature: suggest SDD organically/);
	assert.doesNotMatch(core + delegation, /Suggest it when proposal\/spec\/design\/tasks|propose SDD only when durable proposal\/spec\/design\/tasks/);
});

test("research uses adaptive evidence gathering and existing general workers only", () => {
	containsAll(delegation, [
		"problem, intended outcome, constraints, and current evidence",
		"no fixed questionnaire or mandatory rounds",
		"one focused user question",
		"stop and wait",
		"workers return gaps to the parent",
		"available authorized documentation/web tools",
		"prefer primary sources",
		"URLs or code locations",
		"verified facts, assumptions, contradictions, freshness, and gaps",
		"recommendation, tradeoffs, open questions, and implementation implications",
		"Forward these research instructions",
		"existing fresh general exploration/research worker",
		"do not create a specialized agent or invoke `sdd-research`",
		"no new persistence or readiness machinery",
	]);
});

test("task sizing is explicitly advisory and forwarded without cosmetic savings", () => {
	containsAll(delegation, [
		"about 400 authored changed lines",
		"additions plus deletions",
		"not a task acceptance criterion, hard cap, counter-trigger, automatic stop, forced split, or RDD trigger",
		"Forward this same advisory-only instruction",
		"Never delete spaces, blank lines, or comments",
		"never omit tests, minify, add gratuitous abstractions, or split artificially",
		"Existing PR size gates remain unchanged",
	]);
});

test("organic progress preserves both complete feature copies and reconciles actual evidence", () => {
	containsAll(memory, [
		"odd/tasks/<feature-name>.md",
		"odd/<feature-name>/tasks",
		"stable task IDs",
		"full current checklist",
		"repository-relative file locator",
		"preserve valid completed and unrelated work",
		"reopen invalidated items",
		"Check off only observed outcomes",
		"Read back both writes",
		"not atomic",
		"mirror pending",
		"Preserve both versions",
		"mem_context",
		"mem_search",
		"mem_get_observation",
		"read the actual task file",
		"not a third authority",
	]);
});

test("assumption challenge and task checks do not activate or duplicate native review", () => {
	containsAll(delegation, [
		"at most one scoped independent read-only assumption challenge",
		"high-consequence unproven premise",
		"Deterministic failures need fixes",
		"native RDD refuter",
		"functional checks per task, not an RDD cycle per TODO",
		"deliverable candidate boundary",
		"native candidate risk assessment",
		"gentle_review` with `{\"operation\":\"assess\"}",
		"Passive/low",
		"no reviewer or consent ceremony",
		"only on grant",
		"decline continues under ordinary policy",
		"never infer low risk from a failed assessment",
		"When RDD is disabled, do not start or prompt for RDD",
	]);
});

test("user documentation shows recovery and candidate-level consent without claiming model proof", () => {
	const docs = read("docs/readme-reference.md");
	containsAll(docs, [
		"## Organic Driven Development",
		"```mermaid",
		"Full feature memory and actual task file",
		"Native candidate risk",
		"advisory",
		"Static prompt tests",
		"autonomous",
	]);
	assert.ok(read("README.md").includes("#organic-driven-development"));
});
