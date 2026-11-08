import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { callMcpTool } from "../../services/demoAgentService";
import { startRoleSwitch } from "../../utils/roleSwitch";

const ACTIVE = { id: "reg-1", applicationId: "agent-1", status: "active", scopes: ["read", "write"] };

function mockServer({ registration = null } = {}) {
  apiClient.post.mockImplementation((url) => {
    if (url === "/api/delegated-commerce/register") {
      return Promise.resolve({
        data: {
          registration: { id: "reg-1", applicationId: "agent-1", status: "staged", scopes: [] },
          claimCode: "AF-CODE",
          actorToken: { clientId: "agent-1" },
        },
      });
    }
    if (url === "/api/delegated-commerce/revoke") {
      return Promise.resolve({ data: { auditId: "aud-1", registration: { ...ACTIVE, status: "revoked" } } });
    }
    if (url === "/api/auth/ciba/initiate") {
      return Promise.resolve({ data: { auth_req_id: "req-1", interval: 1, engine: "simulated" } });
    }
    return Promise.resolve({ data: {} });
  });
  apiClient.get.mockResolvedValue({
    data: registration ? { registration, authorized: registration.status === "active", scopes: registration.scopes } : { registration: null, authorized: false, scopes: [] },
  });
}

const primaries = () => document.querySelectorAll("button.pu-btn--primary");
const primary = () => screen.getByTestId("dc-primary");
const goToStep = (name) => fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mockServer();
});

describe("DelegatedCommercePage on the Ping UI primitives", () => {
  it("opens with a role=note banner, before the title band, that names what is real and the mock approval", () => {
    render(<DelegatedCommercePage user={{ role: "admin" }} />);
    const page = document.querySelector(".dc-page");
    expect(page.classList.contains("pu-page")).toBe(true);
    expect(page.firstElementChild.classList.contains("pu-banner-wrap")).toBe(true);
    const banner = screen.getByTestId("dc-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner.textContent).toMatch(/mock phone or email/i);
    expect(banner.textContent).toMatch(/nothing is ever pushed to a real phone/i);
    expect(banner.textContent).toMatch(/demo pattern/i);
  });

  it("renders cards, a key-value list and word-bearing chips", () => {
    render(<DelegatedCommercePage user={{ role: "admin" }} />);
    expect(document.querySelectorAll(".pu-card").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId("dc-truth").querySelector("dl.pu-kv")).toBeTruthy();
    const chips = [...document.querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(5);
    chips.forEach((chip) => expect(chip.textContent.trim().length).toBeGreaterThan(0));
    expect(within(screen.getByTestId("dc-truth")).getByText("Mock phone or email")).toBeInTheDocument();
  });

  it("says the approval is by mock phone or email on step 3, never a real phone push", () => {
    render(<DelegatedCommercePage user={{ role: "admin" }} />);
    goToStep("Human approval");
    expect(screen.getByText(/mock phone or email, never a real phone push/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bSMS\b/);
  });

  it("keeps exactly one primary: Create in PingOne, then Switch to customer once the agent exists", async () => {
    render(<DelegatedCommercePage user={{ role: "admin" }} />);
    expect(primaries()).toHaveLength(1);
    expect(primary()).toHaveTextContent("Create in PingOne");
    primary().focus();
    fireEvent.click(primary());
    await waitFor(() => expect(primary()).toHaveTextContent("Switch to customer"));
    expect(primaries()).toHaveLength(1);
    expect(document.activeElement).toBe(primary());
    fireEvent.click(primary());
    expect(startRoleSwitch).toHaveBeenCalledWith("customer", "/delegated-commerce");
  });

  it("uses aria-disabled, not disabled, so a blocked primary keeps keyboard focus", () => {
    render(<DelegatedCommercePage user={{ role: "customer" }} />);
    expect(primary()).toHaveTextContent("Claim agent");
    expect(primary()).toHaveAttribute("aria-disabled", "true");
    expect(primary()).not.toBeDisabled();
    primary().focus();
    fireEvent.click(primary());
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/delegated-commerce/claim", expect.anything());
    expect(document.activeElement).toBe(primary());
  });

  it("hands the one primary to the consent dialog while it is open, then takes it back", async () => {
    window.sessionStorage.setItem("delegated-commerce-claim-code", "AF-CODE");
    apiClient.post.mockImplementation((url) => {
      if (url === "/api/delegated-commerce/claim") return Promise.resolve({ data: { registration: { ...ACTIVE, status: "claimed", scopes: [] } } });
      if (url === "/api/delegated-commerce/consent") return Promise.resolve({ data: { delegationId: "d1", registration: ACTIVE } });
      return Promise.resolve({ data: {} });
    });
    render(<DelegatedCommercePage user={{ role: "customer" }} />);
    fireEvent.click(primary());
    await screen.findByLabelText("Authorize AF Personal Shopping Agent");
    expect(primaries()).toHaveLength(0);
    expect(document.querySelectorAll(".dc-modal-btn--confirm")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Authorize selected scopes" }));
    await waitFor(() => expect(primary()).toHaveTextContent("Call list_orders as agent"));
    expect(primaries()).toHaveLength(1);
  });

  it("offers Continue to step 2 once consent is active, and it moves to step 2", async () => {
    mockServer({ registration: ACTIVE });
    render(<DelegatedCommercePage user={{ role: "customer" }} />);
    await waitFor(() => expect(primary()).toHaveTextContent("Continue to step 2"));
    fireEvent.click(primary());
    expect(screen.getByText("Step 2 workspace")).toBeInTheDocument();
    expect(primary()).toHaveTextContent("Call list_orders as agent");
  });

  it("runs the main flow on one primary button that keeps focus from step 2 to a pending approval to revoke", async () => {
    mockServer({ registration: ACTIVE });
    let checkoutCalls = 0;
    callMcpTool.mockImplementation((tool) => {
      if (tool === "list_orders") {
        const revoked = apiClient.post.mock.calls.some(([u]) => u === "/api/delegated-commerce/revoke");
        if (revoked) return Promise.resolve({ result: { error: "access_denied", error_description: "delegation revoked" } });
        return Promise.resolve({ result: { content: [{ text: JSON.stringify({ orders: [] }) }] }, tokenEvents: [{ id: "mcp-access-token" }] });
      }
      checkoutCalls += 1;
      // the first checkout hits the human gate; the retry after approval goes through
      return Promise.resolve(checkoutCalls === 1 ? { result: { error: "mcp_hitl_required" } } : { result: { content: [{ text: "{}" }] } });
    });
    const baseGet = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation((url) => (
      url === "/api/auth/ciba/poll/req-1" ? Promise.resolve({ data: { status: "approved", engine: "simulated" } }) : baseGet(url)
    ));
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<DelegatedCommercePage user={{ role: "customer" }} />);
    await waitFor(() => expect(primary()).toHaveTextContent("Continue to step 2"));
    const button = primary();
    button.focus();

    fireEvent.click(button); // Continue to step 2
    fireEvent.click(primary()); // Call list_orders
    await waitFor(() => expect(primary()).toHaveTextContent("Checkout $600 headphones"));
    expect(screen.getByText("2 of 4")).toBeInTheDocument();

    fireEvent.click(primary()); // Checkout: gated -> CIBA initiate -> pending
    await waitFor(() => expect(primary()).toHaveTextContent("Open approval page (new tab)"));
    expect(checkoutCalls).toBe(1);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getAllByText("Simulated approval")).toHaveLength(2); // the truth card and the step chip
    expect(primaries()).toHaveLength(1);
    expect(primary()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(primary());
    expect(open).toHaveBeenCalledWith("/ciba-approve?authReqId=req-1", "_blank", "noopener,noreferrer");

    // the same element carried the click through every state
    expect(primary()).toBe(button);
    expect(document.activeElement).toBe(button);

    // the approval lands (the poll answers approved after a second), checkout is retried and step 4 opens
    await waitFor(() => expect(primary()).toHaveTextContent("Revoke agent access"), { timeout: 4000 });
    expect(checkoutCalls).toBe(2);
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
    expect(primary()).toBe(button);
    expect(document.activeElement).toBe(button);
    fireEvent.click(primary());
    await waitFor(() => expect(primary()).toHaveTextContent("Start over"));
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.getAllByText(/Confirmed denied: delegation revoked/).length).toBeGreaterThan(0); // result line and proof rail
    expect(primaries()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "View audit evidence" })).toBeInTheDocument();

    fireEvent.click(primary()); // Start over
    expect(screen.getByText("Step 1 workspace")).toBeInTheDocument();
    expect(screen.getByText("0 of 4")).toBeInTheDocument();
    open.mockRestore();
  });

  it("marks the current step with aria-current and the finished ones with a Done chip", async () => {
    mockServer({ registration: ACTIVE });
    render(<DelegatedCommercePage user={{ role: "customer" }} />);
    await waitFor(() => expect(screen.getByText("1 of 4")).toBeInTheDocument());
    const rail = screen.getByRole("button", { name: /Register \+ consent/ });
    expect(rail).toHaveAttribute("aria-current", "step");
    expect(within(rail).getByText("Done")).toBeInTheDocument();
    goToStep("Protected MCP call");
    expect(screen.getByRole("button", { name: /Protected MCP call/ })).toHaveAttribute("aria-current", "step");
    expect(rail).not.toHaveAttribute("aria-current");
  });

  it("does not run a blocked action while busy and keeps the header buttons focusable", async () => {
    mockServer({ registration: ACTIVE });
    let release;
    callMcpTool.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<DelegatedCommercePage user={{ role: "customer" }} />);
    await waitFor(() => expect(primary()).toHaveTextContent("Continue to step 2"));
    fireEvent.click(primary());
    fireEvent.click(primary()); // list_orders starts and hangs
    await waitFor(() => expect(primary()).toHaveAttribute("aria-disabled", "true"));
    const run = screen.getByRole("button", { name: "Running..." });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).not.toBeDisabled();
    fireEvent.click(primary());
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ result: { content: [{ text: "{}" }] } });
    });
  });
});
