import type { Component, TUI } from "@earendil-works/pi-tui";
import { renderCard, type CardTheme } from "./shell-card.ts";
import { sidebarPart, type SidebarRail } from "./shell-sidebar.ts";
import {
	PROJECT_MAP_OVERLAY_UNAVAILABLE,
	projectMapCardDescriptor,
	projectMapCardDigest,
	projectMapCardState,
	type ProjectMapCardState,
} from "./shell-project-map-view.ts";

export const PROJECT_MAP_RAIL_KEY = "project-map";

function state(artifactPath: string): ProjectMapCardState {
	return projectMapCardState(artifactPath, PROJECT_MAP_OVERLAY_UNAVAILABLE);
}

export function renderProjectMapCard(artifactPath: string, theme: CardTheme, width: number, expanded: boolean): string[] {
	return renderCard(projectMapCardDescriptor(state(artifactPath)), theme, width, { expanded });
}

export function projectMapCardRail(artifactPath: string, theme: CardTheme): SidebarRail {
	return {
		render: (width) => renderProjectMapCard(artifactPath, theme, width, true),
		digest: () => projectMapCardDigest(state(artifactPath)),
		invalidate() {},
	};
}

export function projectMapCardBottom(artifactPath: string, theme: CardTheme): Component {
	return {
		render: (width) => renderProjectMapCard(artifactPath, theme, width, false),
		invalidate() {},
	};
}

export function projectMapCardPart(tui: TUI, artifactPath: string, theme: CardTheme): Component {
	return sidebarPart(tui, PROJECT_MAP_RAIL_KEY, projectMapCardBottom(artifactPath, theme), projectMapCardRail(artifactPath, theme));
}

export function projectMapCardVisible(artifactPath: string): boolean {
	return state(artifactPath).kind === "ready";
}
