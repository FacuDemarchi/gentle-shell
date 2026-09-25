import {
	PROJECT_MAP_DIAGNOSTIC_CODES,
	readProjectMapFile,
	validateProjectMap,
	type ProjectMapDiagnostic,
	type ProjectMapV1,
} from "./shell-project-map-schema.ts";
import { writeProjectMapFile } from "./shell-project-map-approval.ts";

export interface ApplyProjectMapContractRequest {
	path: string;
	capabilityId: string;
	contractId: string;
	supersedes?: string;
}

export interface ApplyProjectMapContractOutcome {
	applied: boolean;
	removed: boolean;
	map: ProjectMapV1 | null;
	diagnostics: ProjectMapDiagnostic[];
}

function refusal(path: string, message: string): ProjectMapDiagnostic {
	return { code: PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, path, message, severity: "error" };
}

function failed(diagnostics: ProjectMapDiagnostic[]): ApplyProjectMapContractOutcome {
	return { applied: false, removed: false, map: null, diagnostics };
}

/**
 * Applies one durable contract decision to the only mutable part of an approved Project
 * Map. The caller owns the durable decision; this bounded writer records no evidence.
 */
export function applyProjectMapContract(request: ApplyProjectMapContractRequest): ApplyProjectMapContractOutcome {
	const read = readProjectMapFile(request.path);
	if (read.map === null) return failed(read.diagnostics);
	const map = read.map;
	if (map.approval.state !== "approved") {
		return failed([refusal("$.approval.state", "Applying a shared contract requires an approved Project Map.")]);
	}
	const capabilityIndex = map.capabilities.findIndex((capability) => capability.id === request.capabilityId);
	if (capabilityIndex < 0) {
		return failed([refusal("$.capabilities", `No capability named "${request.capabilityId}" is declared.`)]);
	}
	if (typeof request.contractId !== "string" || request.contractId.trim().length === 0) {
		return failed([refusal(`$.capabilities[${capabilityIndex}].contracts`, "Applying a shared contract requires a non-empty contract id.")]);
	}
	if (request.supersedes !== undefined && (typeof request.supersedes !== "string" || request.supersedes.trim().length === 0)) {
		return failed([refusal(`$.capabilities[${capabilityIndex}].contracts`, "A superseded contract id must be non-empty when provided.")]);
	}

	const capability = map.capabilities[capabilityIndex];
	const applied = !capability.contracts.includes(request.contractId);
	const removed = request.supersedes !== undefined
		&& request.supersedes !== request.contractId
		&& capability.contracts.includes(request.supersedes);
	if (!applied && !removed) return { applied: false, removed: false, map, diagnostics: [] };

	const contracts = capability.contracts
		.filter((contract) => contract !== request.supersedes);
	if (applied) contracts.push(request.contractId);
	const candidate: ProjectMapV1 = {
		...map,
		capabilities: map.capabilities.map((entry, index) => index === capabilityIndex ? { ...entry, contracts } : entry),
	};
	const validated = validateProjectMap(candidate);
	if (validated.map === null) return failed(validated.diagnostics);

	const written = writeProjectMapFile(request.path, validated.map);
	if (!written.ok) return failed(written.diagnostics);
	return { applied, removed, map: validated.map, diagnostics: written.diagnostics };
}
