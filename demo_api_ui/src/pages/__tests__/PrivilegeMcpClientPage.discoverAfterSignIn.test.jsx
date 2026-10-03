// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.discoverAfterSignIn.test.jsx
//
// Companion to noAutoDiscover: signing in alone must not probe a door, but
// CLICKING Sign in is explicit intent for that door. The presenter used to sign
// in and then press "Get MCP Tools" a second time. The click now leaves a
// session flag that the ?auth=success return consumes, so tools load once.
//
// Both halves matter: the flag must be set by the click, and a return with no
// flag (reload, bookmark, stale ?auth=success) must still discover nothing —
// noAutoDiscover keeps pinning that second half.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";
import { hideNavOverlay } from "../../utils/navigateWithOverlay";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const FLAG = "cur_priv_silent_door_switch";
const realLocation = window.location;
let toolsListCalls = 0;

function mockBackend({ authenticated }) {
  toolsListCalls = 0;
  const json = (body) => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return json({
        config: { mcpUrl: "https://mcpgw.example.com/opensearch22/mcp", clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode: "privilege",
        gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
        oauth: { authenticated, scope: "openid profile email" },
        mainAppAuthenticated: authenticated,
        user: { email: "demo@example.com" },
        tools: [],
        presets: [],
      });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST") {
      return json({ authUrl: "https://mcpgw.example.com/opensearch22/authorize?client_id=x" });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      toolsListCalls += 1;
      return json({ tools: [{ name: "get_weather" }] });
    }
    return json({});
  });
}

beforeEach(() => {
  sessionStorage.clear();
  delete window.location;
  window.location = { href: "", assign: vi.fn(), replace: vi.fn(), reload: vi.fn(), origin: "http://localhost", pathname: "/privilege-mcp-client", search: "" };
});

afterEach(() => {
  hideNavOverlay();
  window.location = realLocation;
});

describe("PrivilegeMcpClientPage — discover once after the Sign in click", () => {
  test("clicking Sign in leaves the discover flag and leaves through the overlay", async () => {
    mockBackend({ authenticated: false });
    render(
      <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
        <PrivilegeMcpClientPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(window.location.href).toContain("/opensearch22/authorize"));
    expect(sessionStorage.getItem(FLAG)).toBe("1");
    expect(screen.getByText("Signing in...")).toBeTruthy();
  });

  test("returning with that flag discovers tools exactly once and clears the flag", async () => {
    mockBackend({ authenticated: true });
    sessionStorage.setItem(FLAG, "1");
    render(
      <MemoryRouter initialEntries={["/privilege-mcp-client?auth=success"]}>
        <PrivilegeMcpClientPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(toolsListCalls).toBe(1));
    await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBeNull());
  });
});
