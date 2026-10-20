import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import DelegatedCommercePage from "../DelegatedCommercePage";

vi.mock("../DelegatedCommercePage.css", () => ({}), { virtual: true });
vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../services/demoAgentService", () => ({ callMcpTool: vi.fn() }));
vi.mock("../../components/TokenChainTraceRail", () => ({ default: () => <div data-testid="trace-rail" /> }));
vi.mock("../../components/DraggableModal", () => ({
  default: ({ isOpen, title, children, footer }) => (isOpen ? <section aria-label={title}>{children}{footer}</section> : null),
}));
vi.mock("../../context/AgentUiModeContext", () => ({ useAgentUiMode: () => ({ setSurfaceHostEl: vi.fn() }) }));
vi.mock("../../utils/appToast", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));

import apiClient from "../../services/apiClient";

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

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  apiClient.post.mockResolvedValue({ data: {} });
  apiClient.get.mockResolvedValue({ data: { registration: null, authorized: false, scopes: [] } });
});

describe("DelegatedCommercePage lifecycle diagram in the Ping style", () => {
  it("is drawn in the Ping style with Simulate, Reset and the speed selector", () => {
    render(<DelegatedCommercePage user={{ role: "admin", email: "admin@example.com" }} />);
    expect(document.querySelectorAll(".efd--ping").length).toBe(1);
    const region = screen.getByRole("region", { name: "Delegated-agent lifecycle diagram" });
    expect(within(region).getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(within(region).getByTitle("Time each step takes during Simulate")).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Simulate" }));
    expect(within(region).getByText(/Step 1 of 14/)).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Reset" }));
    expect(within(region).getByRole("button", { name: "Simulate" })).toBeTruthy();
  });

  it("clicking the MCP gateway shows the delegated call, MOCK tokens and the standards", async () => {
    render(<DelegatedCommercePage user={{ role: "admin" }} />);
    fireEvent.click(await screen.findByTestId("dc-lifecycle-diagram-flow-node-mcp"));
    const panel = screen.getByTestId("dc-lifecycle-diagram-flow-reel-detail");
    expect(panel.textContent).toContain("MOCK, teaching values only");
    expect(panel.textContent).toContain("RFC 8693");
  });

  it("the claim step says a claim code is not a token", async () => {
    render(<DelegatedCommercePage user={{ role: "admin" }} />);
    fireEvent.click(await screen.findByTestId("dc-lifecycle-diagram-flow-node-customer"));
    const panel = screen.getByTestId("dc-lifecycle-diagram-flow-reel-detail");
    expect(panel.textContent).toContain("Token: none");
  });
});
