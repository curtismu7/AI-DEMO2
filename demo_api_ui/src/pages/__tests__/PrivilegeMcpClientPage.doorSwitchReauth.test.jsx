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
//
// A Privilege door has its own OAuth grant. When the current app or Gateway
// session is valid, switching to an unconnected door or path should silently
// authorize that destination and fetch its tools after the callback. Every path
// still receives its own grant from its own authorization server.
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
const PRIV_DOOR = "https://mcpgw.ai-demo.ping-devops.com/opensearch-hitl/mcp";
const PRIV_DOOR_B = "https://mcpgw.ai-demo.ping-devops.com/brave/mcp";
const SILENT_DOOR_SWITCH_KEY = "cur_priv_silent_door_switch";

// `configAuthenticated` is what the BFF reports for the key being switched TO.
// false is the reported bug's shape: a door this session has never signed into.
function mockGateway({
  gatewayMode = "direct",
  mcpUrl = DOOR_A,
  configAuthenticated = false,
  configDestinationAuthenticated = configAuthenticated,
  initialOAuthAuthenticated = true,
  mainAppAuthenticated = true,
  silentPromptAvailable = true,
  authStartError = null,
  listedTools = [],
}) {
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
        oauth: { authenticated: initialOAuthAuthenticated },
        mainAppAuthenticated,
        tools: [],
        presets: [
          { label: "Direct — opensearch", mode: "direct", url: DOOR_A },
          { label: "Direct — Brave Search", mode: "direct", url: DOOR_B },
          { label: "Privilege — opensearch-hitl", mode: "privilege", url: PRIV_DOOR },
          { label: "Privilege — brave", mode: "privilege", url: PRIV_DOOR_B },
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
        oauth: {
          authenticated: configAuthenticated,
          destinationAuthenticated: configDestinationAuthenticated,
        },
      });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST") {
      if (authStartError) return Promise.reject(new Error(authStartError));
      return json({ authUrl: silentPromptAvailable ? `${AUTH_URL}&prompt=none` : AUTH_URL });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      return json({ tools: listedTools, policy: { total: listedTools.length, permitted: listedTools.length, filtered: 0, filteredTools: [] } });
    }
    return new Promise(() => {});
  });
}

const callsTo = (path, method = "POST") =>
  global.fetch.mock.calls.filter(
    ([url, opts]) => String(url).endsWith(`/api/privilege-mcp/${path}`) && opts?.method === method,
  );

function renderPage(initialEntry = "/privilege-mcp-client") {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
  sessionStorage.clear();
});

describe("Privilege client — re-auth on switch", () => {
  it("offers Sign in — and does NOT navigate — after switching to a door with no token", async () => {
    mockGateway({ configAuthenticated: false });
    renderPage();

    const door = await screen.findByLabelText("MCP backend (door)");
    fireEvent.change(door, { target: { value: DOOR_B } });

    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    // The affordance the user acts on, in place of the old auto-redirect.
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy());
    // Nothing may leave the page on its own — this is the whole point.
    expect(callsTo("auth/start")).toHaveLength(0);
    expect(window.location.href).toBe("");
  });

  it("silently authorizes a new Privilege door when the current Gateway session is active", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR,
      configAuthenticated: true,
      configDestinationAuthenticated: false,
      initialOAuthAuthenticated: true,
      mainAppAuthenticated: false,
    });
    renderPage();

    const door = await screen.findByLabelText("MCP backend (door)");
    fireEvent.change(door, { target: { value: PRIV_DOOR_B } });

    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1));
    expect(window.location.href).toBe(`${AUTH_URL}&prompt=none`);
    expect(screen.queryByText("Sign in to the gateway")).toBeNull();
  });

  it("does not fetch tools after silent authorization returns for a door switch — the user presses Get MCP Tools", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR_B,
      configAuthenticated: true,
      initialOAuthAuthenticated: true,
      mainAppAuthenticated: false,
      listedTools: [{ name: "ListIndexTool", description: "Lists indices" }],
    });
    sessionStorage.setItem(SILENT_DOOR_SWITCH_KEY, "1");
    sessionStorage.setItem("cur_priv_switching", "1");
    renderPage("/privilege-mcp-client?auth=success");

    await waitFor(() => expect(sessionStorage.getItem("cur_priv_switching")).toBeNull());
    expect(callsTo("tools/list")).toHaveLength(0);
    expect(screen.queryByText("ListIndexTool")).toBeNull();
  });

  it("keeps manual sign-in available when a silent Privilege flow is unavailable", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR,
      configAuthenticated: false,
      initialOAuthAuthenticated: true,
      mainAppAuthenticated: false,
      silentPromptAvailable: false,
    });
    renderPage();

    const door = await screen.findByLabelText("MCP backend (door)");
    fireEvent.change(door, { target: { value: PRIV_DOOR_B } });

    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1));
    expect(window.location.href).toBe("");
    expect(await screen.findByRole("dialog", { name: "Sign in to the gateway" })).toBeTruthy();
  });

  it("offers interactive fallback after silent auth fails without a main-app session", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR_B,
      configAuthenticated: false,
      initialOAuthAuthenticated: false,
      mainAppAuthenticated: false,
    });
    renderPage("/privilege-mcp-client?auth=silent_failed");

    expect(await screen.findByRole("dialog", { name: "Sign in to the gateway" })).toBeTruthy();
    expect(callsTo("auth/start")).toHaveLength(0);
  });

  it("does NOT sign in again when the destination door already has a live token", async () => {
    mockGateway({ configAuthenticated: true });
    renderPage();

    const door = await screen.findByLabelText("MCP backend (door)");
    fireEvent.change(door, { target: { value: DOOR_B } });

    // The `config` call IS the switch completing — that is what proves this
    // path ran without redirecting.
    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    // Switching a door no longer discovers. Selecting a door says which one to
    // use, not that you want it probed, and probing spends a real call on it —
    // on a denying door that pops the denial modal for a switch nobody asked to
    // test. "Get MCP Tools" is the only control that fetches. This assertion
    // used to be `not.toHaveLength(0)`, using discovery as a proxy for "the
    // switch happened"; `config` above carries that now.
    await new Promise((r) => setTimeout(r, 50));
    expect(callsTo("tools/list")).toHaveLength(0);
    // A redirect here is the regression the stash exists to prevent: it would
    // show a sign-in for a door the user already signed into.
    expect(callsTo("auth/start")).toHaveLength(0);
    expect(window.location.href).toBe("");
  });

  // Direct needs its own broker token, but the existing app session can satisfy
  // the authorization silently. Selecting a path is the user's explicit action
  // that permits the OAuth round trip.
  it("silently authorizes Direct from the active app session after a path switch", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR,
      configAuthenticated: true,
      configDestinationAuthenticated: false,
    });
    renderPage();

    const path = await screen.findByLabelText("Connection path");
    fireEvent.change(path, { target: { value: "direct" } });

    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1));
    expect(window.location.href).toBe(`${AUTH_URL}&prompt=none`);
    expect(sessionStorage.getItem(SILENT_DOOR_SWITCH_KEY)).toBe("1");
  });

  it("keeps manual sign-in for Direct when there is no reusable session", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR,
      configAuthenticated: false,
      initialOAuthAuthenticated: false,
      mainAppAuthenticated: false,
    });
    renderPage();

    const path = await screen.findByLabelText("Connection path");
    fireEvent.change(path, { target: { value: "direct" } });

    await waitFor(() => expect(callsTo("config")).toHaveLength(1));
    expect(callsTo("auth/start")).toHaveLength(0);
    expect(window.location.href).toBe("");
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("keeps the selected path and offers manual retry if silent auth cannot start", async () => {
    mockGateway({
      gatewayMode: "privilege",
      mcpUrl: PRIV_DOOR,
      configAuthenticated: true,
      configDestinationAuthenticated: false,
      authStartError: "authorization server unavailable",
    });
    renderPage();

    const path = await screen.findByLabelText("Connection path");
    fireEvent.change(path, { target: { value: "direct" } });

    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1));
    await waitFor(() => expect(path.value).toBe("direct"));
    expect(callsTo("config")).toHaveLength(1);
    expect(await screen.findByRole("dialog", { name: "Sign in to the gateway" })).toBeTruthy();
  });
});
