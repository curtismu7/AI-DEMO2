import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import TraceGraphCore from "../TraceGraphCore";
import agentFixture from "../../services/__tests__/fixtures/trace-agent-run.json";
import chipFixture from "../../services/__tests__/fixtures/trace-chip-run.json";

afterEach(() => {
  jest.resetAllMocks();
});

test("rawUrl change shows loading then the new graph", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(agentFixture) }));
  const { container, rerender } = render(<TraceGraphCore rawUrl="/api/health/tracing/traces/a/raw" />);
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/health/tracing/traces/a/raw",
    expect.objectContaining({ credentials: "include" }));
  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  expect(container.textContent).toContain("AI Agent"); // DISPLAY_LABELS['agent-service']

  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(chipFixture) }));
  rerender(<TraceGraphCore rawUrl="/api/health/tracing/traces/b/raw" />);
  // A genuine rawUrl change resets to the loading state before the new data arrives.
  expect(screen.getByText("Loading graph…")).toBeInTheDocument();

  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  expect(container.textContent).toContain("App Backend (BFF)"); // DISPLAY_LABELS['demo-api-server']
});

test("refreshKey-only change does NOT blank the graph while the new fetch is in flight", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(agentFixture) }));
  const { container, rerender } = render(
    <TraceGraphCore rawUrl="/api/health/tracing/overview/raw" refreshKey={0} />,
  );
  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());

  // A controllable, still-pending fetch for the refresh tick — lets us inspect
  // the DOM mid-refetch instead of only before/after.
  let resolveRefetch;
  const pending = new Promise((resolve) => { resolveRefetch = resolve; });
  global.fetch = jest.fn(() => pending);

  rerender(<TraceGraphCore rawUrl="/api/health/tracing/overview/raw" refreshKey={1} />);

  // Same rawUrl, only refreshKey bumped: the old graph must stay on screen and
  // no loading state should appear while the second fetch is still pending.
  expect(container.querySelector("svg")).toBeInTheDocument();
  expect(screen.queryByText("Loading graph…")).not.toBeInTheDocument();

  await act(async () => {
    resolveRefetch({ ok: true, json: () => Promise.resolve(agentFixture) });
    await pending;
  });

  // The refresh resolved successfully — graph still present, no error shown.
  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  expect(screen.queryByText("Loading graph…")).not.toBeInTheDocument();
  expect(container.querySelector(".tracing-detail--error")).not.toBeInTheDocument();
});
