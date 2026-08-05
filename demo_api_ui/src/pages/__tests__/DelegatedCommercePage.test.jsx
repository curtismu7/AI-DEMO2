import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DelegatedCommercePage from "../DelegatedCommercePage";

vi.mock("../DelegatedCommercePage.css", () => ({}), { virtual: true });
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));
vi.mock("../../services/demoAgentService", () => ({
  callMcpTool: vi.fn(),
}));
vi.mock("../../components/TokenChainTraceRail", () => ({
  default: () => <div data-testid="trace-rail" />,
}));
vi.mock("../../components/DraggableModal", () => ({
  default: ({ isOpen, title, children, footer }) =>
    isOpen ? <section aria-label={title}>{children}{footer}</section> : null,
}));
const setSurfaceHostEl = vi.fn();
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ setSurfaceHostEl }),
}));
vi.mock("../../utils/appToast", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("../../utils/roleSwitch", () => ({
  startRoleSwitch: vi.fn(),
}));

import apiClient from "../../services/apiClient";

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  apiClient.post.mockImplementation((url) => {
    if (url === "/api/verticals/active") return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
  apiClient.get.mockResolvedValue({
    data: { registration: null, authorized: false, scopes: [] },
  });
});

it("renders the approved all-in-one guided workspace and persistent proof rail", () => {
  render(<DelegatedCommercePage user={{ role: "admin", email: "admin@example.com" }} />);
  expect(screen.getByText("Register. Delegate. Approve. Revoke.")).toBeInTheDocument();
  expect(screen.getByText("Current persona: Administrator")).toBeInTheDocument();
  expect(screen.getAllByText("GA building blocks").length).toBeGreaterThan(0);
  expect(screen.getByText("Demo pattern")).toBeInTheDocument();
  expect(screen.getByTestId("trace-rail")).toBeInTheDocument();
  expect(setSurfaceHostEl).toHaveBeenCalled();
});

it("registers a new agent without rendering a client secret", async () => {
  apiClient.post.mockImplementation((url) => {
    if (url === "/api/verticals/active") return Promise.resolve({ data: {} });
    if (url === "/api/delegated-commerce/register") {
      return Promise.resolve({
        data: {
          registration: {
            id: "reg-1",
            applicationId: "agent-client-new",
            status: "staged",
            scopes: [],
          },
          claimCode: "AF-CLAIM-CODE",
          actorToken: { clientId: "agent-client-new", audience: "agentgateway.ping.demo" },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });

  render(<DelegatedCommercePage user={{ role: "admin" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Create in PingOne" }));

  await waitFor(() => expect(screen.getAllByText("agent-client-new").length).toBeGreaterThan(0));
  expect(screen.getByText("AF-CLAIM-CODE")).toBeInTheDocument();
  expect(screen.getByText("Held server-side; never returned")).toBeInTheDocument();
  expect(screen.queryByText(/client_secret/i)).not.toBeInTheDocument();
});

it("claims the agent and submits the selected customer scopes", async () => {
  window.sessionStorage.setItem("delegated-commerce-claim-code", "AF-CLAIM-CODE");
  apiClient.post.mockImplementation((url, body) => {
    if (url === "/api/verticals/active") return Promise.resolve({ data: {} });
    if (url === "/api/delegated-commerce/claim") {
      expect(body).toEqual({ claimCode: "AF-CLAIM-CODE" });
      return Promise.resolve({
        data: { registration: { id: "reg-1", applicationId: "agent-new", status: "claimed", scopes: [] } },
      });
    }
    if (url === "/api/delegated-commerce/consent") {
      expect(body).toEqual({ scopes: ["read", "write"] });
      return Promise.resolve({
        data: {
          delegationId: "del-1",
          registration: { id: "reg-1", applicationId: "agent-new", status: "active", scopes: ["read", "write"] },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });

  render(<DelegatedCommercePage user={{ role: "customer" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Claim agent" }));
  await waitFor(() => expect(screen.getByLabelText("Authorize A&F Personal Shopping Agent")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Authorize selected scopes" }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/delegated-commerce/consent",
      { scopes: ["read", "write"] },
    ),
  );
  expect(screen.getByText("1 of 4")).toBeInTheDocument();
});
