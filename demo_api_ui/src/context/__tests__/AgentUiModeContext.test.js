// banking_api_ui/src/context/__tests__/AgentUiModeContext.test.js
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AgentUiModeProvider, useAgentUiMode } from "../AgentUiModeContext";

const STORAGE_KEY_LEGACY = "banking_agent_ui_mode";
const STORAGE_KEY_V2 = "banking_agent_ui_v2";

function ModeProbe() {
	const { placement, fab, setAgentUi } = useAgentUiMode();
	return (
		<div>
			<span data-testid="placement">{placement}</span>
			<span data-testid="fab">{fab ? "1" : "0"}</span>
			<button
				type="button"
				onClick={() => setAgentUi({ placement: "middle", fab: false })}
			>
				set middle
			</button>
			<button
				type="button"
				onClick={() => setAgentUi({ placement: "none", fab: true })}
			>
				set float
			</button>
		</div>
	);
}

describe("AgentUiModeProvider", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("defaults to middle+fab when localStorage is empty", () => {
		render(
			<AgentUiModeProvider>
				<ModeProbe />
			</AgentUiModeProvider>,
		);
		expect(screen.getByTestId("placement")).toHaveTextContent("middle");
		expect(screen.getByTestId("fab")).toHaveTextContent("1");
	});

	it("migrates legacy embedded key to middle (Phase 4d: bottom removed)", () => {
		localStorage.setItem(STORAGE_KEY_LEGACY, "embedded");
		render(
			<AgentUiModeProvider>
				<ModeProbe />
			</AgentUiModeProvider>,
		);
		expect(screen.getByTestId("placement")).toHaveTextContent("middle");
		expect(screen.getByTestId("fab")).toHaveTextContent("0");
	});

	it("persists setAgentUi to v2 localStorage", () => {
		render(
			<AgentUiModeProvider>
				<ModeProbe />
			</AgentUiModeProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: /set middle/i }));
		expect(screen.getByTestId("placement")).toHaveTextContent("middle");
		const raw = localStorage.getItem(STORAGE_KEY_V2);
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw)).toEqual({ placement: "middle", fab: false, mode: null });
	});

	it("syncs from storage events (other tab) on v2 key", () => {
		render(
			<AgentUiModeProvider>
				<ModeProbe />
			</AgentUiModeProvider>,
		);
		expect(screen.getByTestId("placement")).toHaveTextContent("middle");
		act(() => {
			const next = JSON.stringify({ placement: "middle", fab: true });
			localStorage.setItem(STORAGE_KEY_V2, next);
			// No storageArea member: jsdom 26's StorageEvent brand-checks it and
			// rejects the setupTests localStorage mock (Node 26's experimental
			// localStorage shadows jsdom's). The provider's onStorage handler only
			// reads e.key/e.newValue anyway.
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: STORAGE_KEY_V2,
					newValue: next,
					oldValue: null,
				}),
			);
		});
		expect(screen.getByTestId("placement")).toHaveTextContent("middle");
		expect(screen.getByTestId("fab")).toHaveTextContent("1");
	});
});

describe("persisted dock placements: removed coerce to middle, valid preserved", () => {
	beforeEach(() => {
		localStorage.clear();
	});
	it("a stored right-dock placement reads back as middle (never a no-agent state)", () => {
		localStorage.setItem(
			STORAGE_KEY_V2,
			JSON.stringify({ placement: "right-dock", fab: true }),
		);
		render(
			<AgentUiModeProvider>
				<ModeProbe />
			</AgentUiModeProvider>,
		);
		expect(screen.getByTestId("placement")).toHaveTextContent("middle");
	});

	it("a persisted 'bottom' placement is preserved (v2 dashboard bottom-dock)", () => {
		// 'bottom' was re-introduced as a first-class placement by the v2
		// dashboard bottom-dock layout (0bb474b8); it is valid and must NOT be
		// coerced. (Supersedes the earlier Phase-4d 'bottom archived' behaviour.)
		localStorage.setItem(
			STORAGE_KEY_V2,
			JSON.stringify({ placement: "bottom", fab: true }),
		);
		render(
			<AgentUiModeProvider>
				<ModeProbe />
			</AgentUiModeProvider>,
		);
		expect(screen.getByTestId("placement")).toHaveTextContent("bottom");
		expect(screen.getByTestId("fab")).toHaveTextContent("1");
	});
});
