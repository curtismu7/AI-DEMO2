// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySwitch.test.jsx
// The page offers three paths to the same MCP server — Direct, Privilege and
// Façade — and switching between them re-authenticates, because each has a
// different OAuth front door. (Agent/Agentless was retired 2026-09-02: there is
// one AI Gateway now, and agent mode's frontend had nothing behind it.)
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const PRESETS = [
  { label: "2 · Privilege — direct to the AI Gateway", mode: "privilege", url: "https://mcpgw.example.com/opensearch22/mcp" },
  { label: "3 · Privilege — through the façade", mode: "facade", url: "https://ai-demo.example.com/mcp-facade/privilege-gateway/opensearch22/mcp" },
];

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

function mockFetch({ state, toolsList } = {}) {
  return vi.fn((url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve(jsonResponse(state));
    }
    if (u.endsWith("/api/privilege-mcp/config")) {
      return Promise.resolve(jsonResponse({ ok: true, config: JSON.parse(opts.body || "{}") }));
    }
    if (u.endsWith("/api/privilege-mcp/auth/start")) {
      return Promise.resolve(jsonResponse({ authUrl: "https://auth.pingone.example/authorize" }));
    }
    if (u.endsWith("/api/privilege-mcp/tools/list")) {
      return Promise.resolve(jsonResponse(toolsList || { tools: [] }));
    }
    return new Promise(() => {});
  });
}

beforeEach(() => {
  sessionStorage.clear();
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage(entry = "/privilege-mcp-client") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

const baseState = {
  config: { mcpUrl: PRESETS[0].url, clientId: "client-1", scopes: "openid profile email" },
  gatewayMode: "privilege",
  gatewayConfigs: {
    direct: { mcpUrl: "https://ai-demo.example.com/mcp-facade/opensearch/mcp", clientId: "client-1", scopes: "openid profile email" },
    privilege: { mcpUrl: PRESETS[0].url, clientId: "client-1", scopes: "openid profile email" },
    facade: { mcpUrl: PRESETS[1].url, clientId: "client-1", scopes: "openid profile email" },
  },
  oauth: { authenticated: false },
  mainAppAuthenticated: false,
  tools: [],
  presets: PRESETS,
};

describe("gateway switch on Settings save", () => {
  it("switches path from the main-page dropdown and re-authenticates against the new front door", async () => {
    global.fetch = mockFetch({ state: baseState });
    renderPage();

    const modeSelect = await screen.findByLabelText("Connection path");
    await waitFor(() => expect(modeSelect).toBeEnabled());
    fireEvent.change(modeSelect, { target: { value: "facade" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/privilege-mcp/config"),
        expect.objectContaining({ method: "POST", body: expect.stringContaining('\"gatewayMode\":\"facade\"') }),
      );
    });
    // Every path speaks OAuth now, and they do NOT share an authorization
    // server — reusing the old token would silently call the new path with a
    // credential its AS never issued.
    await waitFor(() => {
      expect(global.fetch.mock.calls.filter(([u]) => String(u).includes("/auth/start"))).toHaveLength(1);
    });
  });

  it("offers all three paths and no retired Agent option", async () => {
    global.fetch = mockFetch({ state: baseState });
    renderPage();

    const modeSelect = await screen.findByLabelText("Connection path");
    const values = Array.from(modeSelect.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["direct", "privilege", "facade"]);
  });

  it("a preset carries its own path, so choosing one switches mode with it", async () => {
    global.fetch = mockFetch({ state: baseState });
    renderPage();
    fireEvent.click(await screen.findByTitle("Settings"));

    const select = await screen.findByLabelText(/gateway preset/i);
    fireEvent.change(select, { target: { value: PRESETS[1].url } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/privilege-mcp/config"),
        expect.objectContaining({ method: "POST", body: expect.stringContaining('"gatewayMode":"facade"') }),
      );
    });
  });

  it("save with an unchanged gateway URL does not re-auth or show the overlay", async () => {
    global.fetch = mockFetch({ state: baseState });
    renderPage();
    fireEvent.click(await screen.findByTitle("Settings"));
    await screen.findByLabelText(/gateway preset/i);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/privilege-mcp/config"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(screen.queryByText("Switching gateway...")).not.toBeInTheDocument();
    const authStartCalls = global.fetch.mock.calls.filter(([u]) =>
      String(u).includes("/auth/start"),
    );
    expect(authStartCalls).toHaveLength(0);
  });

  it("?auth=success with the switch flag set keeps the overlay until tools refresh, then clears it", async () => {
    sessionStorage.setItem("cur_priv_switching", "1");
    global.fetch = mockFetch({
      state: { ...baseState, oauth: { authenticated: true, scope: "openid" } },
      toolsList: { tools: [{ name: "list_indices", description: "" }] },
    });
    renderPage("/privilege-mcp-client?auth=success");

    expect(screen.getByText("Switching gateway...")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Switching gateway...")).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem("cur_priv_switching")).toBeNull();
  });

  it("a stale switch flag without ?auth=success is cleared on load", async () => {
    sessionStorage.setItem("cur_priv_switching", "1");
    global.fetch = mockFetch({ state: baseState });
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText("Switching gateway...")).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem("cur_priv_switching")).toBeNull();
  });
});
