import {
	mergeDisabledTools,
	PI_PRETTY_SUPPRESSED_TOOL_NAMES,
	quietToolsEnabled,
} from "../lib/quiet-tools-config.ts";

type PiPrettyExtension = (pi: unknown, deps?: unknown) => unknown;

let piPrettyExtensionPromise: Promise<PiPrettyExtension> | undefined;

async function loadPiPrettyExtension(): Promise<PiPrettyExtension> {
	return piPrettyExtensionPromise ??= import("@heyhuynhgiabuu/pi-pretty").then(
		(piPrettyModule) => {
			const moduleCandidate: unknown = piPrettyModule;
			const extension =
				typeof moduleCandidate === "function"
					? moduleCandidate
					: piPrettyModule.default;
			if (typeof extension !== "function") {
				throw new TypeError("pi-pretty must export an extension function");
			}
			return extension as PiPrettyExtension;
		},
	);
}

export default async function gentlePiPrettyExtension(pi: unknown, deps?: unknown): Promise<unknown> {
	if (quietToolsEnabled()) {
		process.env.PRETTY_DISABLE_TOOLS = mergeDisabledTools(
			process.env.PRETTY_DISABLE_TOOLS,
			PI_PRETTY_SUPPRESSED_TOOL_NAMES,
		);
	}
	const piPrettyExtension = await loadPiPrettyExtension();
	return piPrettyExtension(pi, deps);
}
