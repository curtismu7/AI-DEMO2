// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
// Façade mode relays through a server-side gateway token that dies with the BFF
// process. When it is gone the door 503s and, before this banner, nothing on the
// page said so — the operator saw an unexplained failure in LM Studio instead.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

function stateBody({ gatewayMode, gatewaySession }) {
  return JSON.stringify({
    config: { mcpUrl: "https://example.test/mcp", clientId: "", scopes: "openid" },
    gatewayMode,
    gatewayConfigs: {},
    oauth: { authenticated: true },
    mainAppAuthenticated: true,
    tools: [],
    presets: [],
    gatewaySession,
  });
}

function mockState(opts) {
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody(opts) });
    }
    return new Promise(() => {});
  });
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("gateway session banner", () => {
  it("warns and offers re-arm in facade mode when there is no gateway session", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "no_session" } });
    renderPage();

    // Specific wording, not /gateway session/i — that also matches the button.
    expect(await screen.findByText(/gateway session not established/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-arm gateway session/i })).toBeInTheDocument();
  });

  it("stays hidden in facade mode when the session is ready", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: true } });
    renderPage();

    await screen.findByTitle("Settings");
    expect(screen.queryByRole("button", { name: /re-arm gateway session/i })).not.toBeInTheDocument();
  });

  it("stays hidden in privilege mode even with no gateway session — that mode carries the caller's own bearer", async () => {
    mockState({ gatewayMode: "privilege", gatewaySession: { ready: false, reason: "no_session" } });
    renderPage();

    await screen.findByTitle("Settings");
    expect(screen.queryByRole("button", { name: /re-arm gateway session/i })).not.toBeInTheDocument();
  });

  // The load-bearing behaviour: re-arm must go through PRIVILEGE mode.
  // privilegeMcpClient.js only remembers the gateway session when the token
  // exchange hit the real gateway's token endpoint. A Façade-mode sign-in mints
  // a broker token that is deliberately not remembered, so re-arming without
  // the mode switch would authenticate and arm nothing — a dead-end button.
  it("re-arm switches to privilege mode before authenticating", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "expired" } });
    const base = global.fetch;
    const posted = [];
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.endsWith("/api/privilege-mcp/config")) {
        posted.push(JSON.parse(init.body));
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ oauth: { authenticated: false } }),
        });
      }
      if (u.endsWith("/api/privilege-mcp/auth/start")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ authUrl: "https://as.test/authorize?x=1" }),
        });
      }
      return base(url, init);
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /re-arm gateway session/i }));

    await vi.waitFor(() => {
      expect(posted.some((b) => b.gatewayMode === "privilege")).toBe(true);
    });
  });

  // The BFF can report the mode as already authenticated from a restored token
  // slot while the gateway session singleton is gone — that is the normal state
  // after a BFF restart clears it. Without forceReauth the switch takes the
  // "already signed in" shortcut, arms nothing, and the banner never clears.
  it("re-arm still signs in when the BFF reports the mode already authenticated", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "no_session" } });
    const base = global.fetch;
    let startCalls = 0;
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.endsWith("/api/privilege-mcp/config")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ oauth: { authenticated: true } }),
        });
      }
      if (u.endsWith("/api/privilege-mcp/auth/start")) {
        startCalls += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ authUrl: "https://as.test/authorize?x=1" }),
        });
      }
      return base(url, init);
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /re-arm gateway session/i }));

    await vi.waitFor(() => expect(startCalls).toBe(1));
  });

  // A 200 with no authUrl used to set window.location.href = undefined: the
  // browser navigated to the literal string "undefined" with nothing logged.
  it("reports a failure inline when sign-in returns no authorization URL", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "expired" } });
    const base = global.fetch;
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.endsWith("/api/privilege-mcp/config")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ oauth: { authenticated: false } }),
        });
      }
      if (u.endsWith("/api/privilege-mcp/auth/start")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
      }
      return base(url, init);
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /re-arm gateway session/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /did not return an authorization URL/i,
    );
    expect(window.location.href).not.toContain("undefined");
  });

  // A rejected /config must not leave the operator staring at a silent banner.
  it("reports a failed re-arm inline", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "expired" } });
    const base = global.fetch;
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.endsWith("/api/privilege-mcp/config")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ error: "config store unavailable" }),
        });
      }
      return base(url, init);
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /re-arm gateway session/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Gateway switch failed/i);
  });
});
