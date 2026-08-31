// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.doorPicker.test.jsx
//
// The titlebar Door picker. It selects the MCP APPLICATION (the /<door>/mcp
// route), never a policy — Privilege resolves the policy server-side from
// (user, door, tool), so a policy control could only mislead. An earlier
// attempt at this (PR #2652, closed) fetched policies from the console API in
// the browser and its selection did nothing at all.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const BASE = "https://cmuir-agentless-mcpgw.ping-devops.com";
const CMUIR = `${BASE}/cmuir/mcp`;
const EXTERNAL = `${BASE}/external/mcp`;
const AGENT = "https://opensearch.default.applications.procyon.ai:8643/mcp";

const PRESETS = [
  { label: "Agentless gateway (nginx)", mode: "agentless", url: CMUIR },
  { label: "Agentless gateway — banking (external)", mode: "agentless", url: EXTERNAL },
  { label: "AI Gateway via Priv Agent", mode: "agent", url: AGENT },
];

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function mockApi({ gatewayMode = "agentless", mcpUrl = CMUIR, presets = PRESETS } = {}) {
  const posted = [];
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return jsonResponse({
        config: { mcpUrl, clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode,
        gatewayConfigs: { agent: {}, agentless: {} },
        oauth: { authenticated: true },
        mainAppAuthenticated: true,
        user: { email: "cmuir+demo@pingone.com" },
        tools: [],
        presets,
      });
    }
    if (u.endsWith("/api/privilege-mcp/config") && opts?.method === "POST") {
      posted.push(JSON.parse(opts.body));
      return jsonResponse({ ok: true });
    }
    return new Promise(() => {});
  });
  return posted;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

const picker = () => screen.queryByLabelText("Privilege MCP application (door)");

beforeEach(() => {
  global.EventSource = class { addEventListener() {} close() {} };
});

describe("titlebar door picker", () => {
  it("lists every agentless door, including the one in use", async () => {
    mockApi();
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    // Named by door, not by preset label or raw URL.
    expect(options).toEqual(["cmuir", "external"]);
    // The current door must be present or the select cannot show a selection.
    expect(picker().value).toBe(CMUIR);
    // The agent preset is not a door — it is a single fixed procyon frontend.
    expect(options).not.toContain("opensearch");
  });

  it("switching repoints the gateway URL via /config", async () => {
    const posted = mockApi();
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    fireEvent.change(picker(), { target: { value: EXTERNAL } });

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].mcpUrl).toBe(EXTERNAL);
  });

  it("is absent in agent mode — there is nothing to pick between", async () => {
    mockApi({ gatewayMode: "agent", mcpUrl: AGENT });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Gateway connection mode")).toBeTruthy());
    expect(picker()).toBeNull();
  });

  it("is absent when only one door is configured — a one-option select is furniture", async () => {
    mockApi({ presets: [PRESETS[0], PRESETS[2]] });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Gateway connection mode")).toBeTruthy());
    expect(picker()).toBeNull();
  });
});
