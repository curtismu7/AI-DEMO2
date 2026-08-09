import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StepDetailPanel from "../StepDetailPanel";

const STEP = {
  id: "exchange",
  title: "Token exchange — delegation",
  lane: "BFF",
  status: "done",
  detail: {
    narrative: "Subject plus actor are exchanged for one delegated token.",
    kv: [["scope", "write"], ["act", "agent-001"]],
    request: { title: "Exchange request", text: "POST /as/token\ngrant_type=...token-exchange" },
    response: { title: "Delegated token", text: "200 OK\n{ \"scope\": \"write\" }" },
    rfcs: ["RFC 8693"],
  },
};

describe("StepDetailPanel", () => {
  it("puts what happened above the payloads", () => {
    render(<StepDetailPanel step={STEP} />);
    const order = Array.from(document.querySelectorAll(".sdp-section-label")).map((e) => e.textContent);
    expect(order).toEqual(["What happened", "What changed", "Request", "Response"]);
  });

  it("renders request and response uncollapsed", () => {
    render(<StepDetailPanel step={STEP} />);
    expect(screen.getByText(/grant_type=\.\.\.token-exchange/)).toBeVisible();
    expect(screen.getByText(/"scope": "write"/)).toBeVisible();
    expect(document.querySelector("details")).toBeNull();
  });

  it("omits sections the step has no data for, rather than showing empty ones", () => {
    render(<StepDetailPanel step={{ id: "prompt", title: "Prompt", lane: "CHAT", status: "done", detail: {} }} />);
    expect(screen.queryByText("Request")).toBeNull();
    expect(screen.queryByText("What changed")).toBeNull();
  });

  it("never reports an in-flight step as complete", () => {
    render(<StepDetailPanel step={{ ...STEP, status: "active" }} />);
    expect(screen.getByText("In flight")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
