// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.silentAutoConnect.test.jsx
//
// The Privilege gateway is its own authorization server, so the banking app's
// PingOne token can never be reused directly — a separate token is required.
// But the BFF sends prompt=none when the main app session exists, so that token
// costs a redirect and no login page. The page used to stop and ask for a click
// anyway, which read as "why am I logging in again when I'm already logged in".
//
// The one thing that must not regress: auto-start fires ONCE. After a round trip
// the BFF has set privilegePromptNoneFailed, so auto-starting again would send
// the user to a real PingOne login page they never asked for.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const AUTH_URL = "https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/authorize?client_id=dcr-1";

function mockState({ mainAppAuthenticated, authenticated = false }) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp", clientId: "a6219652", scopes: "openid profile email" },
            gatewayMode: "agentless",
            gatewayConfigs: { agent: {}, agentless: {} },
            oauth: { authenticated },
            mainAppAuthenticated,
            tools: [],
            presets: [],
          }),
      });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ authUrl: AUTH_URL }),
      });
    }
    return new Promise(() => {});
  });
}

function authStartCalls() {
  return global.fetch.mock.calls.filter(
    ([url, opts]) => String(url).endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST",
  );
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
  // jsdom refuses a real navigation assignment; the page only ever sets href.
  delete window.location;
  window.location = { href: "", search: "" };
});

describe("Privilege silent auto-connect", () => {
  it("auto-starts OAuth when the main app is signed in and Privilege is not", async () => {
    mockState({ mainAppAuthenticated: true });
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(authStartCalls()).toHaveLength(1));
    await waitFor(() => expect(window.location.href).toBe(AUTH_URL));
    // No modal — the whole point is that the user is not asked.
    expect(screen.queryByText("Sign in to continue")).toBeNull();
  });

  it("does NOT auto-start after a round trip, so a failed silent attempt cannot force a login page", async () => {
    mockState({ mainAppAuthenticated: true });
    renderAt("/privilege-mcp-client?auth=silent_failed");

    await waitFor(() => expect(screen.getByText("Sign in to continue")).toBeTruthy());
    expect(authStartCalls()).toHaveLength(0);
    expect(window.location.href).toBe("");
  });

  it("does not auto-start when the main app is not signed in", async () => {
    mockState({ mainAppAuthenticated: false });
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(authStartCalls()).toHaveLength(0);
  });
});
