// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.directSignIn.test.jsx
//
// "No Privilege in the path" (Direct mode's own copy) describes what Direct
// adds on top of a door, not whether the door itself needs a bearer — the
// opensearch/brave doors still façade-challenge (requireBearer, mcpFacade.js).
// requestSignIn() used to hard-return for gatewayMode==='direct', so a real
// 401 from one of those doors was swallowed: 0 tools, no path to fix it, and
// a misleading "No sign-in required" label sitting right next to the failure.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

function mockState() {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://ai-demo.example.com/mcp-facade/opensearch/mcp", clientId: "a6219652", scopes: "openid profile email" },
            gatewayMode: "direct",
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            oauth: { authenticated: true },
            mainAppAuthenticated: true,
            tools: [],
            presets: [],
          }),
      });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      // Matches the real BFF's res.status(relayFailureStatus(err)).json({ error: err.message })
      // — a plain string carrying the upstream's own JSON-RPC error inline.
      return Promise.resolve({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: 'MCP request failed: 401 {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Unauthorized","data":{"reason":"audience_mismatch"}}}',
          }),
      });
    }
    return new Promise(() => {});
  });
}

function renderAt(entry) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

describe("Direct mode sign-in on a real door challenge", () => {
  it("shows Sign in to continue when a Direct door's tools/list 401s", async () => {
    mockState();
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(screen.getByText("Sign in to continue")).toBeTruthy());
  });
});
