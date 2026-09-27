import { wrapTextWithAnsi as wrapTextAnsi, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { cardInnerWidth, renderCard, type CardTheme } from "./shell-card.ts";
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

export type ProjectMapOpenPiDecision = { permitted: boolean; diagnostics: Array<{ code: string }> };
export type ProjectMapOpenPiDecisionFor = (capabilityId: string) => ProjectMapOpenPiDecision;
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
	return renderCard(projectMapCardDescriptor(state(artifactPath), collapse, undefined, undefined, cardInnerWidth(width)), theme, width, { expanded, hint });
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

export function projectMapCardRail(artifactPath: string, theme: CardTheme, session: ProjectMapCardSession, hint?: string, reveal?: (localLine: number) => void, decisionFor?: ProjectMapOpenPiDecisionFor, detail?: ProjectMapCardDetail, onExplain?: (capabilityId: string) => void): SidebarRail {
	const headerLines = new Map<number, ProjectMapGroup>();
	const capabilityLines = new Map<number, { id: string; help: number }>();
	const capabilityStarts = new Map<string, number>();
	let revealedSelection: string | undefined;
	let decisionSelection: string | undefined;
	let decision: ProjectMapOpenPiDecision | undefined;
	const currentDecision = () => {
		const selection = session.selection();
		if (selection !== decisionSelection) {
			decisionSelection = selection;
			decision = selection === undefined ? undefined : decisionFor?.(selection);
		}
		return decision;
	};
	const renderCardLines = (width: number) => {
		headerLines.clear();
		capabilityLines.clear();
		capabilityStarts.clear();
		const current = state(artifactPath);
		const openPiDecision = currentDecision();
		const body = projectMapCardBody(current, session.collapse(), session.selection(), openPiDecision, cardInnerWidth(width));
		const descriptor = projectMapCardDescriptor(current, session.collapse(), session.selection(), openPiDecision, cardInnerWidth(width));
		const lines = renderCard(descriptor, theme, width, { expanded: true, hint });
		// `renderCard` starts with the frame top, then wraps each body line in order. Map
		// body indices through that wrapping rather than reading control text back from paint.
		if (current.kind !== "ready") return lines;
		const renderedByBody = new Map<number, number>();
		let rendered = 1;
		for (const [index, line] of body.lines.entries()) {
			renderedByBody.set(index, rendered);
			rendered += wrapTextAnsi(line, cardInnerWidth(width)).length;
		}
		for (const header of body.headers) headerLines.set(renderedByBody.get(header.line)!, header.group);
		for (const capability of body.capabilities) {
			const start = renderedByBody.get(capability.line)!;
			let height = 0;
			for (let index = capability.line; index < capability.line + capability.height; index++) {
				height += wrapTextAnsi(body.lines[index]!, cardInnerWidth(width)).length;
			}
			capabilityStarts.set(capability.id, start);
			for (let line = start; line < start + height; line++) capabilityLines.set(line, { id: capability.id, help: capability.help });
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
		digest: () => `${projectMapCardDigest(state(artifactPath), session.collapse(), session.selection(), currentDecision())}|${detail?.digest() ?? ""}`,
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
			// The marker has its own target: explaining a capability is not selecting it, and a
			// click that lands on the marker must not change what the Inspector shows.
			if (event.x === CARD_FRAME_COLUMNS + capability.help) {
				onExplain?.(capability.id);
				return { handled: true };
			}
			session.select(capability.id === session.selection() ? undefined : capability.id);
			return { handled: true, render: true };
		},
	};
}

export function projectMapCardBottom(artifactPath: string, theme: CardTheme): Component {
	return {
		render: (width) => {
			const current = state(artifactPath);
			const descriptor = projectMapCardDescriptor(current, undefined, undefined, undefined, cardInnerWidth(width));
			const body = current.kind === "ready" ? [projectMapSummaryLine(current.map)] : descriptor.body;
			return renderCard({ ...descriptor, body }, theme, width, { expanded: false });
		},
		invalidate() {},
	};
}

export function projectMapCardPart(tui: TUI, artifactPath: string, theme: CardTheme, session: ProjectMapCardSession, hint?: string, decisionFor?: ProjectMapOpenPiDecisionFor, detail?: ProjectMapCardDetail, onExplain?: (capabilityId: string) => void): Component {
	return sidebarPart(tui, PROJECT_MAP_RAIL_KEY, projectMapCardBottom(artifactPath, theme), projectMapCardRail(
		artifactPath,
		theme,
		session,
		hint,
		(localLine) => sidebarState(tui).reveal?.(PROJECT_MAP_RAIL_KEY, localLine),
		decisionFor,
		detail,
		onExplain,
	));
}

export function projectMapCardVisible(artifactPath: string): boolean {
	return state(artifactPath).kind === "ready";
}
