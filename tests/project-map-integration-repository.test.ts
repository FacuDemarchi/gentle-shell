import assert from "node:assert/strict";
import test from "node:test";
import {
	checkProjectMapIntegrationFreshness,
	checkProjectMapIntegrationOverlap,
	resolveProjectMapIntegrationTarget,
	type ProjectMapIntegrationGitExecutor,
	type ProjectMapIntegrationGitOutcome,
} from "../lib/project-map-integration-repository.ts";

/** Records every call and answers from a table, so no test needs a real repository. */
function executor(answers: Record<string, ProjectMapIntegrationGitOutcome>) {
	const calls: string[][] = [];
	const run: ProjectMapIntegrationGitExecutor = (arguments_) => {
		calls.push([...arguments_]);
		const key = arguments_.join(" ");
		for (const [pattern, answer] of Object.entries(answers)) if (key.startsWith(pattern)) return answer;
		return { ok: false, reason: `unexpected git call: ${key}` };
	};
	return { run, calls };
}

const WORKTREE_LIST = [
	"worktree /projects/shop",
	"HEAD 1111111111111111111111111111111111111111",
	"branch refs/heads/main",
	"",
	"worktree /projects/shop-worktrees/catalog",
	"HEAD 2222222222222222222222222222222222222222",
	"branch refs/heads/feat/catalog",
	"",
].join("\n");

test("the integration target is the branch the main worktree is on", () => {
	const { run } = executor({ "worktree list --porcelain": { ok: true, output: WORKTREE_LIST } });
	const result = resolveProjectMapIntegrationTarget({ cwd: "/projects/shop", run });
	assert.equal(result.target, "main");
	assert.deepEqual(result.diagnostics, []);
});

test("a main worktree with a detached HEAD leaves the target unknown and says so", () => {
	const detached = "worktree /projects/shop\nHEAD 1111111111111111111111111111111111111111\ndetached\n";
	const { run } = executor({ "worktree list --porcelain": { ok: true, output: detached } });
	const result = resolveProjectMapIntegrationTarget({ cwd: "/projects/shop", run });
	assert.equal(result.target, null);
	assert.equal(result.diagnostics.length, 1);
	assert.match(result.diagnostics[0]!.message, /detached/i);
});

test("an unreadable worktree list leaves the target unknown rather than guessing", () => {
	const { run } = executor({ "worktree list --porcelain": { ok: false, reason: "not a git repository" } });
	const result = resolveProjectMapIntegrationTarget({ cwd: "/projects/shop", run });
	assert.equal(result.target, null);
	assert.equal(result.diagnostics.length, 1);
	assert.equal(result.diagnostics[0]!.severity, "warning");
});

test("freshness is unverified when the target is unknown", () => {
	const { run, calls } = executor({});
	const result = checkProjectMapIntegrationFreshness({ cwd: "/projects/shop", run, target: null, baseCommit: "a".repeat(40) });
	assert.equal(result.check, "unverified");
	assert.equal(result.behindBy, null);
	assert.deepEqual(calls, [], "an unknown target must not be probed");
});

test("freshness is unverified when the branch base is unknown", () => {
	const { run, calls } = executor({});
	const result = checkProjectMapIntegrationFreshness({ cwd: "/projects/shop", run, target: "main", baseCommit: null });
	assert.equal(result.check, "unverified");
	assert.equal(result.behindBy, null);
	assert.deepEqual(calls, []);
});

test("a base contained in the target is fresh, and the distance is reported", () => {
	const { run } = executor({
		"merge-base --is-ancestor": { ok: true, output: "" },
		"rev-list --count": { ok: true, output: "7\n" },
	});
	const result = checkProjectMapIntegrationFreshness({ cwd: "/projects/shop", run, target: "main", baseCommit: "a".repeat(40) });
	assert.equal(result.check, "verified");
	assert.equal(result.behindBy, 7);
});

test("a base the target does not contain is a mismatch, because the branch has diverged", () => {
	const { run } = executor({ "merge-base --is-ancestor": { ok: false, reason: "exit 1" } });
	const result = checkProjectMapIntegrationFreshness({ cwd: "/projects/shop", run, target: "main", baseCommit: "a".repeat(40) });
	assert.equal(result.check, "mismatched");
	assert.equal(result.behindBy, null);
	assert.match(result.reason!, /diverged|not contained/i);
});

test("a git failure while measuring freshness is unverified, never a pass", () => {
	const { run } = executor({ "merge-base --is-ancestor": { ok: true, output: "" }, "rev-list --count": { ok: false, reason: "boom" } });
	const result = checkProjectMapIntegrationFreshness({ cwd: "/projects/shop", run, target: "main", baseCommit: "a".repeat(40) });
	assert.equal(result.check, "unverified");
	assert.equal(result.behindBy, null);
});

test("two candidates touching the same path are both a likely conflict, and the path is named", () => {
	const { run } = executor({
		"diff --name-only main...feat/catalog": { ok: true, output: "lib/a.ts\nlib/b.ts\n" },
		"diff --name-only main...feat/checkout": { ok: true, output: "lib/b.ts\nlib/c.ts\n" },
	});
	const result = checkProjectMapIntegrationOverlap({
		cwd: "/projects/shop",
		run,
		target: "main",
		candidates: [
			{ capabilityId: "catalog", branch: "feat/catalog" },
			{ capabilityId: "checkout", branch: "feat/checkout" },
		],
	});
	assert.equal(result.get("catalog")!.check, "mismatched");
	assert.equal(result.get("checkout")!.check, "mismatched");
	assert.deepEqual(result.get("catalog")!.overlaps, ["lib/b.ts"]);
	assert.deepEqual(result.get("checkout")!.overlaps, ["lib/b.ts"]);
});

test("candidates touching nothing in common are verified", () => {
	const { run } = executor({
		"diff --name-only main...feat/catalog": { ok: true, output: "lib/a.ts\n" },
		"diff --name-only main...feat/checkout": { ok: true, output: "lib/c.ts\n" },
	});
	const result = checkProjectMapIntegrationOverlap({
		cwd: "/projects/shop",
		run,
		target: "main",
		candidates: [
			{ capabilityId: "catalog", branch: "feat/catalog" },
			{ capabilityId: "checkout", branch: "feat/checkout" },
		],
	});
	assert.equal(result.get("catalog")!.check, "verified");
	assert.equal(result.get("checkout")!.check, "verified");
	assert.deepEqual(result.get("catalog")!.overlaps, []);
});

test("a candidate with no branch is unverified, because nothing could be compared", () => {
	const { run, calls } = executor({});
	const result = checkProjectMapIntegrationOverlap({ cwd: "/projects/shop", run, target: "main", candidates: [{ capabilityId: "catalog", branch: null }] });
	assert.equal(result.get("catalog")!.check, "unverified");
	assert.deepEqual(calls, []);
});

test("one candidate's git failure does not make another candidate unverified", () => {
	const { run } = executor({
		"diff --name-only main...feat/catalog": { ok: false, reason: "unknown revision" },
		"diff --name-only main...feat/checkout": { ok: true, output: "lib/c.ts\n" },
	});
	const result = checkProjectMapIntegrationOverlap({
		cwd: "/projects/shop",
		run,
		target: "main",
		candidates: [
			{ capabilityId: "catalog", branch: "feat/catalog" },
			{ capabilityId: "checkout", branch: "feat/checkout" },
		],
	});
	assert.equal(result.get("catalog")!.check, "unverified");
	assert.equal(result.get("checkout")!.check, "verified");
});

test("every shared path is named, in a deterministic order", () => {
	const { run } = executor({
		"diff --name-only main...feat/catalog": { ok: true, output: "lib/z.ts\nlib/a.ts\nlib/m.ts\n" },
		"diff --name-only main...feat/checkout": { ok: true, output: "lib/m.ts\nlib/z.ts\nlib/a.ts\n" },
	});
	const result = checkProjectMapIntegrationOverlap({
		cwd: "/projects/shop",
		run,
		target: "main",
		candidates: [
			{ capabilityId: "catalog", branch: "feat/catalog" },
			{ capabilityId: "checkout", branch: "feat/checkout" },
		],
	});
	assert.deepEqual(result.get("catalog")!.overlaps, ["lib/a.ts", "lib/m.ts", "lib/z.ts"]);
});

test("overlap is unverified when the integration target is unknown", () => {
	const { run, calls } = executor({});
	const result = checkProjectMapIntegrationOverlap({ cwd: "/projects/shop", run, target: null, candidates: [{ capabilityId: "catalog", branch: "feat/catalog" }] });
	assert.equal(result.get("catalog")!.check, "unverified");
	assert.deepEqual(calls, []);
});
