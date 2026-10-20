import { describe, it, expect } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

// jsdom measures nothing, so React Flow draws no edges unless the observer reports each node.
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; }
  observe(target) { this.cb([{ target, contentRect: { width: 250, height: 40 } }]); }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 250 });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 40 });
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

import UseCaseDiagramPage from "../UseCaseDiagramPage";

function renderAt(id) {
  act(() => tokenChainTraceStore.reset());
  return render(
    <MemoryRouter initialEntries={[`/use-case-diagrams/${id}`]}>
      <Routes>
        <Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UseCaseDiagramPage with a pingStyle config (pilot UC-NHI2)", () => {
  it("renders the Ping look: numbered arrows, key, Simulate, Reset and a speed control", async () => {
    renderAt("UC-NHI2");
    expect(document.querySelector(".sfd--ping")).toBeTruthy();
    expect(screen.getByLabelText("Arrow key")).toBeTruthy();
    for (const n of [1, 2, 3]) expect((await screen.findByTestId(`sfd-edge-badge-${n}`)).textContent).toContain(String(n));
    // the page opens on hop 1 (paused), so Reset is live; pressing it brings Simulate back
    fireEvent.click(screen.getByRole("button", { name: /^reset$/i }));
    expect(screen.getByRole("button", { name: /simulate/i })).toBeTruthy();
    expect(screen.getByTestId("ucd-stepbar-uc-nhi2").querySelector("select, input[type='range']")).toBeTruthy();
  });

  it("a box click rings the box and leaves the detail to the page's own panel", async () => {
    renderAt("UC-NHI2");
    fireEvent.click(await screen.findByTestId("ucd-uc-nhi2-node-events"));
    expect(document.querySelector(".sfd-node--selected")).toBeTruthy();
    expect(screen.getByTestId("ucd-panel").textContent).toContain("Lifecycle events");
    expect(screen.queryByTestId("ucd-uc-nhi2-reel-detail")).toBeNull();
  });
});

describe("UseCaseDiagramPage with a config that does not opt in", () => {
  it("is unchanged: no Ping class, key, badges or selection ring; the page panel shows the picked node", async () => {
    renderAt("UC11");
    fireEvent.click(await screen.findByTestId("ucd-uc11-node-gw"));
    expect(document.querySelector(".sfd--ping")).toBeNull();
    expect(screen.queryByLabelText("Arrow key")).toBeNull();
    expect(screen.queryByTestId("sfd-edge-badge-1")).toBeNull();
    expect(document.querySelector(".sfd-node--selected")).toBeNull();
    expect(screen.getByTestId("ucd-panel").textContent).toContain("Agent gateway");
  });
});
