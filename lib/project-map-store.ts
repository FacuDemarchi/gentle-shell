import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomicallySync } from "./agent-profiles.ts";
import { appendProjectMapStoreHistory, pruneProjectMapStoreHistory } from "./project-map-store-history.ts";
import {
	PROJECT_MAP_STORE_DIAGNOSTIC_CODES,
	parseProjectMapStoreValue,
	serializeProjectMapStoreValue,
	type ProjectMapStoreDescriptorV1,
	type ProjectMapStoreDiagnostic,
} from "./project-map-store-schema.ts";

export type ProjectMapStoreDescriptorStatus = "ready" | "missing" | "unreadable" | "corrupted";

export interface ProjectMapStoreDescriptorReadResult {
	descriptor: ProjectMapStoreDescriptorV1 | null;
	status: ProjectMapStoreDescriptorStatus;
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
}

interface DescriptorFileRead extends ProjectMapStoreDescriptorReadResult {
	bytes: string | null;
}

function descriptorPath(root: string): string {
	return join(root, "store.json");
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
		if (observed.status !== "ready" || observed.descriptor === null || observed.bytes === null) {
			return { descriptor: null, diagnostics: observed.status === "missing" ? [staleDiagnostic(null, options.expected.generation)] : observed.diagnostics };
		}
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
		const archiveDiagnostics = appendProjectMapStoreHistory(options.root, observed.descriptor);
		if (archiveDiagnostics.length > 0) return { descriptor: null, diagnostics: archiveDiagnostics };
		const written = writeDescriptor(descriptorPath(options.root), successor);
		if (written.descriptor === null) return { descriptor: null, diagnostics: written.diagnostics };
		const pruneDiagnostics = pruneProjectMapStoreHistory(options.root);
		return { descriptor: written.descriptor, diagnostics: pruneDiagnostics };
	} catch {
		return { descriptor: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store descriptor could not be advanced.")] };
	}
}
