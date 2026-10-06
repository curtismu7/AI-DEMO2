import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import DemoArchSlidesPage, { liveStateKey } from "../DemoArchSlidesPage";

// A Vite dev reload (checkout sync, HMR reconnect) remounts the page mid-demo.
// Live must come back on with the steps it had already lit, and turning it off
// must forget everything so the next visit starts clean.
const KEY = liveStateKey("workload-agents");

function renderSlide() {
  return render(
    <MemoryRouter>
      <DemoArchSlidesPage slide="workload-agents" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe("Demo arch slides Live state survives a reload", () => {
  it("restores Live, the lit steps and the current step from sessionStorage", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        live: true,
        lit: [2, 4],
        liveNow: 4,
        liveLog: [{ ts: "2026-10-06T21:43:22.146Z", category: "token_exchange", tag: "token-exchange/ok", severity: "info", step: 4 }],
      }),
    );
    renderSlide();
    expect(screen.getByRole("button", { name: /Live · on/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("RFC 8693 token exchange", { selector: ".das-stepbar__title" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Recent BFF events" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play/ })).toBeDisabled();
  });

  it("starts idle with nothing stored, and turning Live off removes the stored state", () => {
    renderSlide();
    const live = screen.getByRole("button", { name: /^Live$/ });
    expect(live).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(live);
    expect(JSON.parse(window.sessionStorage.getItem(KEY)).live).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Live · on/ }));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});
