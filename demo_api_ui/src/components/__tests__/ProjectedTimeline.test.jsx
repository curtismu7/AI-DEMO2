import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectedTimeline from "../ProjectedTimeline";

const PROJECTION = {
  traceId: "a1b2c3d4e5f60718",
  traceStartedAt: "2026-07-18T10:00:00.000Z",
  traceDurationMs: 812,
  outcome: "ok",
  spans: [
    {
      id: "agent_reasoning", title: "Agent Reasoning", icon: "brain", status: "ok",
      summary: [
        { facet: "outcome", value: "2 reasoning steps" },
        { facet: "additionalMetadata", key: "provider", value: "llamacpp" },
      ],
      source: "agent-service / reasoning-step-1", durationMs: 420,
      details: { provider: "llamacpp" }, ids: ["s1", "s2"], traceID: "a1b2c3d4e5f60718",
    },
    {
      id: "tool_call", title: "Tool Call", icon: "bolt", status: "error",
      summary: [{ facet: "target", value: "get_accounts" }],
      source: "agent-service / tool-execution", durationMs: 95,
      details: { tool_name: "get_accounts" }, ids: ["s3"], traceID: "a1b2c3d4e5f60718",
    },
  ],
};

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(PROJECTION) }));
});
afterEach(() => jest.resetAllMocks());

test("renders one card per projected span with facets", async () => {
  render(<ProjectedTimeline traceId={PROJECTION.traceId} />);
  await waitFor(() => expect(screen.getByText("Agent Reasoning")).toBeInTheDocument());
  expect(screen.getByText("Tool Call")).toBeInTheDocument();
  expect(screen.getByText("2 reasoning steps")).toBeInTheDocument();
  expect(screen.getByText("provider")).toBeInTheDocument();
  expect(screen.getByText("llamacpp")).toBeInTheDocument();
});

test("error-status card is visually flagged and details expand on click", async () => {
  render(<ProjectedTimeline traceId={PROJECTION.traceId} />);
  await waitFor(() => expect(screen.getByText("Tool Call")).toBeInTheDocument());
  const errCard = screen.getByText("Tool Call").closest(".tracing-step-card");
  expect(errCard.className).toContain("tracing-step-card--error");
  await userEvent.click(screen.getByText("Tool Call"));
  expect(screen.getByText(/tool_name/)).toBeInTheDocument();
});

test("empty projection explains itself", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ...PROJECTION, spans: [] }) }));
  render(<ProjectedTimeline traceId={PROJECTION.traceId} />);
  await waitFor(() =>
    expect(screen.getByText(/No recognized steps in this trace/i)).toBeInTheDocument());
});
