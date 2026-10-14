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
  { label: "2 · Privilege — direct to the Agent Privilege", mode: "privilege", url: CMUIR },
  { label: "Privilege — external", mode: "privilege", url: EXTERNAL },
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

function mockApi({
  gatewayMode = "privilege",
  mcpUrl = CMUIR,
  presets = PRESETS,
  gatewayConfigs = { direct: {}, privilege: {}, facade: {} },
} = {}) {
  const posted = [];
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return jsonResponse({
        config: { mcpUrl, clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode,
        gatewayConfigs,
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

  it("shows one known Direct door as a live readout", async () => {
    const directOpenSearch = "https://ai-demo.example.com/mcp-facade/opensearch/mcp";
    mockApi({
      gatewayMode: "direct",
      mcpUrl: directOpenSearch,
      presets: [{ label: "Direct — OpenSearch", mode: "direct", url: directOpenSearch }],
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Connection path")).toBeTruthy());
    await waitFor(() => expect(picker()).toBeTruthy());
    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch"]);
  });

  it("Direct shows only banking, opensearch, brave, and pingone-admin", async () => {
    const origin = "https://ai-demo.example.com";
    const direct = ["banking", "opensearch", "brave", "pingone-admin"]
      .map((name) => `${origin}/mcp-facade/${name}/mcp`);
    const sameOriginOtherPaths = [
      `${origin}/mcp-facade/privilege-gateway/opensearch-hitl/mcp`,
      `${origin}/mcp-facade/privilege-gateway/aggregate/mcp`,
      `${origin}/custom-door/mcp`,
    ];
    mockApi({
      gatewayMode: "direct",
      mcpUrl: direct[1],
      presets: [
        ...direct.map((url) => ({ label: `Direct — ${url}`, mode: "direct", url })),
        { label: "Direct — PingOne Hosted MCP", mode: "direct", url: "https://mcp.pingone.com/admin/env-123/mcp" },
        ...sameOriginOtherPaths.map((url) => ({ label: `Other path — ${url}`, mode: "facade", url })),
      ],
    });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    expect([...picker().options].map((option) => option.textContent)).toEqual([
      "banking", "opensearch", "brave", "pingone-admin",
    ]);
    expect([...picker().options].map((option) => option.value)).toEqual(direct);
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

  it("carries a preset OAuth client ID when switching to a hosted Direct door", async () => {
    const hosted = "https://mcp.pingone.com/admin/env-123/mcp";
    const posted = mockApi({
      gatewayMode: "direct",
      mcpUrl: AGENT,
      presets: [
        { label: "1 · Direct — no Privilege in the path", mode: "direct", url: AGENT },
        {
          label: "Direct — PingOne Hosted MCP",
          mode: "direct",
          url: hosted,
          clientId: "eec33861-dc73-4ca2-93c7-9ceb45174825",
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Gateway Preset"), { target: { value: hosted } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0]).toMatchObject({
      mcpUrl: hosted,
      clientId: "eec33861-dc73-4ca2-93c7-9ceb45174825",
    });
  });

  it("Facade mode lists its own doors without leaking Direct-only doors", async () => {
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH_DIRECT = `${FACADE_ORIGIN}/mcp-facade/opensearch/mcp`;
    const BRAVE_DIRECT = `${FACADE_ORIGIN}/mcp-facade/brave/mcp`;
    const OPENSEARCH_HITL_PRIVILEGE = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/opensearch-hitl/mcp`;
    const posted = mockApi({
      gatewayMode: "facade",
      mcpUrl: OPENSEARCH_HITL_PRIVILEGE,
      presets: [
        { label: "1 · Direct — no Privilege in the path", mode: "direct", url: OPENSEARCH_DIRECT },
        { label: "Direct — Brave Search", mode: "direct", url: BRAVE_DIRECT },
        { label: "3 · Privilege — through the façade", mode: "facade", url: OPENSEARCH_HITL_PRIVILEGE },
      ],
    });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch-hitl"]);

    expect(picker().value).toBe(OPENSEARCH_HITL_PRIVILEGE);
    expect(posted).toHaveLength(0);
  });

  it("updates the door list when the selected Path changes to Direct", async () => {
    const origin = "https://ai-demo.example.com";
    const direct = ["banking", "opensearch", "brave", "pingone-admin"]
      .map((name) => `${origin}/mcp-facade/${name}/mcp`);
    const facadeOpenSearchHitl = `${origin}/mcp-facade/privilege-gateway/opensearch-hitl/mcp`;
    const facadeOpenSearch = `${origin}/mcp-facade/privilege-gateway/opensearch/mcp`;
    const presets = [
      ...direct.map((url) => ({ label: `Direct — ${url}`, mode: "direct", url })),
      { label: "Façade — opensearch-hitl", mode: "facade", url: facadeOpenSearchHitl },
      { label: "Façade — opensearch", mode: "facade", url: facadeOpenSearch },
    ];
    mockApi({
      gatewayMode: "facade",
      mcpUrl: facadeOpenSearchHitl,
      presets,
      gatewayConfigs: {
        direct: { mcpUrl: direct[1] },
        privilege: {},
        facade: { mcpUrl: facadeOpenSearchHitl },
      },
    });
    renderPage();

    const pathPicker = await screen.findByLabelText("Connection path");
    expect([...picker().options].map((option) => option.textContent)).toEqual(["opensearch-hitl", "opensearch"]);

    fireEvent.change(pathPicker, { target: { value: "direct" } });

    await waitFor(() => expect(picker().value).toBe(direct[1]));
    expect([...picker().options].map((option) => option.textContent)).toEqual([
      "banking", "opensearch", "brave", "pingone-admin",
    ]);
  });

  it("Privilege mode (raw Agent Privilege, different origin) does NOT gain Direct's plain doors", async () => {
    const RAW_GATEWAY = "https://mcpgw.example.com";
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH_HITL = `${RAW_GATEWAY}/opensearch-hitl/mcp`;
    const OPENSEARCH_DIRECT = `${FACADE_ORIGIN}/mcp-facade/opensearch/mcp`;
    mockApi({
      gatewayMode: "privilege",
      mcpUrl: OPENSEARCH_HITL,
      presets: [
        { label: "2 · Privilege — direct to the Agent Privilege", mode: "privilege", url: OPENSEARCH_HITL },
        { label: "1 · Direct — no Privilege in the path", mode: "direct", url: OPENSEARCH_DIRECT },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Connection path")).toBeTruthy());

    // Only one Privilege door on this origin and no direct-mode leak — a
    // single-target readout, not a picker offering an unreachable door.
    await waitFor(() => expect(picker()).toBeTruthy());
    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch-hitl"]);
  });

  it("names each privilege-gateway/<app> sibling by its app, not the door", async () => {
    // Regression guard: doorName() used to return "privilege-gateway" for
    // every app behind this multiApp door, making opensearch-hitl/opensearch/
    // brave indistinguishable in the picker.
    const FACADE_ORIGIN = "https://ai-demo.example.com";
    const OPENSEARCH_HITL = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/opensearch-hitl/mcp`;
    const OPENSEARCH = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/opensearch/mcp`;
    const BRAVE = `${FACADE_ORIGIN}/mcp-facade/privilege-gateway/brave/mcp`;
    const posted = mockApi({
      gatewayMode: "facade",
      mcpUrl: OPENSEARCH_HITL,
      presets: [
        { label: "3 · Privilege — through the façade", mode: "facade", url: OPENSEARCH_HITL },
        { label: "Façade — opensearch", mode: "facade", url: OPENSEARCH },
        { label: "Façade — brave", mode: "facade", url: BRAVE },
      ],
    });
    renderPage();
    await waitFor(() => expect(picker()).toBeTruthy());

    const options = [...picker().options].map((o) => o.textContent);
    expect(options).toEqual(["opensearch-hitl", "opensearch", "brave"]);

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
