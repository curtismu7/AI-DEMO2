/**
 * gw-aam — the API Access Management box in the token chain.
 *
 * AAM is the demo's COARSE-grained authorization layer: it sees method, path,
 * headers and client IP, and nothing about MCP tools. It renders alongside
 * gw-authorize (the fine-grained per-tool decision) rather than instead of it —
 * the two capabilities running side by side is the point being demonstrated.
 *
 * The box is tested directly rather than through TokenChainDisplay, which takes
 * no events prop and sources them from context; the surrounding tests follow the
 * same named-export convention.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { AamDecisionEduBox } from "../TokenChainDisplay";

const aamEvent = (overrides = {}) => ({
  id: "gw-aam",
  decision: "DENY",
  backend: "mock",
  serviceUri: "http://authz-server:9001/sideband/request",
  elapsedMs: 8,
  request: {
    method: "GET",
    url: "http://api.ping.demo:3036/aam/health",
    headers: [{ Authorization: "<redacted>" }],
  },
  response: {
    response: { response_code: "403", response_status: "Forbidden" },
  },
  ...overrides,
});

describe("AamDecisionEduBox", () => {
  test("renders only for gw-aam events", () => {
    const { container } = render(
      <AamDecisionEduBox event={{ id: "gw-authorize", decision: "PERMIT" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  test("names the capability so it is distinguishable from the per-tool decision", () => {
    render(<AamDecisionEduBox event={aamEvent()} />);
    expect(screen.getByText(/API Access Management/i)).toBeInTheDocument();
  });

  test("shows a DENY decision with the error styling", () => {
    const { container } = render(<AamDecisionEduBox event={aamEvent()} />);
    expect(screen.getByText(/DENY/)).toBeInTheDocument();
    expect(container.querySelector(".tcd-edu-box--error")).toBeTruthy();
  });

  test("shows a PERMIT decision with the ok styling", () => {
    const { container } = render(
      <AamDecisionEduBox event={aamEvent({ decision: "PERMIT", response: {} })} />,
    );
    expect(screen.getByText(/PERMIT/)).toBeInTheDocument();
    expect(container.querySelector(".tcd-edu-box--ok")).toBeTruthy();
  });

  test("distinguishes the mock backend from real PingOne", () => {
    render(<AamDecisionEduBox event={aamEvent()} />);
    expect(screen.getByText(/Mock Sideband/i)).toBeInTheDocument();
  });

  test("labels the real backend when not simulated", () => {
    // The box header also says "PingOne Authorize", so match the backend label
    // exactly rather than by substring — a loose match would pass on the header
    // alone and prove nothing about the backend.
    const { container } = render(<AamDecisionEduBox event={aamEvent({ backend: "real" })} />);
    const labels = [...container.querySelectorAll("strong")].map((n) => n.textContent);
    expect(labels).toContain("PingOne Authorize");
    expect(labels).not.toContain("Mock Sideband");
  });

  test("renders the captured Sideband request and response", () => {
    const { container } = render(<AamDecisionEduBox event={aamEvent()} />);
    const code = container.querySelectorAll("pre.tcd-edu-code");
    expect(code.length).toBe(2);
  });

  test("shows the redacted Authorization rather than a token", () => {
    // Redaction happens at capture in the gateway; this asserts the UI does not
    // somehow reconstruct or reveal a bearer.
    const { container } = render(<AamDecisionEduBox event={aamEvent()} />);
    expect(container.textContent).toContain("<redacted>");
    expect(container.textContent).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}/);
  });

  test("degrades without throwing when the probe returned no trail", () => {
    const bare = { id: "gw-aam", decision: null, request: null, response: null };
    const { container } = render(<AamDecisionEduBox event={bare} />);
    expect(container.querySelectorAll("pre.tcd-edu-code").length).toBe(0);
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });
});
