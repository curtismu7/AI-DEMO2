// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.connectAllDoors.test.jsx
//
// The gateway issues one token per app, so "Connect all doors" is one silent
// sign-in per door, each a full-page redirect. The plan rides sessionStorage; each
// ?auth=success return pops the next door and, when the queue is empty, goes back
// to the door the user started on.
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";
import { navigateWithOverlay } from "../../utils/navigateWithOverlay";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("../../utils/navigateWithOverlay", () => ({ navigateWithOverlay: vi.fn() }));

const ORIGIN = "https://gw.example.com/opensearch22/mcp";
const DOOR_A = "https://gw.example.com/brave/mcp";
const DOOR_B = "https://gw.example.com/aggregate/mcp";
const PLAN_KEY = "cur_priv_connect_all";

let configPosts;

function mockApi({ authUrl = "https://auth.example.com/authorize?prompt=none" } = {}) {
  configPosts = [];
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    const reply = (body) => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (u.endsWith("/api/privilege-mcp/state")) {
      return reply({
        config: { mcpUrl: ORIGIN, clientId: "c1", scopes: "openid" },
        gatewayMode: "privilege",
        gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
        oauth: { authenticated: true },
        mainAppAuthenticated: true,
        user: { email: "u@example.com" },
        tools: [],
        presets: [ORIGIN, DOOR_A, DOOR_B].map((url) => ({ url, mode: "privilege", clientId: "c1" })),
      });
    }
    if (u.endsWith("/api/privilege-mcp/config") && opts?.method === "POST") {
      configPosts.push(JSON.parse(opts.body));
      return reply({ oauth: { destinationAuthenticated: true } });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST") return reply({ authUrl });
    return reply({});
  });
}

const renderReturn = (auth = "success") => render(
  <MemoryRouter initialEntries={[`/privilege-mcp-client?auth=${auth}`]}>
    <PrivilegeMcpClientPage />
  </MemoryRouter>,
);

describe("PrivilegeMcpClientPage — Connect all doors", () => {
  beforeEach(() => {
    sessionStorage.clear();
    navigateWithOverlay.mockClear();
  });

  test("a return mid-chain selects the NEXT door and redirects, never a default config", async () => {
    mockApi();
    sessionStorage.setItem(PLAN_KEY, JSON.stringify({ origin: ORIGIN, queue: [DOOR_A, DOOR_B] }));
    renderReturn();

    await waitFor(() => expect(navigateWithOverlay).toHaveBeenCalledTimes(1));
    // The whole body, not just the URL: a mount-time selectDoor would post the
    // DEFAULT config (blank clientId, default scopes) over the server's.
    expect(configPosts).toEqual([{ mcpUrl: DOOR_A, clientId: "c1", scopes: "openid" }]);
    expect(JSON.parse(sessionStorage.getItem(PLAN_KEY)).queue).toEqual([DOOR_B]);
  });

  test("the last return goes back to the origin door and clears the plan", async () => {
    mockApi();
    sessionStorage.setItem(PLAN_KEY, JSON.stringify({ origin: ORIGIN, queue: [] }));
    renderReturn();

    await waitFor(() => expect(configPosts.map((c) => c.mcpUrl)).toEqual([ORIGIN]));
    expect(sessionStorage.getItem(PLAN_KEY)).toBeNull();
    expect(navigateWithOverlay).not.toHaveBeenCalled();
  });

  test("a door that cannot be authorised silently is skipped, the chain continues", async () => {
    mockApi();
    sessionStorage.setItem(PLAN_KEY, JSON.stringify({ origin: ORIGIN, queue: [DOOR_B] }));
    renderReturn("silent_failed");

    await waitFor(() => expect(navigateWithOverlay).toHaveBeenCalledTimes(1));
    expect(configPosts.map((c) => c.mcpUrl)).toEqual([DOOR_B]);
  });

  test("any other failed return ends the chain", async () => {
    mockApi();
    sessionStorage.setItem(PLAN_KEY, JSON.stringify({ origin: ORIGIN, queue: [DOOR_A] }));
    renderReturn("error");

    await waitFor(() => expect(sessionStorage.getItem(PLAN_KEY)).toBeNull());
    expect(navigateWithOverlay).not.toHaveBeenCalled();
  });

  test("a door that cannot sign in silently stops the chain instead of showing a login page", async () => {
    mockApi({ authUrl: "https://auth.example.com/authorize" });
    sessionStorage.setItem(PLAN_KEY, JSON.stringify({ origin: ORIGIN, queue: [DOOR_A, DOOR_B] }));
    renderReturn();

    await waitFor(() => expect(sessionStorage.getItem(PLAN_KEY)).toBeNull());
    expect(navigateWithOverlay).not.toHaveBeenCalled();
  });
});
