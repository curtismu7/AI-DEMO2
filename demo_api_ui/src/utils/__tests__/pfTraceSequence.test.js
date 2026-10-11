import { describe, expect, it } from "vitest";
import { buildSequenceFromTrace, sequenceSource } from "../pfTraceSequence";

// Sample shapes mirror what the BFF's pfAiAgent route actually returns in
// `trace` — id/title/request.url/response.status with secrets replaced.
const RAR_TRACE = [
  { id: "par", title: "PAR", request: { method: "POST", url: "/api/pf-ai-agent/par" }, response: { status: 201 } },
  { id: "authorize", title: "Authorize", request: { method: "GET", url: "https://pf.example/as/authorize.oauth2?request_uri=urn:ietf" }, response: { status: 302 } },
  { id: "callback", title: "Callback", request: { method: "GET", url: "/api/pf-ai-agent/rar/callback?code=xxx" }, response: { status: 200 } },
  { id: "token", title: "Token", request: { method: "POST", url: "/api/pf-ai-agent/rar/token" }, response: { status: 200 } },
];

const EXCHANGE_TRACE = [
  { id: "pf-exchange", title: "PF exchange", request: { method: "POST", url: "/api/pf-ai-agent/cross-domain/exchange" }, response: { status: 200 } },
  { id: "verify", title: "Verify ID-JAG", request: { method: "GET", url: "https://pf.example/.well-known/jwks" }, response: { status: 200 } },
  { id: "redeem", title: "Redeem", request: { method: "POST", url: "https://third.example/oauth/token" }, response: { status: 200 } },
];

describe("buildSequenceFromTrace", () => {
  it("renders one message per captured step with HTTP status", () => {
    const source = buildSequenceFromTrace(RAR_TRACE);
    expect(source).toMatch(/^sequenceDiagram/);
    expect(source).toContain("App (BFF)->>PingFederate: par (HTTP 201)");
    expect(source).toContain("Browser->>PingFederate:");
    expect(source).toContain("PingFederate->>Browser:");
  });

  it("keeps an unknown step id rendering as a message instead of vanishing", () => {
    const source = buildSequenceFromTrace([
      { id: "some-new-bff-step", title: "New step", request: { url: "/api/pf-ai-agent/some-new-bff-step" } },
    ]);
    expect(source).toContain("App (BFF)->>PingFederate: some-new-bff-step");
  });

  it("renders a same-actor step as a note unless selfCall is set", () => {
    const noteSource = buildSequenceFromTrace(EXCHANGE_TRACE);
    expect(noteSource).toContain("Note over App (BFF):");
    expect(noteSource).not.toContain("App (BFF)->>App (BFF)");

    const selfSource = buildSequenceFromTrace(EXCHANGE_TRACE, { selfCall: true });
    expect(selfSource).toContain("App (BFF)->>App (BFF)");
  });

  it("returns empty string for nothing to draw", () => {
    expect(buildSequenceFromTrace([])).toBe("");
    expect(buildSequenceFromTrace(null)).toBe("");
  });

  it("sequenceSource maps empty to null so callers can skip the diagram", () => {
    expect(sequenceSource([])).toBeNull();
    expect(sequenceSource(RAR_TRACE)).toMatch(/^sequenceDiagram/);
  });
});
