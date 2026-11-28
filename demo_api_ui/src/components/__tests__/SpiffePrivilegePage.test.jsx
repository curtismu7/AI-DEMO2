import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SpiffePrivilegePage from "../SpiffePrivilegePage";

vi.mock("../../services/apiClient", () => ({
  default: { post: vi.fn() },
}));

// Stub global fetch: the page calls it directly (bypasses apiClient's 10s
// default timeout, which is shorter than a cold mint+gateway round trip).
function fetchOk(json) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
}

import apiClient from "../../services/apiClient";

const OK_RESPONSE = {
  data: {
    call: "spiffe-privilege-workload-identity",
    token_mode: "raw-svid",
    issuer: "spiffe (SPIRE OIDC discovery provider)",
    claims: { iss: "https://local.ping-devops.com:8443", sub: "spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent", aud: ["priv-nhi-test"] },
    gateway: { url: "https://mcpgw.example/spire-mcp/mcp", status: 200, body: "event: message\ndata: {\"result\":{\"tools\":[{\"name\":\"ListIndexTool\"}]}}" },
    access_token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzcGlmZmUifQ.signature-value-aaaaaaaaaaaaaaaa",
  },
};

describe("SpiffePrivilegePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the three token shapes", () => {
    render(<SpiffePrivilegePage />);
    expect(screen.getByText("Raw SVID")).toBeInTheDocument();
    expect(screen.getByText("PF-exchanged token")).toBeInTheDocument();
    expect(screen.getByText("PF client-credentials baseline")).toBeInTheDocument();
  });

  it("a 200 tools/list result renders a PERMIT verdict and the inspector", async () => {
    global.fetch = vi.fn(() => fetchOk(OK_RESPONSE.data));
    render(<SpiffePrivilegePage />);
    fireEvent.click(screen.getAllByRole("button", { name: /run this shape/i })[0]);
    await waitFor(() => expect(screen.getAllByText(/PERMIT/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Decoded token claims/i)).toBeInTheDocument();
    expect(screen.getByText(/spiffe:\/\/bxfinance\.demo/)).toBeInTheDocument();
    // token is redacted, never shown raw
    expect(screen.queryByText(OK_RESPONSE.data.access_token)).not.toBeInTheDocument();
  });

  it("a 401 token_not_found renders an honest REFUSED verdict", async () => {
global.fetch = vi.fn(() => fetchOk({
        token_mode: "pf-exchanged",
        claims: { sub: "x" },
        access_token: "tok",
        gateway: { url: "https://gw/spire-mcp/mcp", status: 401, body: { error: "unauthorized", error_description: "Bearer token required" } },
      }));
    render(<SpiffePrivilegePage />);
    fireEvent.click(screen.getAllByRole("button", { name: /run this shape/i })[1]);
    await waitFor(() => expect(screen.getByText(/REFUSED/)).toBeInTheDocument());
    expect(screen.getByText(/front door/)).toBeInTheDocument();
    // the gateway body is shown through the shared JSON pane, not a hand-rolled <pre>
    expect(screen.getAllByText(/Bearer token required/).length).toBeGreaterThan(0);
    expect(screen.getByText(/HTTP 401 https:\/\/gw\/spire-mcp\/mcp/)).toBeInTheDocument();
  });

  it("an error response shows its detail object in the Error detail inspector", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: "upstream_failed", error_description: "PF said no", hint: "retry in a minute" }) }));
    render(<SpiffePrivilegePage />);
    fireEvent.click(screen.getAllByRole("button", { name: /run this shape/i })[0]);
    await waitFor(() => expect(screen.getByText(/Error detail/)).toBeInTheDocument());
    expect(screen.getAllByText(/retry in a minute/).length).toBeGreaterThan(0);
  });

  it("a 503 config error from the BFF surfaces the message without crashing", async () => {
global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: "spiffe_privilege_unavailable", error_description: "SPIFFE Privilege gateway calls are disabled (ff_spiffe_privilege)" }),
    }));
    render(<SpiffePrivilegePage />);
    fireEvent.click(screen.getAllByRole("button", { name: /run this shape/i })[2]);
    await waitFor(() => expect(screen.getAllByText(/ff_spiffe_privilege/i).length).toBeGreaterThan(0));
  });
});
