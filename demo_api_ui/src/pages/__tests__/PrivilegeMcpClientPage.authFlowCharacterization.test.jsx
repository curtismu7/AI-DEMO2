// Characterization of the Cursor page's auth-flow output that the other
// PrivilegeMcpClientPage.* tests do not pin: the noAuthRequired door, the
// Re-arm banner wording, the preflight row labels, and the silent-bail text.
// Written green against the unmodified page so the re-auth/re-arm/door-probe
// extraction can move these strings without changing a byte.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const DOOR_A = "https://local.ping-devops.com:4000/mcp-facade/opensearch/mcp";
const DOOR_B = "https://local.ping-devops.com:4000/mcp-facade/brave/mcp";
const PRIV_DOOR = "https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp";
const PRIV_DOOR_B = "https://mcpgw.ai-demo.ping-devops.com/brave/mcp";
const AUTH_URL = "https://gateway.example/authorize?client_id=dcr-1";
const T = { timeout: 5000 };

const json = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body) });

const PRESETS = [
  { label: "Direct — opensearch", mode: "direct", url: DOOR_A },
  { label: "Direct — Brave Search", mode: "direct", url: DOOR_B },
  { label: "Privilege — opensearch22", mode: "privilege", url: PRIV_DOOR },
  { label: "Privilege — brave", mode: "privilege", url: PRIV_DOOR_B },
];

/**
 * Door-switch harness: lands signed in on `mcpUrl`; POST /config reports the
 * destination as unauthenticated, so the switch ends at the Sign in affordance.
 * Anything not listed hangs (as in the sibling tests).
 */
function mockGateway({ gatewayMode = "direct", mcpUrl = DOOR_A, mainAppAuthenticated = true, authStart, probe, gatewaySession } = {}) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    const post = opts?.method === "POST";
    if (u.endsWith("/api/privilege-mcp/state")) {
      return json({
        config: { mcpUrl, clientId: "", scopes: "openid profile email" },
        gatewayMode,
        gatewayConfigs: {
          direct: { mcpUrl: DOOR_A, clientId: "", scopes: "openid profile email" },
          privilege: { mcpUrl: PRIV_DOOR, clientId: "", scopes: "openid profile email" },
          facade: { mcpUrl: DOOR_A, clientId: "", scopes: "openid profile email" },
        },
        oauth: { authenticated: true },
        mainAppAuthenticated,
        tools: [],
        presets: PRESETS,
        gatewaySession,
      });
    }
    if (u.endsWith("/api/privilege-mcp/config") && post) {
      const body = JSON.parse(opts.body || "{}");
      return json({
        ok: true,
        config: { mcpUrl: body.mcpUrl, clientId: "", scopes: "openid profile email" },
        gatewayMode: body.gatewayMode || gatewayMode,
        gatewayConfigs: { direct: { mcpUrl: DOOR_A }, privilege: { mcpUrl: PRIV_DOOR }, facade: { mcpUrl: DOOR_A } },
        oauth: { authenticated: false, destinationAuthenticated: false },
      });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && post) return json(authStart);
    if (u.endsWith("/api/privilege-mcp/tools/list") && post) {
      return json({ tools: [], policy: { total: 0, permitted: 0, filtered: 0, filteredTools: [] } });
    }
    if (u.endsWith("/api/privilege-mcp/doors/probe") && post) return json({ results: probe });
    return new Promise(() => {});
  });
}

const callsTo = (path) =>
  global.fetch.mock.calls.filter(([url, opts]) => String(url).endsWith(`/api/privilege-mcp/${path}`) && opts?.method === "POST");

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
  sessionStorage.clear();
  localStorage.clear();
});

describe("Cursor auth flow — gaps in the existing coverage", () => {
  it("(a) a noAuthRequired door says so, loads tools, and never navigates", async () => {
    mockGateway({ authStart: { noAuthRequired: true } });
    renderPage();

    fireEvent.change(await screen.findByLabelText("MCP backend (door)", {}, T), { target: { value: DOOR_B } });
    fireEvent.click(await screen.findByRole("button", { name: /^sign in$/i }, T));

    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1), T);
    expect(
      await screen.findByText("This door needs no sign-in — its upstream owns identity. Loading tools.", {}, T),
    ).toBeInTheDocument();
    await waitFor(() => expect(callsTo("tools/list")).toHaveLength(1), T);
    expect(window.location.href).toBe("");
  });

  it("(b) Re-arm banner reads 'expired' for reason expired", async () => {
    mockGateway({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "expired" } });
    renderPage();
    expect(await screen.findByText(/Gateway session expired\./, {}, T)).toBeInTheDocument();
  });

  it("(b) Re-arm banner reads 'not established' for a missing reason", async () => {
    mockGateway({ gatewayMode: "facade", gatewaySession: { ready: false } });
    renderPage();
    expect(await screen.findByText(/Gateway session not established\./, {}, T)).toBeInTheDocument();
  });

  describe("(c) preflight row labels", () => {
    async function probeRows(results) {
      mockGateway({ gatewayMode: "privilege", mcpUrl: PRIV_DOOR, probe: results });
      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Inspect" }, T));
      fireEvent.click(await screen.findByRole("button", { name: /probe other doors/i }, T));
      await waitFor(() => expect(document.querySelectorAll(".cur-rail__probe li").length).toBe(results.length), T);
      return [...document.querySelectorAll(".cur-rail__probe li")].map((li) => li.lastElementChild.textContent);
    }

    it("ok shows '<n> tools'; failure shows '<status> <error>'; neither shows 'failed'", async () => {
      const labels = await probeRows([
        { url: DOOR_A, ok: true, tools: 7 },
        { url: DOOR_B, ok: false, status: 403, error: "Forbidden" },
        { url: PRIV_DOOR_B, ok: false },
      ]);
      expect(labels).toEqual(["7 tools", "403 Forbidden", "failed"]);
    });

    it("trims when only an error or only a status is present", async () => {
      const labels = await probeRows([
        { url: DOOR_A, ok: false, error: "relay down" },
        { url: DOOR_B, ok: false, status: 502 },
      ]);
      expect(labels).toEqual(["relay down", "502"]);
    });
  });

  // doorSwitchReauth's "keeps manual sign-in available when a silent Privilege
  // flow is unavailable" asserts only the dialog title, not this text.
  it("(d) silent-only bail shows the exact reason, in the modal and the rail, and does not navigate", async () => {
    mockGateway({ gatewayMode: "privilege", mcpUrl: PRIV_DOOR, mainAppAuthenticated: false, authStart: { authUrl: AUTH_URL } });
    renderPage();

    fireEvent.change(await screen.findByLabelText("MCP backend (door)", {}, T), { target: { value: PRIV_DOOR_B } });

    await waitFor(() => expect(callsTo("auth/start")).toHaveLength(1), T);
    const reason = "The gateway cannot silently authorize this door from the current session. Sign in to connect it.";
    expect(await screen.findByTestId("sign-in-prompt", {}, T)).toHaveTextContent(reason);
    expect((await screen.findByRole("dialog", { name: "Sign in to the gateway" }, T)).textContent).toContain(reason);
    expect(window.location.href).toBe("");
  });
});
