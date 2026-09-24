import { writeJsonFileAtomicallySync } from "./agent-profiles.ts";
import {
	PROJECT_MAP_DIAGNOSTIC_CODES,
	isIsoInstant,
	serializeProjectMap,
	validateProjectMap,
	type ProjectMapDiagnostic,
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
