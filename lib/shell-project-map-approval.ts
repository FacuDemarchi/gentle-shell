import { writeJsonFileAtomicallySync } from "./agent-profiles.ts";
import {
	PROJECT_MAP_DIAGNOSTIC_CODES,
	PROJECT_MAP_SURFACES,
	isIsoInstant,
	serializeProjectMap,
	validateProjectMap,
	type ProjectMapDiagnostic,
	type ProjectMapSurface,
	type ProjectMapV1,
} from "./shell-project-map-schema.ts";

export interface ProjectMapApprovalRequest {
	map: ProjectMapV1;
	approvedBy: string;
	approvedAt: string;
}

export interface ProjectMapApprovalOutcome {
	ok: boolean;
	map: ProjectMapV1 | null;
	diagnostics: ProjectMapDiagnostic[];
}

export interface ProjectMapSurfaceDeclarationRequest {
	map: ProjectMapV1;
	capabilityId: string;
	surfaces: string[];
}

export interface ProjectMapWriteOutcome {
	ok: boolean;
	path: string;
	diagnostics: ProjectMapDiagnostic[];
}

function refusal(code: ProjectMapDiagnostic["code"], path: string, message: string): ProjectMapDiagnostic {
	return { code, path, message, severity: "error" };
}

/**
 * Transitions a draft map to approved. This function performs no I/O and mutates
 * nothing: it returns a new canonical map or a refusal. Approval is a declaration of
 * plan authority only, so it starts no writer, touches no source, and authorizes no
 * commit, push, merge, or release.
 */
export function approveProjectMap(request: ProjectMapApprovalRequest): ProjectMapApprovalOutcome {
	const diagnostics: ProjectMapDiagnostic[] = [];
	const map = request.map;
	if (map.approval.state === "approved") {
		return {
			ok: false,
			map: null,
			diagnostics: [refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.approval.state", "This map is already approved; approval is not repeatable.")],
		};
	}
	if (typeof request.approvedBy !== "string" || request.approvedBy.trim().length === 0) {
		diagnostics.push(refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.approval.approvedBy", "Approval requires a non-empty actor identity."));
	}
	if (typeof request.approvedAt !== "string" || !isIsoInstant(request.approvedAt)) {
		diagnostics.push(refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.approval.approvedAt", "Approval requires an ISO-8601 instant."));
	}
	if (diagnostics.length > 0) return { ok: false, map: null, diagnostics };

	const candidate: ProjectMapV1 = {
		...map,
		approval: { state: "approved", approvedAt: request.approvedAt, approvedBy: request.approvedBy.trim() },
	};
	const validated = validateProjectMap(candidate);
	if (validated.map === null) return { ok: false, map: null, diagnostics: validated.diagnostics };
	return { ok: true, map: validated.map, diagnostics: validated.diagnostics };
}

/**
 * Replaces one draft capability's declared surfaces. A declaration is intentionally a
 * whole-list statement: accepting a repeated value would hide a typo in the plan the
 * human is being asked to make explicit.
 */
export function declareProjectMapSurfaces(request: ProjectMapSurfaceDeclarationRequest): ProjectMapApprovalOutcome {
	const map = request.map;
	if (map.approval.state === "approved") {
		return {
			ok: false,
			map: null,
			diagnostics: [refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.approval.state", "Declaring surfaces is a draft-time action; changing an approved plan requires returning it to draft, which this version does not support.")],
		};
	}
	if (typeof request.capabilityId !== "string" || request.capabilityId.trim().length === 0) {
		return {
			ok: false,
			map: null,
			diagnostics: [refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.capabilities", "Declaring surfaces requires a non-empty capability id.")],
		};
	}
	const capabilityIndex = map.capabilities.findIndex((capability) => capability.id === request.capabilityId);
	if (capabilityIndex < 0) {
		const ids = map.capabilities.map((capability) => capability.id).join(", ") || "none";
		return {
			ok: false,
			map: null,
			diagnostics: [refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, "$.capabilities", `No capability named "${request.capabilityId}" is declared; this map declares: ${ids}.`)],
		};
	}
	const seen = new Set<string>();
	let invalidSurface = false;
	for (const surface of request.surfaces) {
		if (!PROJECT_MAP_SURFACES.includes(surface as (typeof PROJECT_MAP_SURFACES)[number]) || seen.has(surface)) {
			invalidSurface = true;
			break;
		}
		seen.add(surface);
	}
	if (invalidSurface) {
		return {
			ok: false,
			map: null,
			diagnostics: [refusal(PROJECT_MAP_DIAGNOSTIC_CODES.INVALID_FIELD, `$.capabilities[${capabilityIndex}].surfaces`, `Surfaces must be unique entries from the supported vocabulary: ${PROJECT_MAP_SURFACES.join(", ")}.`)],
		};
	}
	const candidate: ProjectMapV1 = {
		...map,
		capabilities: map.capabilities.map((capability, index) => index === capabilityIndex ? { ...capability, surfaces: [...request.surfaces] as ProjectMapSurface[] } : capability),
	};
	const validated = validateProjectMap(candidate);
	if (validated.map === null) return { ok: false, map: null, diagnostics: validated.diagnostics };
	return { ok: true, map: validated.map, diagnostics: validated.diagnostics };
}

/**
 * Persists a map through a sibling temp file and a rename, so the artifact is only ever
 * swapped for a complete document. An invalid map is refused before anything is written,
 * which leaves whatever the artifact already held untouched.
 */
export function writeProjectMapFile(path: string, map: ProjectMapV1): ProjectMapWriteOutcome {
	const validated = validateProjectMap(map);
	if (validated.map === null) return { ok: false, path, diagnostics: validated.diagnostics };
	try {
		writeJsonFileAtomicallySync(path, serializeProjectMap(validated.map));
	} catch {
		return {
			ok: false,
			path,
			diagnostics: [refusal(PROJECT_MAP_DIAGNOSTIC_CODES.UNREADABLE_ARTIFACT, "$", "The Project Map artifact could not be written.")],
		};
	}
	return { ok: true, path, diagnostics: [] };
}
