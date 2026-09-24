import { createHash } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomicallySync } from "./agent-profiles.ts";
import {
	PROJECT_MAP_STORE_DIAGNOSTIC_CODES,
	parseProjectMapStoreValue,
	serializeProjectMapStoreValue,
	type ProjectMapStoreDescriptorV1,
	type ProjectMapStoreDiagnostic,
} from "./project-map-store-schema.ts";

export const PROJECT_MAP_STORE_HISTORY_LIMIT = 20;

export type ProjectMapStoreDescriptorStatus = "ready" | "missing" | "unreadable" | "corrupted";

export interface ProjectMapStoreDescriptorReadResult {
	descriptor: ProjectMapStoreDescriptorV1 | null;
	status: ProjectMapStoreDescriptorStatus;
	diagnostics: ProjectMapStoreDiagnostic[];
}

export interface ProjectMapStoreHistoryResult {
	history: ProjectMapStoreDescriptorV1[];
	diagnostics: ProjectMapStoreDiagnostic[];
}

export interface ProjectMapStoreMutationResult {
	descriptor: ProjectMapStoreDescriptorV1 | null;
	diagnostics: ProjectMapStoreDiagnostic[];
}

export interface ProjectMapStoreExpectedDescriptor {
	generation: number;
	epoch: string;
	predecessor: string;
}

export interface InitializeProjectMapStoreOptions {
	root: string;
	repositoryId: string;
	epoch: string;
	now: string;
}

export interface AdvanceProjectMapStoreOptions {
	root: string;
	expected: ProjectMapStoreExpectedDescriptor;
	now: string;
	apply: (descriptor: ProjectMapStoreDescriptorV1) => ProjectMapStoreDescriptorV1 | void;
}

interface DescriptorFileRead extends ProjectMapStoreDescriptorReadResult {
	bytes: string | null;
}

interface HistoryEntry {
	path: string;
	descriptor: ProjectMapStoreDescriptorV1;
}

function descriptorPath(root: string): string {
	return join(root, "store.json");
}

function historyPath(root: string, descriptor: ProjectMapStoreDescriptorV1): string {
	return join(root, "history", `${descriptor.generation}-${descriptor.epoch}.json`);
}

function diagnostic(code: ProjectMapStoreDiagnostic["code"], message: string): ProjectMapStoreDiagnostic {
	return { code, path: "$", message, severity: "error" };
}

function hash(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readDescriptorFile(root: string): DescriptorFileRead {
	let bytes: string;
	try {
		bytes = readFileSync(descriptorPath(root), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { descriptor: null, status: "missing", diagnostics: [], bytes: null };
		return { descriptor: null, status: "unreadable", diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store descriptor could not be read.")], bytes: null };
	}
	const parsed = parseProjectMapStoreValue("descriptor", bytes);
	if (parsed.record === null) {
		return {
			descriptor: null,
			status: "corrupted",
			diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED, "Store descriptor is corrupted."), ...parsed.diagnostics],
			bytes,
		};
	}
	return { descriptor: parsed.record, status: "ready", diagnostics: [], bytes };
}

function staleDiagnostic(observed: number | null, expected: number): ProjectMapStoreDiagnostic {
	return diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STALE_GENERATION, `Store generation is ${observed === null ? "unavailable" : observed}; expected ${expected}.`);
}

function readHistoryEntries(root: string): { entries: HistoryEntry[]; diagnostics: ProjectMapStoreDiagnostic[] } {
	let names: string[];
	try {
		names = readdirSync(join(root, "history"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], diagnostics: [] };
		return { entries: [], diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store history could not be read.")] };
	}
	const entries: HistoryEntry[] = [];
	const diagnostics: ProjectMapStoreDiagnostic[] = [];
	for (const name of names.sort()) {
		const path = join(root, "history", name);
		let bytes: string;
		try {
			bytes = readFileSync(path, "utf8");
		} catch {
			diagnostics.push(diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, `Store history entry "${name}" could not be read.`));
			continue;
		}
		const parsed = parseProjectMapStoreValue("descriptor", bytes);
		if (parsed.record === null) {
			diagnostics.push(diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED, `Store history entry "${name}" is corrupted.`));
			continue;
		}
		entries.push({ path, descriptor: parsed.record });
	}
	entries.sort((left, right) => left.descriptor.generation - right.descriptor.generation || left.descriptor.epoch.localeCompare(right.descriptor.epoch));
	return { entries, diagnostics };
}

function writeDescriptor(path: string, descriptor: ProjectMapStoreDescriptorV1): ProjectMapStoreMutationResult {
	const serialized = serializeProjectMapStoreValue("descriptor", descriptor);
	if (serialized.record === null) return { descriptor: null, diagnostics: serialized.diagnostics };
	try {
		writeJsonFileAtomicallySync(path, serialized.record);
		return { descriptor, diagnostics: [] };
	} catch {
		return { descriptor: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store descriptor could not be written.")] };
	}
}

function pruneHistory(root: string): ProjectMapStoreDiagnostic[] {
	const history = readHistoryEntries(root);
	const diagnostics = [...history.diagnostics];
	for (const entry of history.entries.slice(0, Math.max(0, history.entries.length - PROJECT_MAP_STORE_HISTORY_LIMIT))) {
		try {
			unlinkSync(entry.path);
		} catch {
			diagnostics.push(diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store history entry could not be pruned."));
		}
	}
	return diagnostics;
}

export function readProjectMapStoreDescriptor(root: string): ProjectMapStoreDescriptorReadResult {
	const { bytes: _bytes, ...result } = readDescriptorFile(root);
	return result;
}

export function initializeProjectMapStore(options: InitializeProjectMapStoreOptions): ProjectMapStoreMutationResult {
	try {
		const existing = readDescriptorFile(options.root);
		if (existing.status === "ready") return { descriptor: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_EXISTS, "Store descriptor already exists.")] };
		if (existing.status !== "missing") return { descriptor: null, diagnostics: existing.diagnostics };
		const descriptor: ProjectMapStoreDescriptorV1 = {
			schema: "gentle-shell.project-map-store/v1",
			kind: "descriptor",
			repository_id: options.repositoryId,
			generation: 0,
			epoch: options.epoch,
			predecessor: null,
			created_at: options.now,
			updated_at: options.now,
		};
		return writeDescriptor(descriptorPath(options.root), descriptor);
	} catch {
		return { descriptor: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store descriptor could not be initialized.")] };
	}
}

export function advanceProjectMapStore(options: AdvanceProjectMapStoreOptions): ProjectMapStoreMutationResult {
	try {
		const observed = readDescriptorFile(options.root);
		if (observed.status !== "ready" || observed.descriptor === null || observed.bytes === null) return { descriptor: null, diagnostics: observed.diagnostics };
		if (
			observed.descriptor.generation !== options.expected.generation
			|| observed.descriptor.epoch !== options.expected.epoch
			|| hash(observed.bytes) !== options.expected.predecessor
		) return { descriptor: null, diagnostics: [staleDiagnostic(observed.descriptor.generation, options.expected.generation)] };

		const successor: ProjectMapStoreDescriptorV1 = {
			...observed.descriptor,
			generation: observed.descriptor.generation + 1,
			predecessor: hash(observed.bytes),
			updated_at: options.now,
		};
		const applied = options.apply({ ...successor });
		const candidate = applied === undefined ? successor : applied;
		if (
			candidate.generation !== successor.generation
			|| candidate.epoch !== successor.epoch
			|| candidate.predecessor !== successor.predecessor
			|| candidate.created_at !== successor.created_at
			|| candidate.repository_id !== successor.repository_id
		) return { descriptor: null, diagnostics: [staleDiagnostic(observed.descriptor.generation, options.expected.generation)] };
		candidate.updated_at = options.now;

		const serializedHistory = serializeProjectMapStoreValue("descriptor", observed.descriptor);
		if (serializedHistory.record === null) return { descriptor: null, diagnostics: serializedHistory.diagnostics };
		try {
			writeJsonFileAtomicallySync(historyPath(options.root, observed.descriptor), serializedHistory.record);
		} catch {
			return { descriptor: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store history could not be written.")] };
		}
		const historyDiagnostics = pruneHistory(options.root);
		const written = writeDescriptor(descriptorPath(options.root), candidate);
		return { descriptor: written.descriptor, diagnostics: [...historyDiagnostics, ...written.diagnostics] };
	} catch {
		return { descriptor: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store descriptor could not be advanced.")] };
	}
}

export function readProjectMapStoreHistory(root: string, limit: number): ProjectMapStoreHistoryResult {
	try {
		const result = readHistoryEntries(root);
		const bounded = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
		return { history: result.entries.slice(0, bounded).map((entry) => entry.descriptor), diagnostics: result.diagnostics };
	} catch {
		return { history: [], diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store history could not be read.")] };
	}
}
