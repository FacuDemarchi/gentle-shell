import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomicallySync } from "./agent-profiles.ts";
import { appendProjectMapStoreHistory, pruneProjectMapStoreHistory } from "./project-map-store-history.ts";
import { qualifiedNodeFsLockPlatformV1 } from "./review-lock.ts";
import { isIsoInstant } from "./shell-project-map-schema.ts";
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

export interface ProjectMapStoreEmptinessResult {
	empty: boolean;
	diagnostics: ProjectMapStoreDiagnostic[];
}

export interface ProjectMapStoreQuarantineResult {
	quarantined: string | null;
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

interface StoreEmptinessInspection extends ProjectMapStoreEmptinessResult {
	claims: number;
	heartbeats: number;
	quarantine: string | null;
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
	const canonical = serializeProjectMapStoreValue("descriptor", parsed.record);
	if (canonical.record !== bytes) {
		return {
			descriptor: null,
			status: "corrupted",
			diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_CORRUPTED, "Store descriptor is not in canonical form.")],
			bytes,
		};
	}
	return { descriptor: parsed.record as ProjectMapStoreDescriptorV1, status: "ready", diagnostics: [], bytes };
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

function unreadableDirectoryDiagnostic(path: string): ProjectMapStoreDiagnostic {
	return diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, `Store directory "${path}" could not be read.`);
}

function inspectStoreEmptiness(root: string): StoreEmptinessInspection {
	let rootEntries: string[];
	try {
		rootEntries = readdirSync(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { empty: true, diagnostics: [], claims: 0, heartbeats: 0, quarantine: null };
		return { empty: false, diagnostics: [unreadableDirectoryDiagnostic(root)], claims: 0, heartbeats: 0, quarantine: null };
	}
	const diagnostics: ProjectMapStoreDiagnostic[] = [];
	const countEntries = (path: string): number => {
		try {
			return readdirSync(path).length;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
			diagnostics.push(unreadableDirectoryDiagnostic(path));
			return 0;
		}
	};
	const claims = countEntries(join(root, "claims"));
	const heartbeats = countEntries(join(root, "heartbeats"));
	const quarantine = rootEntries.find((entry) => /^store\.corrupt\..*\.json$/.test(entry)) ?? null;
	return { empty: diagnostics.length === 0 && claims === 0 && heartbeats === 0 && quarantine === null, diagnostics, claims, heartbeats, quarantine };
}

export function storeIsProvablyEmpty(root: string): ProjectMapStoreEmptinessResult {
	const { claims: _claims, heartbeats: _heartbeats, quarantine: _quarantine, ...result } = inspectStoreEmptiness(root);
	return result;
}

function storeNotEmptyDiagnostic(inspection: StoreEmptinessInspection): ProjectMapStoreDiagnostic {
	const found: string[] = [];
	if (inspection.claims > 0) found.push(`${inspection.claims} entr${inspection.claims === 1 ? "y" : "ies"} under claims/`);
	if (inspection.heartbeats > 0) found.push(`${inspection.heartbeats} entr${inspection.heartbeats === 1 ? "y" : "ies"} under heartbeats/`);
	if (inspection.quarantine !== null) found.push(`quarantine file ${inspection.quarantine}`);
	return diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.STORE_NOT_EMPTY, `Store is not empty: found ${found.join(", ")}.`);
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
		const emptiness = inspectStoreEmptiness(options.root);
		if (emptiness.diagnostics.length > 0) return { descriptor: null, diagnostics: emptiness.diagnostics };
		if (!emptiness.empty) return { descriptor: null, diagnostics: [storeNotEmptyDiagnostic(emptiness)] };
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

export function quarantineProjectMapStore(options: { root: string; now: string }): ProjectMapStoreQuarantineResult {
	if (!isIsoInstant(options.now)) {
		return {
			quarantined: null,
			diagnostics: [{ code: PROJECT_MAP_STORE_DIAGNOSTIC_CODES.INVALID_FIELD, path: "$.now", message: "Expected an ISO-8601 instant.", severity: "error" }],
		};
	}
	const source = descriptorPath(options.root);
	const destination = join(options.root, `store.corrupt.${options.now.replace(/[:.]/g, "-")}.json`);
	if (existsSync(destination)) return { quarantined: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.QUARANTINE_EXISTS, "Store quarantine destination already exists.")] };
	try {
		readFileSync(source, "utf8");
	} catch (error) {
		const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? "Store descriptor is absent; nothing to quarantine." : "Store descriptor could not be quarantined.";
		return { quarantined: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, message)] };
	}
	try {
		qualifiedNodeFsLockPlatformV1().moveNoReplace(source, destination);
		return { quarantined: destination, diagnostics: [] };
	} catch {
		if (existsSync(destination)) return { quarantined: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.QUARANTINE_EXISTS, "Store quarantine destination already exists.")] };
		return { quarantined: null, diagnostics: [diagnostic(PROJECT_MAP_STORE_DIAGNOSTIC_CODES.UNREADABLE_STORE, "Store descriptor could not be quarantined.")] };
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
