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

// The claim diff is the strongest explainer of RFC 8693 delegation, so the
// mock puts before/after side by side with only the moved rows marked.
const DIFF_STEP = {
  ...STEP,
  detail: {
    ...STEP.detail,
    beforeAfter: {
      before: { title: "User token", text: '{"scope":"read write","aud":"banking-api","exp":1000}' },
      after: { title: "Delegated token", text: '{"scope":"write","aud":"mcp-gw","exp":900,"act":{"sub":"agent-001"}}' },
    },
  },
};

describe("StepDetailPanel", () => {
  it("puts what happened above the payloads", () => {
    render(<StepDetailPanel step={STEP} />);
    const order = Array.from(document.querySelectorAll(".sdp-section-label")).map((e) => e.textContent);
    expect(order).toEqual(["What happened", "What changed", "Request", "Response"]);
  });

  // The mock's prose says "raw payloads collapsed"; the mock's screenshot shows
  // REQUEST and RESPONSE fully open. The screenshot is the agreed reference.
  it("shows request and response payloads open, not behind a disclosure", () => {
    render(<StepDetailPanel step={STEP} />);
    expect(document.querySelectorAll(".sdp-payload")).toHaveLength(2);
    expect(document.querySelector(".sdp details")).toBeNull();
    expect(screen.getByText(/grant_type=\.\.\.token-exchange/)).toBeVisible();
    expect(screen.getByText(/"scope": "write"/)).toBeVisible();
  });

  it("renders what changed as before and after, marking only the moved claims", () => {
    render(<StepDetailPanel step={DIFF_STEP} />);
    expect(document.querySelectorAll(".sdp-ba-col")).toHaveLength(2);
    const marked = [...document.querySelectorAll(".sdp-ba-row--changed")].map((e) => e.dataset.claim);
    // scope narrowed, aud rebound, exp shortened, act appeared.
    expect(new Set(marked)).toEqual(new Set(["scope", "aud", "exp", "act"]));
  });

  it("says so when a step changed nothing, instead of faking a diff", () => {
    render(<StepDetailPanel step={{
      id: "website", title: "Website — browser", lane: "BROWSER", status: "done",
      detail: { narrative: "The browser loaded the app." },
    }} />);
    expect(screen.getByText(/nothing changed/i)).toBeInTheDocument();
    expect(screen.queryByText("What changed")).toBeNull();
  });

  it("does not claim a step changed nothing when it has not run yet", () => {
    for (const status of ["pending", "notinpath"]) {
      const { unmount } = render(<StepDetailPanel step={{
        id: "gateway", title: "Agent Gateway", lane: "GATEWAY", status,
        detail: { narrative: "Static teaching text shown before the run." },
      }} />);
      expect(screen.queryByText(/nothing changed/i)).toBeNull();
      unmount();
    }
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
