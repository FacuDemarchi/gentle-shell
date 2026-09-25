import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	bindProjectMapStoreWorktree,
	listProjectMapStoreWorktreeBindings,
	readProjectMapStoreWorktreeBinding,
} from "../lib/project-map-store-worktrees.ts";
import { initializeProjectMapStore } from "../lib/project-map-store.ts";
import {
	PROJECT_MAP_STORE_DIAGNOSTIC_CODES,
	serializeProjectMapStoreValue,
	type ProjectMapStoreWorktreeBindingV1,
} from "../lib/project-map-store-schema.ts";

const REPOSITORY_ID = `sha256:${"a".repeat(64)}`;
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-25T12:00:00.000Z";
const BASE_COMMIT = "a".repeat(40);
const OTHER_BASE_COMMIT = "b".repeat(64);

function bindingPath(root: string, capabilityId: string): string {
	return join(root, "worktrees", `${createHash("sha256").update(capabilityId).digest("hex")}.json`);
}

function withRoot(run: (root: string, sandbox: string) => void): void {
	const sandbox = mkdtempSync(join(tmpdir(), "project-map-store-worktree-bindings-"));
	const root = join(sandbox, "isolated", "project-map", "store");
	mkdirSync(root, { recursive: true });
	try {
		run(root, sandbox);
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
}

function initialize(root: string): void {
	const result = initializeProjectMapStore({ root, repositoryId: REPOSITORY_ID, epoch: EPOCH, now: NOW });
	assert.ok(result.descriptor, result.diagnostics.map((entry) => entry.message).join("\n"));
	assert.deepEqual(result.diagnostics, []);
}

function bind(root: string, overrides: Partial<Parameters<typeof bindProjectMapStoreWorktree>[0]> = {}) {
	return bindProjectMapStoreWorktree({
		root,
		capabilityId: "project-map",
		branch: "feat/project-map",
		worktreeRoot: "/workspace/project-map-worktrees/project-map",
		sessionId: "session-a",
		baseCommit: BASE_COMMIT,
		now: NOW,
		...overrides,
	});
}

function codes(result: { diagnostics: { code: string }[] }): string[] {
	return result.diagnostics.map((entry) => entry.code);
}

function binding(capabilityId = "project-map", overrides: Partial<ProjectMapStoreWorktreeBindingV1> = {}): ProjectMapStoreWorktreeBindingV1 {
	return {
		schema: "gentle-shell.project-map-store/v1",
		kind: "worktree-binding",
		capability_id: capabilityId,
		branch: "feat/project-map",
		worktree_root: "/workspace/project-map-worktrees/project-map",
		session_id: "session-a",
		base_commit: BASE_COMMIT,
		created_at: NOW,
		...overrides,
	};
}

function fileIdentity(path: string): { ino: number; mtimeMs: number } {
	const stat = statSync(path);
	return { ino: stat.ino, mtimeMs: stat.mtimeMs };
}

test("writes and reads a worktree binding in canonical form", () => {
	withRoot((root) => {
		initialize(root);
		const written = bind(root);
		assert.deepEqual(written.diagnostics, []);
		assert.deepEqual(written.binding, binding());
		assert.equal(readFileSync(bindingPath(root, "project-map"), "utf8"), serializeProjectMapStoreValue("worktree-binding", binding()).record);
		const read = readProjectMapStoreWorktreeBinding({ root, capabilityId: "project-map" });
		assert.equal(read.status, "bound");
		assert.deepEqual(read.binding, binding());
		assert.deepEqual(read.diagnostics, []);
	});
});

test("treats an identical worktree bind as an idempotent no-op", () => {
	withRoot((root) => {
		initialize(root);
		assert.ok(bind(root).binding);
		const path = bindingPath(root, "project-map");
		const before = readFileSync(path, "utf8");
		const beforeIdentity = fileIdentity(path);
		const repeated = bind(root);
		assert.deepEqual(repeated.binding, binding());
		assert.deepEqual(repeated.diagnostics, []);
		assert.equal(readFileSync(path, "utf8"), before);
		assert.deepEqual(fileIdentity(path), beforeIdentity);
	});
});

test("treats a later identical worktree bind as an idempotent no-op", () => {
	withRoot((root) => {
		initialize(root);
		assert.ok(bind(root).binding);
		const path = bindingPath(root, "project-map");
		const before = readFileSync(path, "utf8");
		const beforeIdentity = fileIdentity(path);
		const repeated = bind(root, { now: "2026-09-25T12:01:00.000Z" });
		assert.deepEqual(repeated.binding, binding());
		assert.deepEqual(repeated.diagnostics, []);
		assert.equal(readFileSync(path, "utf8"), before);
		assert.deepEqual(fileIdentity(path), beforeIdentity);
	});
});

test("refuses every conflicting worktree bind and preserves the first record bytes", () => {
	withRoot((root) => {
		initialize(root);
		assert.ok(bind(root).binding);
		const path = bindingPath(root, "project-map");
		const before = readFileSync(path, "utf8");
		for (const overrides of [
			{ branch: "feat/other-capability" },
			{ worktreeRoot: "/workspace/project-map-worktrees/other" },
			{ sessionId: "session-b" },
			{ baseCommit: OTHER_BASE_COMMIT },
		]) {
			const refused = bind(root, overrides);
			assert.equal(refused.binding, null);
			assert.deepEqual(codes(refused), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.WORKTREE_ALREADY_BOUND]);
			assert.equal(readFileSync(path, "utf8"), before);
		}
	});
});
