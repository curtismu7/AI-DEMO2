import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OboStepWire from "../OboStepWire";

const RAW = "HEADER.PAYLOAD.SIG";
const step = {
  id: 3,
  wire: {
    request: { method: "POST", url: "https://auth.pingone.com/env/as/token", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", client_id: "ex", client_secret: "***", subject_token: "SUBJ.JWT.X" } },
    response: { status: 200, body: { access_token: RAW, expires_in: 900 } },
  },
  tokens: [{ role: "delegated", label: "Delegated token", raw: RAW, decoded: { header: { alg: "RS256" }, payload: { sub: "u1", act: { client_id: "AGENT" }, aud: ["obo-demo.ping.demo"], scope: "obo:invoke", exp: 1792010389 } } }],
};

describe("OboStepWire", () => {
  it("shows the real request and response", () => {
    render(<OboStepWire step={step} />);
    const req = screen.getByRole("region", { name: "Request" });
    expect(req).toHaveTextContent("POST https://auth.pingone.com/env/as/token");
    expect(req).toHaveTextContent("grant_type=urn:ietf:params:oauth:grant-type:token-exchange");
    expect(req).toHaveTextContent("subject_token=SUBJ.JWT.X");
    const res = screen.getByRole("region", { name: "Response" });
    expect(res).toHaveTextContent("HTTP 200");
    expect(res).toHaveTextContent(`"access_token": "${RAW}"`);
  });

  it("shows the client secret only as ***", () => {
    render(<OboStepWire step={step} />);
    expect(screen.getByRole("region", { name: "Request" })).toHaveTextContent("client_secret=***");
  });

  it("shows the raw token and its decoded header and payload, with act as an object", () => {
    render(<OboStepWire step={step} />);
    const tok = screen.getByRole("region", { name: "Delegated token" });
    expect(tok).toHaveTextContent(RAW);
    expect(tok).toHaveTextContent('"alg": "RS256"');
    expect(tok).toHaveTextContent('"client_id": "AGENT"');
  });

  it("copies a block to the clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OboStepWire step={step} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Delegated token (raw)" }));
    expect(writeText).toHaveBeenCalledWith(RAW);
  });

  it("does not crash without a clipboard API", () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<OboStepWire step={step} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Copy Delegated token (raw)" }))).not.toThrow();
  });

  it("renders a wire-only step (no tokens) and a token-only step (no wire)", () => {
    const { rerender } = render(<OboStepWire step={{ wire: step.wire }} />);
    expect(screen.getByRole("region", { name: "Request" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Delegated token" })).toBeNull();
    rerender(<OboStepWire step={{ tokens: step.tokens }} />);
    expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
    expect(screen.getByRole("region", { name: "Delegated token" })).toBeInTheDocument();
  });

  it("says so when a token cannot be decoded, and still shows it raw", () => {
    render(<OboStepWire step={{ tokens: [{ role: "actor", label: "Agent (actor) token", raw: "opaque", decoded: null }] }} />);
    expect(screen.getByRole("region", { name: "Agent (actor) token" })).toHaveTextContent("opaque");
    expect(screen.getByText(/could not decode/i)).toBeInTheDocument();
  });

  it("shows PingOne's real error response for a failed hop", () => {
    render(<OboStepWire step={{ wire: { request: { method: "POST", url: "u", headers: {}, body: {} }, response: { status: 400, body: { error: "invalid_scope", error_description: "bad scope" } } } }} />);
    expect(screen.getByRole("region", { name: "Response" })).toHaveTextContent("HTTP 400");
    expect(screen.getByRole("region", { name: "Response" })).toHaveTextContent('"error": "invalid_scope"');
  });

  it("renders nothing for a step with no detail", () => {
    const { container } = render(<OboStepWire step={{ id: 7 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
