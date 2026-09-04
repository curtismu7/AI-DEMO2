// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx
// The CLI preflight proves doors are reachable. It cannot prove a real caller
// can invoke a tool, because the gateway 401s before routing. This panel does
// that half with the operator's own session, via the existing /doors/probe.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const PRESETS = [
  { label: "Privilege — opensearch", mode: "privilege", url: "https://gw.test/opensearch/mcp" },
  { label: "Privilege — brave", mode: "privilege", url: "https://gw.test/brave/mcp" },
];

function stateBody() {
  return JSON.stringify({
    config: { mcpUrl: "https://gw.test/opensearch22/mcp", clientId: "", scopes: "" },
    gatewayMode: "privilege",
    gatewayConfigs: {},
    oauth: { authenticated: true },
    mainAppAuthenticated: true,
    tools: [],
    presets: PRESETS,
    gatewaySession: { ready: true },
  });
}

// `probe` decides what POST /doors/probe answers, so each test states only the
// one thing it is about.
function mockFetch(probe) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody() });
    }
    if (u.endsWith("/api/privilege-mcp/doors/probe")) return Promise.resolve(probe());
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

async function clickRun() {
  fireEvent.click(await screen.findByRole("button", { name: /run preflight/i }));
}

describe("preflight panel", () => {
  it("probes every preset door and shows tool counts and failures", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          results: [
            { url: PRESETS[0].url, ok: true, tools: 7 },
            { url: PRESETS[1].url, ok: false, status: 403, error: "Forbidden" },
          ],
        }),
    }));
    renderPage();
    await clickRun();

    expect(await screen.findByText(/7 tools/i)).toBeInTheDocument();
    expect(await screen.findByText(/Forbidden/i)).toBeInTheDocument();
  });

  // /doors/probe answers 401 when the session has no access token. The naive
  // handler reads `data.results`, gets undefined, and renders an empty list —
  // a failed preflight that looks exactly like a clean one.
  it("surfaces a failed probe request instead of rendering an empty list", async () => {
    mockFetch(() => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Not authenticated." }),
    }));
    renderPage();
    await clickRun();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Not authenticated/i);
  });

  // The endpoint skips the currently-selected door and caps the fan-out, so an
  // empty result set is a real outcome. Silence would read as success.
  it("says nothing was probed rather than showing an empty list", async () => {
    mockFetch(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) }));
    renderPage();
    await clickRun();

    expect(await screen.findByText(/no doors were probed/i)).toBeInTheDocument();
  });
});
