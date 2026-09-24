import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	PROJECT_MAP_STORE_HISTORY_LIMIT,
	advanceProjectMapStore,
	initializeProjectMapStore,
	readProjectMapStoreDescriptor,
	readProjectMapStoreHistory,
} from "../lib/project-map-store.ts";
import { PROJECT_MAP_STORE_DIAGNOSTIC_CODES, type ProjectMapStoreDescriptorV1 } from "../lib/project-map-store-schema.ts";

const REPOSITORY_ID = `sha256:${"a".repeat(64)}`;
const EPOCH = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_EPOCH = "123e4567-e89b-12d3-a456-426614174001";
const CREATED_AT = "2026-09-24T12:00:00Z";
const UPDATED_AT = "2026-09-24T12:01:00Z";

function digest(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function withRoot(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "project-map-store-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function initialize(root: string): ProjectMapStoreDescriptorV1 {
	const result = initializeProjectMapStore({ root, repositoryId: REPOSITORY_ID, epoch: EPOCH, now: CREATED_AT });
	assert.deepEqual(result.diagnostics, []);
	assert.ok(result.descriptor);
	return result.descriptor;
}

function advance(root: string, descriptor: ProjectMapStoreDescriptorV1, now = UPDATED_AT): ReturnType<typeof advanceProjectMapStore> {
	const bytes = readFileSync(join(root, "store.json"), "utf8");
	return advanceProjectMapStore({
		root,
		expected: { generation: descriptor.generation, epoch: descriptor.epoch, predecessor: digest(bytes) },
		now,
		apply: (successor) => successor,
	});
}

test("initializes then reads a descriptor round trip", () => {
	withRoot((root) => {
		const descriptor = initialize(root);
		assert.equal(descriptor.generation, 0);
		assert.equal(descriptor.predecessor, null);
		assert.equal(descriptor.created_at, CREATED_AT);
		assert.equal(descriptor.updated_at, CREATED_AT);

		const read = readProjectMapStoreDescriptor(root);
		assert.equal(read.status, "ready");
		assert.deepEqual(read.diagnostics, []);
		assert.deepEqual(read.descriptor, descriptor);
	});
});

test("classifies missing, unreadable, and corrupted descriptors without throwing", () => {
	withRoot((root) => {
		assert.equal(readProjectMapStoreDescriptor(root).status, "missing");
		writeFileSync(join(root, "store.json"), "{ not json", "utf8");
		const corrupted = readProjectMapStoreDescriptor(root);
		assert.equal(corrupted.status, "corrupted");
		assert.ok(corrupted.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED));
		rmSync(join(root, "store.json"));
		mkdirSync(join(root, "store.json"));
		assert.equal(readProjectMapStoreDescriptor(root).status, "unreadable");
	});
});

test("refuses initialization when a descriptor already exists", () => {
	withRoot((root) => {
		initialize(root);
		const result = initializeProjectMapStore({ root, repositoryId: REPOSITORY_ID, epoch: EPOCH, now: UPDATED_AT });
		assert.equal(result.descriptor, null);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_EXISTS]);
	});
});

test("advances a descriptor and chains the exact predecessor bytes", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const before = readFileSync(join(root, "store.json"), "utf8");
		const result = advance(root, initial);
		assert.deepEqual(result.diagnostics, []);
		assert.equal(result.descriptor?.generation, 1);
		assert.equal(result.descriptor?.epoch, EPOCH);
		assert.equal(result.descriptor?.predecessor, digest(before));
		assert.equal(result.descriptor?.created_at, CREATED_AT);
		assert.equal(result.descriptor?.updated_at, UPDATED_AT);
	});
});

test("refuses a stale generation without changing descriptor bytes", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const advanced = advance(root, initial);
		assert.ok(advanced.descriptor);
		const before = readFileSync(join(root, "store.json"), "utf8");
		const stale = advance(root, initial, "2026-09-24T12:02:00Z");
		assert.equal(stale.descriptor, null);
		assert.deepEqual(stale.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STALE_GENERATION]);
		assert.equal(readFileSync(join(root, "store.json"), "utf8"), before);
	});
});

test("refuses an epoch change even with a matching generation", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const before = readFileSync(join(root, "store.json"), "utf8");
		const result = advanceProjectMapStore({
			root,
			expected: { generation: initial.generation, epoch: OTHER_EPOCH, predecessor: digest(before) },
			now: UPDATED_AT,
			apply: (successor) => successor,
		});
		assert.equal(result.descriptor, null);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STALE_GENERATION]);
		assert.equal(readFileSync(join(root, "store.json"), "utf8"), before);
	});
});

test("refuses a mismatched predecessor digest even with a matching generation and epoch", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const before = readFileSync(join(root, "store.json"), "utf8");
		const result = advanceProjectMapStore({
			root,
			expected: { generation: initial.generation, epoch: initial.epoch, predecessor: `sha256:${"b".repeat(64)}` },
			now: UPDATED_AT,
			apply: (successor) => successor,
		});
		assert.equal(result.descriptor, null);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STALE_GENERATION]);
		assert.equal(readFileSync(join(root, "store.json"), "utf8"), before);
	});
});

test("uses the injected clock for each successor updated_at", () => {
	withRoot((root) => {
		const result = advance(root, initialize(root), "2026-09-24T23:59:59Z");
		assert.equal(result.descriptor?.updated_at, "2026-09-24T23:59:59Z");
	});
});

test("refuses an apply hook that changes protected descriptor fields", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const before = readFileSync(join(root, "store.json"), "utf8");
		const result = advanceProjectMapStore({
			root,
			expected: { generation: initial.generation, epoch: initial.epoch, predecessor: digest(before) },
			now: UPDATED_AT,
			apply: (successor) => ({ ...successor, generation: 99 }),
		});
		assert.equal(result.descriptor, null);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STALE_GENERATION]);
		assert.equal(readFileSync(join(root, "store.json"), "utf8"), before);
	});
});

test("appends each superseded descriptor to history", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const result = advance(root, initial);
		assert.ok(result.descriptor);
		const history = readProjectMapStoreHistory(root, 20);
		assert.deepEqual(history.diagnostics, []);
		assert.deepEqual(history.history.map((entry) => entry.generation), [0]);
		assert.ok(readdirSync(join(root, "history")).includes(`0-${EPOCH}.json`));
	});
});

test("prunes history oldest-first at the configured cap", () => {
	withRoot((root) => {
		let descriptor = initialize(root);
		for (let generation = 1; generation <= PROJECT_MAP_STORE_HISTORY_LIMIT + 1; generation += 1) {
			const result = advance(root, descriptor, `2026-09-24T12:${String(generation).padStart(2, "0")}:00Z`);
			assert.ok(result.descriptor);
			descriptor = result.descriptor;
		}
		const history = readProjectMapStoreHistory(root, PROJECT_MAP_STORE_HISTORY_LIMIT + 1);
		assert.equal(history.history.length, PROJECT_MAP_STORE_HISTORY_LIMIT);
		assert.deepEqual(history.history.map((entry) => entry.generation), Array.from({ length: PROJECT_MAP_STORE_HISTORY_LIMIT }, (_, index) => index + 1));
		assert.equal(readdirSync(join(root, "history")).length, PROJECT_MAP_STORE_HISTORY_LIMIT);
	});
});

test("reports an unparsable history file without blocking a swap", () => {
	withRoot((root) => {
		const initial = initialize(root);
		mkdirSync(join(root, "history"), { recursive: true });
		writeFileSync(join(root, "history", "broken.json"), "{ not json", "utf8");
		const result = advance(root, initial);
		assert.ok(result.descriptor);
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED));
	});
});
