// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.pingoneAdminLogin.test.jsx
//
// pingoneAdminLocalHandler's own auth requirement (delegated PKCE — see
// routes/mcpPingOneAdminAuth.js) is a separate flow from this page's OAuth.
// A tools/list 401 carrying { loginUrl } should navigate the browser there
// once, not fall into the generic "Sign in to continue" modal — and a return
// trip (?pingone_admin_login=success) should refresh tools automatically.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const LOGIN_URL = "/api/mcp/inspector/pingone-admin/login?returnTo=%2Fprivilege-mcp-client";

function mockState({ pingoneAdminLoginQuery } = {}) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://ai-demo.example.com/mcp-facade/pingone-admin/mcp", clientId: "client-1", scopes: "openid profile email" },
            gatewayMode: "direct",
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            oauth: { authenticated: !pingoneAdminLoginQuery }, // avoid the unrelated auto-refresh-on-mount path
            mainAppAuthenticated: true,
            tools: [],
            presets: [],
          }),
      });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      return Promise.resolve({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: 'MCP request failed: 401 {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Unauthorized","data":{"reason":"pingone_admin_login_required","loginUrl":"' + LOGIN_URL + '"}}}',
            loginUrl: LOGIN_URL,
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
  delete window.location;
  window.location = { href: "", search: "" };
});

describe("pingone-admin door's delegated-PKCE login", () => {
  it("navigates to loginUrl on a fresh visit, without opening the generic Sign In modal", async () => {
    mockState();
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(window.location.href).toBe(LOGIN_URL));
    expect(screen.queryByText("Sign in to continue")).toBeNull();
  });

  it("does NOT navigate again when already returning from that exact round trip (loop guard)", async () => {
    mockState({ pingoneAdminLoginQuery: true });
    renderAt("/privilege-mcp-client?pingone_admin_login=success");

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Give the async refreshTools chain a tick to run and (not) navigate.
    await new Promise((r) => setTimeout(r, 10));
    expect(window.location.href).toBe("");
  });
});
