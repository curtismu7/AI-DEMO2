import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const reactFlowMocks = vi.hoisted(() => ({ fitView: vi.fn(), setViewport: vi.fn() }));

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
    ReactFlow: ({ edges = [], nodes = [], onNodeClick, onEdgeClick, children }) => ReactModule.createElement(
      "div",
      { "data-testid": "topology-canvas" },
      nodes.filter((node) => node.type === "server").map((node) => ReactModule.createElement(
        "button",
        { key: node.id, type: "button", onClick: () => onNodeClick?.({}, node) },
        node.data.title,
      )),
      edges.filter((edge) => !edge.hidden).map((edge) => ReactModule.createElement(
        "button",
        { key: edge.id, type: "button", onClick: () => onEdgeClick?.({}, edge) },
        edge.label,
      )),
      children,
    ),
    ReactFlowProvider: ({ children }) => children,
    useReactFlow: () => ({ fitView: reactFlowMocks.fitView, getViewport: () => ({ x: 24, y: 36, zoom: 0.62 }), setViewport: reactFlowMocks.setViewport }),
  };
});

import ServerTopologyPage from "../ServerTopologyPage";
import { PLAYBACKS, SERVER_EDGES } from "../serverTopologyData";

describe("Server topology use-case playback", () => {
  it("fits the current topology for print and restores the interactive viewport afterward", () => {
    reactFlowMocks.fitView.mockClear();
    reactFlowMocks.setViewport.mockClear();
    render(<ServerTopologyPage />);

    window.dispatchEvent(new Event("beforeprint"));
    expect(reactFlowMocks.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: 0.1,
      duration: 0,
    }));

    window.dispatchEvent(new Event("afterprint"));
    expect(reactFlowMocks.setViewport).toHaveBeenCalledWith(
      { x: 24, y: 36, zoom: 0.62 },
      { duration: 0 },
    );
  });

  it("shows a full numbered route and its result in the use-case selector", () => {
    render(<ServerTopologyPage />);

    const selector = screen.getByRole("combobox", { name: /choose a request flow/i });
    expect(within(selector).getByRole("option", {
      name: /Agent → Demo Agent Gateway → protected API.*Authorized API data returned/i,
    })).toBeInTheDocument();
    expect(screen.getByText(/Gateway → PingOne Authorize · policy decision/i)).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "apiKeyBackend" } });

    expect(screen.getByText(/returns the mortgage record through the agent.*API key stays server-side/i)).toBeInTheDocument();
    expect(screen.getByText("01").parentElement).toHaveTextContent("User / agent client → ingress");
    expect(screen.getByText("02").parentElement).toHaveTextContent("Ingress → frontend");
    expect(within(screen.getByLabelText("Numbered flow steps")).getAllByRole("listitem")[7]).toHaveTextContent(
      "Gateway → API resource server · X-API-Key",
    );
    expect(within(selector).getByRole("option", {
      name: /Agent → Demo Agent Gateway → API-key backend.*Mortgage data returned.*key stays server-side/i,
    })).toBeInTheDocument();
  });

  it("shows PDF and Lucidchart downloads on the topology page", () => {
    render(<ServerTopologyPage />);

    const exports = screen.getByRole("group", { name: "Export server topology" });
    expect(within(exports).getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
    expect(within(exports).getByRole("link", { name: "Download Lucidchart CSV" })).toHaveAttribute(
      "href",
      "/exports/server-topology-lucidchart.csv",
    );
    expect(within(exports).getByRole("link", { name: "Download details CSV" })).toHaveAttribute(
      "href",
      "/exports/server-topology-details.csv",
    );
  });

  it("keeps each advertised use case tied to real topology connections and an outcome", () => {
    const edgeIds = new Set(SERVER_EDGES.map((edge) => edge.id));

    for (const flow of Object.values(PLAYBACKS)) {
      expect(flow.resultShort).toBeTruthy();
      expect(flow.result).toBeTruthy();
      expect(flow.steps.length).toBeGreaterThan(0);
      for (const step of flow.steps) {
        expect(step.title).toBeTruthy();
        expect(edgeIds.has(step.edgeId), `${flow.label} references ${step.edgeId}`).toBe(true);
      }
    }
  });

  it("opens the numbered detail panel when a route step is selected", () => {
    render(<ServerTopologyPage />);

    expect(screen.queryByRole("complementary", { name: /selected topology details/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Step 05: BFF agent → Demo Agent Gateway/ }));

    const details = screen.getByRole("complementary", { name: /selected topology details/i });
    expect(within(details).getByText(/Diagram step 05 of 9/i)).toBeInTheDocument();
    expect(within(details).getByRole("heading", { name: /BFF \/ API server → Demo Agent Gateway/ })).toBeInTheDocument();
  });

  it("maps Demo Steps to individual route connections", () => {
    render(<ServerTopologyPage />);

    fireEvent.click(screen.getByRole("button", { name: /Step 01: User \/ agent client → ingress/ }));
    let details = screen.getByRole("complementary", { name: /selected topology details/i });
    expect(within(details).getByText(/No direct Demo Steps use case/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Step 06: Demo Agent Gateway → PingOne Authorize/ }));
    details = screen.getByRole("complementary", { name: /selected topology details/i });
    expect(within(details).getByRole("listitem")).toHaveTextContent(/UC1\s*Full flow — delegated access/);
  });

  it("includes separate PingOne and PingFederate login paths with real edges", () => {
    expect(PLAYBACKS.pingOneLogin.steps.map(({ edgeId }) => edgeId)).toEqual([
      "browser-ingress", "ingress-bff-login", "bff-browser-redirect", "browser-pingone-login", "pingone-browser-callback", "browser-ingress-callback", "ingress-bff-callback", "bff-pingone-token", "bff-browser-session",
    ]);
    expect(PLAYBACKS.pingFederateLogin.steps.map(({ edgeId }) => edgeId)).toEqual([
      "browser-ingress", "ingress-bff-login", "bff-browser-redirect", "browser-pingfederate-login", "pingfederate-browser-callback", "browser-ingress-callback", "ingress-bff-callback", "bff-pingfederate-token", "bff-browser-session",
    ]);
    expect(PLAYBACKS.pingOneLogin.result).toMatch(/PingOne/i);
    expect(PLAYBACKS.pingFederateLogin.result).toMatch(/PingFederate/i);
  });

  it("shows the selected diagram step and Demo Steps mapping in connection details", () => {
    render(<ServerTopologyPage />);

    fireEvent.click(screen.getByRole("button", { name: /^06 · /i }));

    const details = screen.getByRole("complementary", { name: /selected topology details/i });
    expect(within(details).getByText(/Diagram step 06 of 9/i)).toBeInTheDocument();
    expect(within(details).getByText(/Demo Steps mapping/i)).toBeInTheDocument();
    expect(within(details).getByRole("listitem")).toHaveTextContent(/UC1\s*Full flow — delegated access/);
  });

  it("highlights and describes inbound and outbound traffic for a selected server", () => {
    render(<ServerTopologyPage />);

    fireEvent.click(screen.getByRole("button", { name: "Demo Agent Gateway" }));

    const details = screen.getByRole("complementary", { name: /selected topology details/i });
    expect(within(details).getByRole("heading", { name: /incoming communication/i })).toBeInTheDocument();
    expect(within(details).getByText(/Step 05 · BFF agent → Demo Agent Gateway/)).toBeInTheDocument();
    expect(within(details).getByRole("heading", { name: /outgoing communication/i })).toBeInTheDocument();
    expect(within(details).getByText(/Step 06 · Demo Agent Gateway → PingOne Authorize/)).toBeInTheDocument();
  });
});
