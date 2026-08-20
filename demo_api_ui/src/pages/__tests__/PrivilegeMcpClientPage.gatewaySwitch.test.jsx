// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySwitch.test.jsx
// Agent and agentless gateway settings follow different authentication paths.
// Both stay in the app and use the MCP client; only agentless starts OAuth.
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
  { label: "Agentless gateway (nginx)", mode: "agentless", url: "https://aidemo.mcpgw.local.ping-devops.com/mcp" },
  { label: "AI Gateway via Priv Agent", mode: "agent", url: "https://opensearch.default.applications.procyon.ai:8643/mcp" },
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
  gatewayMode: "agentless",
  gatewayConfigs: {
    agent: { mcpUrl: PRESETS[1].url },
    agentless: { mcpUrl: PRESETS[0].url, clientId: "client-1", scopes: "openid profile email" },
  },
  oauth: { authenticated: false },
  mainAppAuthenticated: false,
  tools: [],
  presets: PRESETS,
};

describe("gateway switch on Settings save", () => {
  it("saving Agent mode stores that config and runs MCP discovery without starting PingOne OAuth", async () => {
    global.fetch = mockFetch({ state: baseState });
    renderPage();
    fireEvent.click(await screen.findByTitle("Settings"));

    const select = await screen.findByLabelText(/gateway preset/i);
    fireEvent.change(select, { target: { value: PRESETS[1].url } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/privilege-mcp/config"),
        expect.objectContaining({ method: "POST", body: expect.stringContaining('"gatewayMode":"agent"') }),
      );
    });
    const authStartCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes("/auth/start"));
    expect(authStartCalls).toHaveLength(0);
    const toolsListCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes("/tools/list"));
    expect(toolsListCalls).toHaveLength(1);
    expect(sessionStorage.getItem("cur_priv_switching")).toBeNull();
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
