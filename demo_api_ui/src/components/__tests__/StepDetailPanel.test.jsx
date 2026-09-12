import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    // The response opens in Form (the default), so its content is on screen as
    // labelled rows rather than as the raw blob this used to assert. The point
    // of the test is that the payload is OPEN, not which view renders it.
    expect(document.querySelector(".fjt-form__row")).toBeVisible();
  });

  // Form is what opens: this panel is read off a projector, where labelled rows
  // land and a raw blob does not. A payload that is display text, not JSON, gets
  // no toggle at all rather than an empty Form view.
  it("opens a JSON payload in Form, keeping the transport line above it", () => {
    render(<StepDetailPanel step={STEP} />);
    // Request is "POST /as/token\ngrant_type=..." — no JSON body, so no toggle.
    // Response is "200 OK\n{ ... }" — one toggle, already on Form.
    expect(screen.getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "true");
    expect(
      Array.from(document.querySelectorAll(".fjt-form__row")).map((r) => r.textContent),
    ).toEqual(["scopewrite"]);
    // The transport line above the body is not a JSON leaf; it must survive.
    expect(screen.getByText("200 OK")).toBeVisible();
  });

  it("still reaches the whole raw payload through JSON", async () => {
    render(<StepDetailPanel step={STEP} />);
    await userEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByText(/"scope": "write"/)).toBeVisible();
    expect(document.querySelector(".fjt-form__row")).toBeNull();
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

describe("StepDetailPanel — gateway filter chain", () => {
  const withStages = {
    id: "gateway",
    title: "Agent Gateway — token validated",
    lane: "GATEWAY",
    status: "done",
    detail: {
      stages: [
        { raw: "TokenIntrospection", name: "Token introspection", result: "passed", status: "done", note: "RFC 7662 call to PingOne." },
        { raw: "P1AZDecision", name: "PingOne Authorize decision", result: "forwarded", status: "done", decision: "PERMIT" },
        { raw: "mTLS", name: "mTLS to MCP server", result: "skipped", status: "notinpath" },
      ],
    },
  };

  it("renders every stage, because this panel is the surface focus mode actually shows", () => {
    render(<StepDetailPanel step={withStages} />);
    expect(screen.getByText("Token introspection")).toBeInTheDocument();
    expect(screen.getByText("PingOne Authorize decision")).toBeInTheDocument();
    expect(screen.getByText("mTLS to MCP server")).toBeInTheDocument();
  });

  it("carries the decision and keeps skipped visually distinct from blocked", () => {
    const { container } = render(<StepDetailPanel step={withStages} />);
    expect(screen.getByText(/forwarded — PERMIT/)).toBeInTheDocument();
    const skipped = container.querySelector('.sdp-stage[data-status="notinpath"]');
    expect(skipped).toBeTruthy();
    expect(container.querySelector('.sdp-stage[data-status="error"]')).toBeNull();
  });

  it("renders no stage list when the step carries none", () => {
    const { container } = render(<StepDetailPanel step={{ ...withStages, detail: {} }} />);
    expect(container.querySelector(".sdp-stages")).toBeNull();
  });
});
