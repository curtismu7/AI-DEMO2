import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import TraceGraphView from "../TraceGraphView";
import agentFixture from "../../services/__tests__/fixtures/trace-agent-run.json";
import chipFixture from "../../services/__tests__/fixtures/trace-chip-run.json";

afterEach(() => {
  jest.resetAllMocks();
});

test("fetches raw trace and renders an svg with service nodes", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(agentFixture) }));
  const traceId = agentFixture.data[0].traceID;
  const { container } = render(<TraceGraphView traceId={traceId} />);
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/health/tracing/traces/${traceId}/raw`,
    expect.objectContaining({ credentials: "include" }));
  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  const labels = container.textContent;
  expect(labels).toContain("AI Agent"); // DISPLAY_LABELS['agent-service']
});

test("renders a multi-service trace with cross-service nodes and edges", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(chipFixture) }));
  const traceId = chipFixture.data[0].traceID;
  const { container } = render(<TraceGraphView traceId={traceId} />);
  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  const labels = container.textContent;
  expect(labels).toContain("App Backend (BFF)"); // DISPLAY_LABELS['demo-api-server']
  expect(labels).toContain("Agent Gateway"); // DISPLAY_LABELS['mcp-gateway']
  // At least one derived edge is drawn as a dedicated edge path element.
  await waitFor(() =>
    expect(container.querySelectorAll("path.tracing-graph-edge-path").length)
      .toBeGreaterThanOrEqual(1));
});

test("shows the error state when the trace fetch fails", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message: "Trace not found." }) }));
  render(<TraceGraphView traceId="feedfacefeedface" />);
  await waitFor(() => expect(screen.getByText(/Trace not found/i)).toBeInTheDocument());
});
