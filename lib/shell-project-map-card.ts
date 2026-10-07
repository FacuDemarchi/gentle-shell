import { wrapTextWithAnsi as wrapTextAnsi, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { cardStyle, panelExtraRows, panelInnerWidth, renderCard, type CardTheme } from "./shell-card.ts";
import { sidebarPart, sidebarState, type SidebarRail } from "./shell-sidebar.ts";
import { probeProjectMapOpenPiHost, type ProjectMapOpenPiHost } from "./project-map-open-pi.ts";
import {
	PROJECT_MAP_EXPANDED,
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	projectMapCardBody,
	projectMapCardDescriptor,
	projectMapCardDigest,
	projectMapCardState,
	projectMapSummaryLine,
	type ProjectMapCardState,
	type ProjectMapCollapseState,
	type ProjectMapGroup,
} from "./shell-project-map-view.ts";

export const PROJECT_MAP_RAIL_KEY = "project-map";

let memoizedOpenPiHost: ProjectMapOpenPiHost | undefined;

/** tmux availability cannot change while this Pi process is alive. */
export function projectMapOpenPiHostOnce(probe = probeProjectMapOpenPiHost): ProjectMapOpenPiHost {
	return memoizedOpenPiHost ??= probe({ env: process.env, timeoutMs: 1000 });
}

export interface ProjectMapCardSession {
	collapse(): ProjectMapCollapseState;
	selection(): string | undefined;
	select(id: string | undefined): void;
	toggle(group: ProjectMapGroup): void;
}

/**
 * The launch affordance the card draws and reports.
 *
 * The card paints the marker, but it cannot decide who may be launched — that answer needs the
 * store — and it cannot run a command, whose handler is an awaited host call. So it asks for the
 * set and reports the click, exactly like the `?` marker reports the capability it explains.
 */
export interface ProjectMapLaunchPort {
	/** The capabilities that may be opened right now. */
	launchable(): ReadonlySet<string>;
	/** Runs the product's own open flow for one capability. */
	open(capabilityId: string): void;
}

function state(artifactPath: string): ProjectMapCardState {
	return projectMapCardState(artifactPath, PROJECT_MAP_OVERLAY_UNAVAILABLE);
}

/**
 * The two columns a rendered body line spends before its text: the frame's `│` and the space
 * after it. A body column is therefore an x coordinate plus this offset.
 */
const CARD_FRAME_COLUMNS = 2;

export function renderProjectMapCard(
	artifactPath: string,
	theme: CardTheme,
	width: number,
	expanded: boolean,
	collapse: ProjectMapCollapseState = PROJECT_MAP_EXPANDED,
	hint?: string,
): string[] {
	return renderCard(projectMapCardDescriptor(state(artifactPath), collapse, undefined, panelInnerWidth(theme, width), undefined, (role, text) => theme.fg(role, text)), theme, width, { expanded, hint, panel: true });
}

/**
 * A read-only block another surface stacks below the card.
 *
 * The rail's sections are a closed list, so a second card cannot register itself
 * in the rail area. A surface that needs to show detail next to the map lends the
 * card its rows instead: they paint below the card, they take part in the digest,
 * and they never receive a click, so the card's own hit indices keep their meaning.
 */
export interface ProjectMapCardDetail {
	lines(width: number): string[];
	digest(): string;
}

export function projectMapCardRail(artifactPath: string, theme: CardTheme, session: ProjectMapCardSession, hint?: string, reveal?: (localLine: number) => void, detail?: ProjectMapCardDetail, onExplain?: (capabilityId: string) => void, launch?: ProjectMapLaunchPort, readState: () => ProjectMapCardState = () => state(artifactPath)): SidebarRail {
	const headerLines = new Map<number, ProjectMapGroup>();
	const capabilityLines = new Map<number, { id: string; help: number; launch?: number }>();
	const capabilityStarts = new Map<string, number>();
	let revealedSelection: string | undefined;
	let bodyStartColumn = CARD_FRAME_COLUMNS;
	const renderCardLines = (width: number) => {
		headerLines.clear();
		capabilityLines.clear();
		capabilityStarts.clear();
		const current = readState();
		const launchable = launch?.launchable();
		// The marker is painted with the theme's own role, so the row still follows the configured
		// theme; the descriptor and the hit map must be built from the same call.
		const paint = (role: string, text: string) => theme.fg(role, text);
		const body = projectMapCardBody(current, session.collapse(), session.selection(), panelInnerWidth(theme, width), launchable, paint);
		const descriptor = projectMapCardDescriptor(current, session.collapse(), session.selection(), panelInnerWidth(theme, width), launchable, paint);
		const lines = renderCard(descriptor, theme, width, { expanded: true, hint, panel: true });
		// Map body indices through the shared panel geometry and wrapping. Float panels
		// add a top padding row, a header separator, and a transparent left margin.
		const extraRows = panelExtraRows(theme, width);
		bodyStartColumn = CARD_FRAME_COLUMNS + (extraRows > 0 ? 1 : 0);
		if (current.kind !== "ready") return lines;
		const renderedByBody = new Map<number, number>();
		let rendered = 1 + extraRows;
		for (const [index, line] of body.lines.entries()) {
			renderedByBody.set(index, rendered);
			rendered += wrapTextAnsi(line, panelInnerWidth(theme, width)).length;
		}
		for (const header of body.headers) headerLines.set(renderedByBody.get(header.line)!, header.group);
		for (const capability of body.capabilities) {
			const start = renderedByBody.get(capability.line)!;
			let height = 0;
			for (let index = capability.line; index < capability.line + capability.height; index++) {
				height += wrapTextAnsi(body.lines[index]!, panelInnerWidth(theme, width)).length;
			}
			capabilityStarts.set(capability.id, start);
			for (let line = start; line < start + height; line++) capabilityLines.set(line, { id: capability.id, help: capability.help, ...(capability.launch === undefined ? {} : { launch: capability.launch }) });
		}
		// The layout that shows the new selection is the one that reveals it, whoever changed
		// it — a click, a shortcut, or the artifact — and a render that does not change the
		// selection never moves the viewport.
		const selection = session.selection();
		if (selection !== revealedSelection) {
			revealedSelection = selection;
			const start = selection === undefined ? undefined : capabilityStarts.get(selection);
			if (start !== undefined) reveal?.(start);
		}
		return lines;
	};
	const render = (width: number) => {
		const lines = renderCardLines(width);
		return detail === undefined ? lines : [...lines, ...detail.lines(width)];
	};
	return {
		render,
		digest: () => `${cardStyle()}|${projectMapCardDigest(readState(), session.collapse(), session.selection(), launch?.launchable())}|${detail?.digest() ?? ""}`,
		invalidate() {},
		handleMouse(event: TuiMouseEvent) {
			if (event.type !== "click" || event.button !== "left") return undefined;
			const group = headerLines.get(event.y);
			if (group !== undefined) {
				session.toggle(group);
				return { handled: true, render: true };
			}
			const capability = capabilityLines.get(event.y);
			if (capability === undefined) return undefined;
			// Each marker has its own target: explaining is not launching and neither is selecting,
			// and a click that lands on a marker must not change what the Inspector shows.
			if (event.x === bodyStartColumn + capability.help) {
				onExplain?.(capability.id);
				return { handled: true };
			}
			if (capability.launch !== undefined && event.x === bodyStartColumn + capability.launch) {
				launch?.open(capability.id);
				return { handled: true };
			}
			session.select(capability.id === session.selection() ? undefined : capability.id);
			return { handled: true, render: true };
		},
	};
}

export function projectMapCardBottom(artifactPath: string, theme: CardTheme, readState: () => ProjectMapCardState = () => state(artifactPath)): Component {
	return {
		render: (width) => {
			const current = readState();
			const descriptor = projectMapCardDescriptor(current, undefined, undefined, panelInnerWidth(theme, width));
			const body = current.kind === "ready" ? [projectMapSummaryLine(current.map)] : descriptor.body;
			return renderCard({ ...descriptor, body }, theme, width, { expanded: false, panel: true });
		},
		invalidate() {},
	};
}

export function projectMapCardPart(tui: TUI, artifactPath: string, theme: CardTheme, session: ProjectMapCardSession, hint?: string, detail?: ProjectMapCardDetail, onExplain?: (capabilityId: string) => void, launch?: ProjectMapLaunchPort, readState: () => ProjectMapCardState = () => state(artifactPath)): Component {
	return sidebarPart(tui, PROJECT_MAP_RAIL_KEY, projectMapCardBottom(artifactPath, theme, readState), projectMapCardRail(
		artifactPath,
		theme,
		session,
		hint,
		(localLine) => sidebarState(tui).reveal?.(PROJECT_MAP_RAIL_KEY, localLine),
		detail,
		onExplain,
		launch,
		readState,
	));
}

export function projectMapCardVisible(artifactPath: string): boolean {
	return state(artifactPath).kind === "ready";
}
