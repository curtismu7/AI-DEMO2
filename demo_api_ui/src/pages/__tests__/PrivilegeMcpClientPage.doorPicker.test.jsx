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
// This demo's OWN facade door. Agentless mode, but a DIFFERENT host — so not a
// Privilege application on this gateway, and doorName() renders it as the
// meaningless "mcp-facade".
const AUDIT = "http://localhost:3002/mcp-facade/audit/mcp";

const PRESETS = [
  { label: "2 · Privilege — direct to the AI Gateway", mode: "privilege", url: CMUIR },
  { label: "3 · Privilege — through the façade", mode: "facade", url: EXTERNAL },
  { label: "1 · Direct — no Privilege in the path", mode: "direct", url: AGENT },
  { label: "Agent Gateway — PingOne audit (scope-narrowed)", mode: "privilege", url: AUDIT },
];

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function mockApi({ gatewayMode = "privilege", mcpUrl = CMUIR, presets = PRESETS } = {}) {
  const posted = [];
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return jsonResponse({
        config: { mcpUrl, clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode,
        gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
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

const picker = () => screen.queryByLabelText("MCP backend (door)");

beforeEach(() => {
  global.EventSource = class { addEventListener() {} close() {} };
});

describe("titlebar door picker", () => {
  it("lists every Privilege door, including the one in use", async () => {
    mockApi();
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    // Named by door, not by preset label or raw URL.
    expect(options).toEqual(["cmuir", "external"]);
    // The current door must be present or the select cannot show a selection.
    expect(picker().value).toBe(CMUIR);
    // The Direct preset is not a door — no Privilege app sits in that path.
    expect(options).not.toContain("opensearch");
    // Nor is the audit facade a door on THIS gateway — different host. Listing
    // it would misdescribe what switching does.
    expect(options).not.toContain("mcp-facade");
  });

  it("switching repoints the gateway URL via /config", async () => {
    const posted = mockApi();
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    fireEvent.change(picker(), { target: { value: EXTERNAL } });

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].mcpUrl).toBe(EXTERNAL);
  });

  it("still appears in Direct mode with only one direct door known — a live readout, not just a switcher", async () => {
    mockApi({ gatewayMode: "direct", mcpUrl: AGENT });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Connection path")).toBeTruthy());
    await waitFor(() => expect(picker()).toBeTruthy());
    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toHaveLength(1);
  });

  it("appears in Direct mode once a sibling direct door exists, and switching still works", async () => {
    // Real Direct-mode URLs are façade URLs (/mcp-facade/<door>/mcp), unlike
    // AGENT above (a legacy procyon-subdomain fixture with no door segment in
    // its path at all) — doorName() reads the path, so this test needs the
    // shape it actually names doors from.
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH = `${FACADE_ORIGIN}/mcp-facade/opensearch/mcp`;
    const BRAVE = `${FACADE_ORIGIN}/mcp-facade/brave/mcp`;
    const posted = mockApi({
      gatewayMode: "direct",
      mcpUrl: OPENSEARCH,
      presets: [
        { label: "1 · Direct — no Privilege in the path", mode: "direct", url: OPENSEARCH },
        { label: "Direct — Brave Search", mode: "direct", url: BRAVE },
      ],
    });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch", "brave"]);

    fireEvent.change(picker(), { target: { value: BRAVE } });
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].mcpUrl).toBe(BRAVE);
  });

  it("Facade mode gets the same plain doors as Direct, alongside its own Privilege-gated apps", async () => {
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH_DIRECT = `${FACADE_ORIGIN}/mcp-facade/opensearch/mcp`;
    const BRAVE_DIRECT = `${FACADE_ORIGIN}/mcp-facade/brave/mcp`;
    const OPENSEARCH22_PRIVILEGE = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/opensearch22/mcp`;
    const posted = mockApi({
      gatewayMode: "facade",
      mcpUrl: OPENSEARCH22_PRIVILEGE,
      presets: [
        { label: "1 · Direct — no Privilege in the path", mode: "direct", url: OPENSEARCH_DIRECT },
        { label: "Direct — Brave Search", mode: "direct", url: BRAVE_DIRECT },
        { label: "3 · Privilege — through the façade", mode: "facade", url: OPENSEARCH22_PRIVILEGE },
      ],
    });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch", "brave", "opensearch22"]);

    fireEvent.change(picker(), { target: { value: OPENSEARCH_DIRECT } });
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // Reuses the exact same façade-hosted URL Direct mode uses for this door —
    // it is already a /mcp-facade/... route, so nothing extra is needed to
    // keep it "wired to the façade" while Facade mode is active.
    expect(posted[0].mcpUrl).toBe(OPENSEARCH_DIRECT);
  });

  it("Privilege mode (raw AI Gateway, different origin) does NOT gain Direct's plain doors", async () => {
    const RAW_GATEWAY = "https://mcpgw.example.com";
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH22 = `${RAW_GATEWAY}/opensearch22/mcp`;
    const OPENSEARCH_DIRECT = `${FACADE_ORIGIN}/mcp-facade/opensearch/mcp`;
    mockApi({
      gatewayMode: "privilege",
      mcpUrl: OPENSEARCH22,
      presets: [
        { label: "2 · Privilege — direct to the AI Gateway", mode: "privilege", url: OPENSEARCH22 },
        { label: "1 · Direct — no Privilege in the path", mode: "direct", url: OPENSEARCH_DIRECT },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Connection path")).toBeTruthy());

    // Only one Privilege door on this origin and no direct-mode leak — a
    // single-target readout, not a picker offering an unreachable door.
    await waitFor(() => expect(picker()).toBeTruthy());
    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch22"]);
  });

  it("names each privilege-gateway/<app> sibling by its app, not the door", async () => {
    // Regression guard: doorName() used to return "privilege-gateway" for
    // every app behind this multiApp door, making opensearch22/opensearch/
    // brave indistinguishable in the picker.
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH22 = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/opensearch22/mcp`;
    const OPENSEARCH = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/opensearch/mcp`;
    const BRAVE = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/brave/mcp`;
    const posted = mockApi({
      gatewayMode: "facade",
      mcpUrl: OPENSEARCH22,
      presets: [
        { label: "3 · Privilege — through the façade", mode: "facade", url: OPENSEARCH22 },
        { label: "Façade — opensearch", mode: "facade", url: OPENSEARCH },
        { label: "Façade — brave", mode: "facade", url: BRAVE },
      ],
    });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch22", "opensearch", "brave"]);

    fireEvent.change(picker(), { target: { value: BRAVE } });
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].mcpUrl).toBe(BRAVE);
  });

  it("still appears with only one door on the current gateway — a single-target readout", async () => {
    // one Privilege door + the Direct target + the audit facade: only ONE is a
    // door on the current gateway, but the picker still shows it.
    mockApi({ presets: [PRESETS[0], PRESETS[2], PRESETS[3]] });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());
    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toHaveLength(1);
  });
});
