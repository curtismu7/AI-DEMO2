import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reactFlowMocks = vi.hoisted(() => ({ fitView: vi.fn(), setViewport: vi.fn(), edges: [], nodes: [] }));

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    BaseEdge: () => null,
    Controls: () => null,
    getSmoothStepPath: ({ sourceX = 0, sourceY = 0, targetX = 0, targetY = 0 }) => [
      `M${sourceX},${sourceY} L${targetX},${targetY}`,
      (sourceX + targetX) / 2,
      (sourceY + targetY) / 2,
    ],
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
    ReactFlow: ({ edges = [], nodes = [], onNodeClick, onEdgeClick, children }) => {
      reactFlowMocks.edges = edges;
      reactFlowMocks.nodes = nodes;
      return ReactModule.createElement(
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
      );
    },
    ReactFlowProvider: ({ children }) => children,
    useReactFlow: () => ({ fitView: reactFlowMocks.fitView, getViewport: () => ({ x: 24, y: 36, zoom: 0.62 }), setViewport: reactFlowMocks.setViewport }),
  };
});

import ServerTopologyPage from "../ServerTopologyPage";
import { PLAYBACKS, SERVER_EDGES } from "../serverTopologyData";

function firePointer(target, type, properties) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries(properties).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  fireEvent(target, event);
}

afterEach(() => window.localStorage.clear());

describe("Server topology use-case playback", () => {
  it("positions visible edge labels in separate padded lanes", () => {
    render(<ServerTopologyPage />);

    const edges = reactFlowMocks.edges.filter((edge) => !edge.hidden);
    const labels = edges.map((edge) => edge.data.labelPosition);
    expect(edges.every((edge) => edge.type === "topologyLabeled")).toBe(true);
    expect(labels.every((label) => Number.isFinite(label?.x) && Number.isFinite(label?.y))).toBe(true);

    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const horizontalGap = Math.abs(labels[i].x - labels[j].x)
          - (labels[i].width + labels[j].width) / 2;
        const verticalGap = Math.abs(labels[i].y - labels[j].y)
          - (labels[i].height + labels[j].height) / 2;
        expect(horizontalGap >= 8 || verticalGap >= 8).toBe(true);
      }
    }
  });

  it("keeps visible edge labels outside server cards", () => {
    render(<ServerTopologyPage />);

    const serviceNodes = reactFlowMocks.nodes.filter((node) => node.type === "server");
    const visibleLabels = reactFlowMocks.edges
      .filter((edge) => !edge.hidden)
      .map((edge) => edge.data.labelPosition);

    for (const label of visibleLabels) {
      for (const node of serviceNodes) {
        const nodeBounds = {
          x: node.position.x + 218 / 2,
          y: node.position.y + 104 / 2,
          width: 218,
          height: 104,
        };
        const horizontalDistance = Math.abs(label.x - nodeBounds.x);
        const verticalDistance = Math.abs(label.y - nodeBounds.y);
        expect(
          horizontalDistance >= (label.width + nodeBounds.width) / 2 + 8
          || verticalDistance >= (label.height + nodeBounds.height) / 2 + 8,
        ).toBe(true);
      }
    }
  });

  it("resizes and remembers the playback, detail, and notes panes with keyboard controls", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    window.localStorage.clear();
    window.localStorage.setItem("server-topology-flow-size", "158");
    window.localStorage.setItem("server-topology-details-width", "320");
    window.localStorage.setItem("server-topology-notes-size", "72");

    try {
      render(<ServerTopologyPage />);

      const flowResize = screen.getByRole("separator", { name: "Resize playback and results pane" });
      expect(flowResize).toHaveAttribute("aria-orientation", "horizontal");
      expect(flowResize).toHaveAttribute("aria-valuenow", "158");
      fireEvent.keyDown(flowResize, { key: "ArrowDown" });
      expect(flowResize).toHaveAttribute("aria-valuenow", "174");
      expect(window.localStorage.getItem("server-topology-flow-size")).toBe("174");

      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
      const detailsResize = screen.getByRole("separator", { name: "Resize map and details pane" });
      expect(detailsResize).toHaveAttribute("aria-orientation", "vertical");
      expect(detailsResize).toHaveAttribute("aria-valuenow", "320");
      fireEvent.keyDown(detailsResize, { key: "ArrowLeft" });
      expect(detailsResize).toHaveAttribute("aria-valuenow", "336");
      expect(window.localStorage.getItem("server-topology-details-width")).toBe("336");

      const notesResize = screen.getByRole("separator", { name: "Resize network and mTLS notes" });
      fireEvent.keyDown(notesResize, { key: "ArrowUp" });
      expect(notesResize).toHaveAttribute("aria-valuenow", "88");
      expect(window.localStorage.getItem("server-topology-notes-size")).toBe("88");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.localStorage.clear();
    }
  });

  it("preserves a previously saved 150px desktop playback pane size", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    window.localStorage.setItem("server-topology-flow-size", "150");

    try {
      render(<ServerTopologyPage />);
      expect(screen.getByRole("separator", { name: "Resize playback and results pane" }))
        .toHaveAttribute("aria-valuenow", "150");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.localStorage.clear();
    }
  });

  it("switches the map/details divider to a vertical resize on narrow screens", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    window.localStorage.clear();

    try {
      render(<ServerTopologyPage />);
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));

      const detailsResize = screen.getByRole("separator", { name: "Resize map and details pane" });
      expect(detailsResize).toHaveAttribute("aria-orientation", "horizontal");
      fireEvent.keyDown(detailsResize, { key: "ArrowUp" });
      expect(detailsResize).toHaveAttribute("aria-valuenow", "336");
      expect(window.localStorage.getItem("server-topology-details-height")).toBe("336");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.localStorage.clear();
    }
  });

  it("reserves enough narrow-screen height for the stacked playback and result controls", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    window.localStorage.clear();

    try {
      render(<ServerTopologyPage />);

      const flowResize = screen.getByRole("separator", { name: "Resize playback and results pane" });
      expect(flowResize).toHaveAttribute("aria-valuemin", "180");
      expect(flowResize).toHaveAttribute("aria-valuenow", "220");

      const notesResize = screen.getByRole("separator", { name: "Resize network and mTLS notes" });
      expect(notesResize).toHaveAttribute("aria-valuemin", "112");
      expect(notesResize).toHaveAttribute("aria-valuenow", "144");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.localStorage.clear();
    }
  });

  it("resizes the playback pane by dragging its divider", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    window.localStorage.clear();
    render(<ServerTopologyPage />);

    const flowResize = screen.getByRole("separator", { name: "Resize playback and results pane" });
    expect(flowResize).toHaveAttribute("aria-valuenow", "92");
    firePointer(flowResize, "pointerdown", { button: 0, pointerId: 1, clientX: 12, clientY: 100 });
    expect(flowResize).toHaveAttribute("data-resizing", "true");
    firePointer(flowResize, "pointermove", { pointerId: 1, clientX: 12, clientY: 132 });
    expect(flowResize).toHaveAttribute("aria-valuenow", "124");
    firePointer(flowResize, "pointerup", { pointerId: 1, clientX: 12, clientY: 132 });

    expect(flowResize).toHaveAttribute("aria-valuenow", "124");
    expect(window.localStorage.getItem("server-topology-flow-size")).toBe("124");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });

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

  it("refits the graph when opening details reduces its available width", async () => {
    reactFlowMocks.fitView.mockClear();
    render(<ServerTopologyPage />);
    await waitFor(() => expect(reactFlowMocks.fitView).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    await waitFor(() => expect(reactFlowMocks.fitView).toHaveBeenCalledTimes(2));
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
