// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.doorSwitchReauth.test.jsx
//
// 2026-09-09. Reported as "every Path and every Door fails" — 13 of 14 doors
// answered 401 "Not authenticated", and signing in again never stuck.
//
// session.oauth is a single slot keyed `mode::mcpUrl` (privilegeMcpClient.js
// oauthKey). Switching door or path stashes the outgoing token and restores the
// destination key's — or NULLS the slot when that key has none. So the very act
// of switching de-authenticates the client, and tools/list 401s before any door
// logic runs. That part is deliberate; a cross-key token is rejected anyway.
//
// What was missing is the other half: re-authenticating afterwards. Mount-time
// auto-connect does it, which is why the door you land on works. switchDoor did
// not do it at all, and switchGatewayMode skipped it for Direct on the reading
// that "Direct has no auth front door" — the same wrong reading the 2026-09-07
// fix already removed from mount-time auto-connect, where the comment now says
// every direct door is a façade door with requireBearer.
//
// POST /config already answers `oauth: { authenticated }` for the DESTINATION
// key. These tests pin that both switchers act on it.
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const AUTH_URL = "https://gateway.example/authorize?client_id=dcr-1";
const DOOR_A = "https://local.ping-devops.com:4000/mcp-facade/opensearch/mcp";
const DOOR_B = "https://local.ping-devops.com:4000/mcp-facade/brave/mcp";
const PRIV_DOOR = "https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp";

// `configAuthenticated` is what the BFF reports for the key being switched TO.
// false is the reported bug's shape: a door this session has never signed into.
function mockGateway({ gatewayMode = "direct", mcpUrl = DOOR_A, configAuthenticated = false }) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) });

    if (u.endsWith("/api/privilege-mcp/state")) {
      return json({
        config: { mcpUrl, clientId: "", scopes: "openid profile email" },
        gatewayMode,
        gatewayConfigs: {
          direct: { mcpUrl: DOOR_A, clientId: "", scopes: "openid profile email" },
          privilege: { mcpUrl: PRIV_DOOR, clientId: "", scopes: "openid profile email" },
          facade: { mcpUrl: DOOR_A, clientId: "", scopes: "openid profile email" },
        },
        // Already signed in for the door we land on, so mount-time auto-connect
        // stays out of the way and any /auth/start belongs to the switch.
        oauth: { authenticated: true },
        mainAppAuthenticated: true,
        tools: [],
        presets: [
          { label: "Direct — opensearch", mode: "direct", url: DOOR_A },
          { label: "Direct — Brave Search", mode: "direct", url: DOOR_B },
          { label: "Privilege — opensearch22", mode: "privilege", url: PRIV_DOOR },
        ],
      });
    }
    if (u.endsWith("/api/privilege-mcp/config") && opts?.method === "POST") {
      const body = JSON.parse(opts.body || "{}");
      return json({
        ok: true,
        config: { mcpUrl: body.mcpUrl, clientId: "", scopes: "openid profile email" },
        gatewayMode: body.gatewayMode || gatewayMode,
        gatewayConfigs: {
          direct: { mcpUrl: DOOR_A },
          privilege: { mcpUrl: PRIV_DOOR },
          facade: { mcpUrl: DOOR_A },
        },
        oauth: { authenticated: configAuthenticated },
      });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST") {
      return json({ authUrl: AUTH_URL });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      return json({ tools: [], policy: { total: 0, permitted: 0, filtered: 0, filteredTools: [] } });
    }
    return new Promise(() => {});
  });
}

const callsTo = (path, method = "POST") =>
  global.fetch.mock.calls.filter(
    ([url, opts]) => String(url).endsWith(`/api/privilege-mcp/${path}`) && opts?.method === method,
  );

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
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

describe("Privilege client — re-auth on switch", () => {
  it("signs in again after switching to a door this session has no token for", async () => {
    mockGateway({ configAuthenticated: false });
    renderPage();

    const door = await screen.findByLabelText("MCP backend (door)");
    fireEvent.change(door, { target: { value: DOOR_B } });

    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    // Without this the door switch leaves the slot nulled and every later
    // tools/list answers 401 "Not authenticated" — the reported bug.
    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1));
    await waitFor(() => expect(window.location.href).toBe(AUTH_URL));
  });

  it("does NOT sign in again when the destination door already has a live token", async () => {
    mockGateway({ configAuthenticated: true });
    renderPage();

    const door = await screen.findByLabelText("MCP backend (door)");
    fireEvent.change(door, { target: { value: DOOR_B } });

    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    await waitFor(() => expect(callsTo("tools/list")).not.toHaveLength(0));
    // A redirect here is the regression the stash exists to prevent: it would
    // show a sign-in for a door the user already signed into.
    expect(callsTo("auth/start")).toHaveLength(0);
    expect(window.location.href).toBe("");
  });

  // Direct is not exempt: every direct door is a façade door with requireBearer
  // (mcpFacade.js DOORS), so switching INTO Direct without re-auth left every
  // one of its doors answering "Not authenticated" forever.
  it("signs in again after switching the path to Direct", async () => {
    mockGateway({ gatewayMode: "privilege", mcpUrl: PRIV_DOOR, configAuthenticated: false });
    renderPage();

    const path = await screen.findByLabelText("Connection path");
    fireEvent.change(path, { target: { value: "direct" } });

    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1));
  });
});
