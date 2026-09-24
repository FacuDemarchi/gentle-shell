import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	advanceProjectMapStore,
	initializeProjectMapStore,
	readProjectMapStoreDescriptor,
} from "../lib/project-map-store.ts";
import * as projectMapStore from "../lib/project-map-store.ts";
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

test("refuses every non-ready descriptor status with a diagnostic", () => {
	withRoot((root) => {
		const cases: Array<{ status: "missing" | "unreadable" | "corrupted"; code: string; prepare: () => void }> = [
			{ status: "missing", code: PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STALE_GENERATION, prepare: () => {} },
			{ status: "corrupted", code: PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED, prepare: () => writeFileSync(join(root, "store.json"), "{ not json", "utf8") },
			{ status: "unreadable", code: PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, prepare: () => mkdirSync(join(root, "store.json")) },
		];
		for (const entry of cases) {
			entry.prepare();
			const result = advanceProjectMapStore({
				root,
				expected: { generation: 0, epoch: EPOCH, predecessor: `sha256:${"b".repeat(64)}` },
				now: UPDATED_AT,
			});
			assert.equal(readProjectMapStoreDescriptor(root).status, entry.status);
			assert.ok(result.diagnostics.length > 0);
			assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === entry.code));
			if (entry.status !== "missing") rmSync(join(root, "store.json"), { recursive: true });
		}
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

test("writes exactly the successor descriptor and no caller fields", () => {
	withRoot((root) => {
		const initial = initialize(root);
		const before = readFileSync(join(root, "store.json"), "utf8");
		const result = advance(root, initial);
		const successor = {
			schema: "gentle-shell.project-map-store/v1",
			kind: "descriptor",
			repository_id: REPOSITORY_ID,
			generation: 1,
			epoch: EPOCH,
			predecessor: digest(before),
			created_at: CREATED_AT,
			updated_at: UPDATED_AT,
		};
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.descriptor, successor);
		const serialized = JSON.parse(readFileSync(join(root, "store.json"), "utf8"));
		assert.deepEqual(serialized, successor);
		assert.deepEqual(Object.keys(serialized), ["schema", "kind", "repository_id", "generation", "epoch", "predecessor", "created_at", "updated_at"]);
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

test("does not prune history when a swap fails after archiving", () => {
	withRoot((root) => {
		let descriptor = initialize(root);
		for (let generation = 1; generation <= 20; generation += 1) {
			const result = advance(root, descriptor, `2026-09-24T12:${String(generation).padStart(2, "0")}:00Z`);
			assert.ok(result.descriptor);
			descriptor = result.descriptor;
		}
		mkdirSync(join(root, "history"), { recursive: true });
		chmodSync(root, 0o500);
		let result: ReturnType<typeof advanceProjectMapStore>;
		try {
			result = advance(root, descriptor, "2026-09-24T23:59:59Z");
		} finally {
			chmodSync(root, 0o700);
		}
		assert.equal(result!.descriptor, null);
		assert.ok(result!.diagnostics.some((diagnostic) => diagnostic.code === PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE));
		const generations = readdirSync(join(root, "history"))
			.map((name) => Number.parseInt(name.split("-", 1)[0], 10))
			.sort((left, right) => left - right);
		assert.deepEqual(generations, Array.from({ length: 21 }, (_, generation) => generation));
	});
});

test("classifies a valid non-canonical descriptor as corrupted and refuses advancement", () => {
	withRoot((root) => {
		const descriptor = initialize(root);
		writeFileSync(join(root, "store.json"), JSON.stringify(descriptor), "utf8");
		const read = readProjectMapStoreDescriptor(root);
		assert.equal(read.status, "corrupted");
		assert.deepEqual(read.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED]);
		const advanced = advance(root, descriptor);
		assert.equal(advanced.descriptor, null);
		assert.deepEqual(advanced.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED]);
	});
});

test("proves a fresh store root is empty", () => {
	withRoot((root) => {
		const result = projectMapStore.storeIsProvablyEmpty(root);
		assert.deepEqual(result, { empty: true, diagnostics: [] });
	});
});

test("finds claim, heartbeat, and quarantine evidence in a store root", () => {
	withRoot((root) => {
		const claims = join(root, "claims");
		mkdirSync(claims);
		writeFileSync(join(claims, "capability.json"), "{}", "utf8");
		assert.equal(projectMapStore.storeIsProvablyEmpty(root).empty, false);
		rmSync(claims, { recursive: true });

		const heartbeats = join(root, "heartbeats");
		mkdirSync(heartbeats);
		writeFileSync(join(heartbeats, "session.json"), "{}", "utf8");
		assert.equal(projectMapStore.storeIsProvablyEmpty(root).empty, false);
		rmSync(heartbeats, { recursive: true });

		writeFileSync(join(root, "store.corrupt.2026-09-24T12-00-00-000Z.json"), "evidence", "utf8");
		assert.equal(projectMapStore.storeIsProvablyEmpty(root).empty, false);
	});
});

test("fails closed when a record directory cannot be read", () => {
	withRoot((root) => {
		writeFileSync(join(root, "claims"), "not a directory", "utf8");
		const result = projectMapStore.storeIsProvablyEmpty(root);
		assert.equal(result.empty, false);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE]);
	});
});

test("refuses initialization over claim evidence without changing the root", () => {
	withRoot((root) => {
		const claims = join(root, "claims");
		mkdirSync(claims);
		const claim = join(claims, "capability.json");
		writeFileSync(claim, "evidence", "utf8");
		const result = initializeProjectMapStore({ root, repositoryId: REPOSITORY_ID, epoch: EPOCH, now: CREATED_AT });
		assert.equal(result.descriptor, null);
		assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_NOT_EMPTY]);
		assert.equal(readFileSync(claim, "utf8"), "evidence");
		assert.deepEqual(readdirSync(root), ["claims"]);
	});
});

test("quarantines byte-identical evidence without overwriting an existing destination", () => {
	withRoot((root) => {
		const source = join(root, "store.json");
		const bytes = "{ invalid evidence\n";
		const now = "2026-09-24T12:00:00.000Z";
		const destination = join(root, "store.corrupt.2026-09-24T12-00-00-000Z.json");
		writeFileSync(source, bytes, "utf8");
		const quarantined = projectMapStore.quarantineProjectMapStore({ root, now });
		assert.equal(quarantined.quarantined, destination);
		assert.deepEqual(quarantined.diagnostics, []);
		assert.equal(existsSync(source), false);
		assert.equal(readFileSync(destination, "utf8"), bytes);
		const second = projectMapStore.quarantineProjectMapStore({ root, now });
		assert.equal(second.quarantined, null);
		assert.deepEqual(second.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.QUARANTINE_EXISTS]);
		assert.equal(readFileSync(destination, "utf8"), bytes);
	});
});

test("requires removal of quarantined evidence before initialization", () => {
	withRoot((root) => {
		const now = "2026-09-24T12:00:00.000Z";
		const source = join(root, "store.json");
		writeFileSync(source, "{ invalid evidence\n", "utf8");
		const quarantined = projectMapStore.quarantineProjectMapStore({ root, now });
		assert.ok(quarantined.quarantined);
		const blocked = initializeProjectMapStore({ root, repositoryId: REPOSITORY_ID, epoch: EPOCH, now: CREATED_AT });
		assert.equal(blocked.descriptor, null);
		assert.deepEqual(blocked.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_NOT_EMPTY]);
		assert.match(blocked.diagnostics[0].message, /store\.corrupt\.2026-09-24T12-00-00-000Z\.json/);
		rmSync(quarantined.quarantined!);
		assert.ok(initializeProjectMapStore({ root, repositoryId: REPOSITORY_ID, epoch: EPOCH, now: CREATED_AT }).descriptor);
	});
});

test("refuses quarantine for a missing descriptor or invalid instant without moving evidence", () => {
	withRoot((root) => {
		const missing = projectMapStore.quarantineProjectMapStore({ root, now: CREATED_AT });
		assert.equal(missing.quarantined, null);
		assert.deepEqual(missing.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE]);

		const source = join(root, "store.json");
		writeFileSync(source, "evidence", "utf8");
		const invalid = projectMapStore.quarantineProjectMapStore({ root, now: "not-an-instant" });
		assert.equal(invalid.quarantined, null);
		assert.deepEqual(invalid.diagnostics.map((diagnostic) => diagnostic.code), [PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD]);
		assert.equal(invalid.diagnostics[0].path, "$.now");
		assert.equal(readFileSync(source, "utf8"), "evidence");
	});
});
