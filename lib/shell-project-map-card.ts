import type { Component, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderCard, type CardTheme } from "./shell-card.ts";
import { sidebarPart, type SidebarRail } from "./shell-sidebar.ts";
import {
	PROJECT_MAP_EXPANDED,
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	projectMapCardDescriptor,
	projectMapCardDigest,
	projectMapCardState,
	projectMapGroupFromHeader,
	projectMapSummaryLine,
	type ProjectMapCardState,
	type ProjectMapCollapseState,
	type ProjectMapGroup,
} from "./shell-project-map-view.ts";

export const PROJECT_MAP_RAIL_KEY = "project-map";

export interface ProjectMapCardSession {
	collapse(): ProjectMapCollapseState;
	toggle(group: ProjectMapGroup): void;
}

function state(artifactPath: string): ProjectMapCardState {
	return projectMapCardState(artifactPath, PROJECT_MAP_OVERLAY_UNAVAILABLE);
}

export function renderProjectMapCard(
	artifactPath: string,
	theme: CardTheme,
	width: number,
	expanded: boolean,
	collapse: ProjectMapCollapseState = PROJECT_MAP_EXPANDED,
	hint?: string,
): string[] {
	return renderCard(projectMapCardDescriptor(state(artifactPath), collapse), theme, width, { expanded, hint });
}

export function projectMapCardRail(artifactPath: string, theme: CardTheme, session: ProjectMapCardSession, hint?: string): SidebarRail {
	const headerLines = new Map<number, ProjectMapGroup>();
	const render = (width: number) => {
		headerLines.clear();
		const current = state(artifactPath);
		const descriptor = projectMapCardDescriptor(current, session.collapse());
		const lines = renderCard(descriptor, theme, width, { expanded: true, hint });
		// Only a ready map has groups. Its header rows are the only body rows that can carry the
		// header text, because identifiers are validated lowercase kebab-case; the diagnostic
		// rows of an invalid artifact are artifact-controlled text, and text must never become a
		// control. The first and last rows are the frame, whose subtitle carries the free-form
		// project name, so they are skipped even though a matching name is still just text.
		if (current.kind !== "ready") return lines;
		for (const [index, line] of lines.entries()) {
			if (index === 0 || index === lines.length - 1) continue;
			const group = projectMapGroupFromHeader(line);
			if (group !== undefined) headerLines.set(index, group);
		}
		return lines;
	};
	return {
		render,
		digest: () => projectMapCardDigest(state(artifactPath), session.collapse()),
		invalidate() {},
		handleMouse(event: TuiMouseEvent) {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const group = headerLines.get(event.y);
		if (group === undefined) return undefined;
		// The local line-to-group map is rebuilt on every render, so rows and blank card
		// space cannot toggle a group merely because their y coordinate was once a header.
		session.toggle(group);
		return { handled: true, render: true };
		},
	};
}

export function projectMapCardBottom(artifactPath: string, theme: CardTheme): Component {
	return {
		render: (width) => {
			const current = state(artifactPath);
			const descriptor = projectMapCardDescriptor(current);
			const body = current.kind === "ready" ? [projectMapSummaryLine(current.map)] : descriptor.body;
			return renderCard({ ...descriptor, body }, theme, width, { expanded: false });
		},
		invalidate() {},
	};
}

export function projectMapCardPart(tui: TUI, artifactPath: string, theme: CardTheme, session: ProjectMapCardSession, hint?: string): Component {
	return sidebarPart(tui, PROJECT_MAP_RAIL_KEY, projectMapCardBottom(artifactPath, theme), projectMapCardRail(artifactPath, theme, session, hint));
}

export function projectMapCardVisible(artifactPath: string): boolean {
	return state(artifactPath).kind === "ready";
}
