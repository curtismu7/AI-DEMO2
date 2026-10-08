// A policy denial is the centrepiece of this demo. It appears only as a
// standing band and one grey chat line — there is no modal to dismiss — so
// these pin the parts that keep the page reading as "refused", not "broken".
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const MCP_URL = "https://mcpgw.example.com/opensearch22/mcp";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const baseState = {
  config: { mcpUrl: MCP_URL, clientId: "c1", scopes: "openid profile email" },
  gatewayMode: "privilege",
  gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
  oauth: { authenticated: true },
  user: { email: "demo-user@pingone.com" },
  mainAppAuthenticated: true,
  tools: [],
  presets: [],
};

// tools/list answers 403 the way the gateway does on a policy denial.
function mockFetch({ toolsStatus = 403, toolsBody = { error: "MCP request failed: 403 Forbidden" } } = {}) {
  return vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) return Promise.resolve(jsonResponse(baseState));
    if (u.endsWith("/api/privilege-mcp/tools/list")) return Promise.resolve(jsonResponse(toolsBody, toolsStatus));
    if (u.endsWith("/api/privilege-mcp/config")) return Promise.resolve(jsonResponse({ ok: true }));
    return new Promise(() => {});
  });
}

beforeEach(() => {
  sessionStorage.clear();
  global.EventSource = class { addEventListener() {} close() {} };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("blocked-by-policy visibility", () => {
  it("shows a standing band naming the door and the identity", async () => {
    global.fetch = mockFetch();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools|Retry Tools/i }));

    const band = await screen.findByRole("alert", { name: /blocked by policy/i });
    expect(band).toBeInTheDocument();
    // The two facts a presenter is asked about from the floor.
    expect(band).toHaveTextContent("opensearch22");
    expect(band).toHaveTextContent("demo-user@pingone.com");
  });

  it("does not open any denial modal on a 403 — the band is the whole notice", async () => {
    global.fetch = mockFetch();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools|Retry Tools/i }));
    await screen.findByRole("alert", { name: /blocked by policy/i });

    expect(screen.queryByRole("dialog", { name: "Access Denied" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Why\?$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try other doors/i })).toBeNull();
  });

  it("explains the empty tool list instead of saying nothing was discovered", async () => {
    global.fetch = mockFetch();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools|Retry Tools/i }));

    await waitFor(() => expect(screen.getByText(/No tools — blocked by policy/i)).toBeInTheDocument());
    expect(screen.queryByText("No tools discovered yet")).not.toBeInTheDocument();
  });

  it("clears once a tool list succeeds", async () => {
    global.fetch = mockFetch();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools|Retry Tools/i }));
    await screen.findByRole("alert", { name: /blocked by policy/i });

    // Access granted: the band must not outlive the grant that fixed it.
    global.fetch = mockFetch({ toolsStatus: 200, toolsBody: { tools: [{ name: "ListIndexTool", description: "d" }] } });
    // A denial adds a second retry control, so there are now two matches.
    fireEvent.click(screen.getAllByRole("button", { name: /Get MCP Tools|Retry Tools/i })[0]);

    await waitFor(() => {
      expect(screen.queryByRole("alert", { name: /blocked by policy/i })).not.toBeInTheDocument();
    });
  });
});
