// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.authChallenge.test.jsx
//
// A 401 must reach the operator as a sign-in offer, whatever its body says.
//
// The bug this pins: api() builds its Error from `data.error`, which for the
// BFF's own session guard (routes/mcpPingOneAdminAuth.js requireSignedInSession)
// is the single word "unauthenticated" -- containing neither "401" nor "bearer
// token required". The challenge was detected by substring alone, so this one
// was invisible: the raw JSON landed in the UI with no modal and no way forward.
// The status is now carried on the Error and tested first.
//
// Sibling to PrivilegeMcpClientPage.pingoneAdminLogin.test.jsx, which covers the
// OTHER branch: a challenge carrying a loginUrl goes to that delegated login
// instead of this modal.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

// Exactly what requireSignedInSession returns: a code, not prose, and no
// loginUrl to act on.
const SESSION_CHALLENGE = { error: "unauthenticated", message: "A valid session is required. Please sign in." };

function mockState({ toolsListBody = SESSION_CHALLENGE, toolsListStatus = 401 } = {}) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://ai-demo.example.com/mcp-facade/pingone-admin/mcp", clientId: "client-1", scopes: "openid profile email" },
            gatewayMode: "direct",
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            oauth: { authenticated: true },
            mainAppAuthenticated: true,
            tools: [],
            presets: [],
          }),
      });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list") && opts?.method === "POST") {
      return Promise.resolve({
        ok: toolsListStatus >= 200 && toolsListStatus < 300,
        status: toolsListStatus,
        text: async () => JSON.stringify(toolsListBody),
      });
    }
    return new Promise(() => {});
  });
}

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
});

describe("an auth challenge the body does not spell out", () => {
  it('offers sign-in for a 401 whose body is only { error: "unauthenticated" }', async () => {
    mockState();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools/i }));

    // Before the status was carried, this rendered "Refresh failed:
    // unauthenticated" into the chat and nothing else -- a dead end.
    expect(await screen.findByText("Sign in to continue")).toBeInTheDocument();
    // ...and it is THIS page's gateway sign-in, not a browser navigation:
    // no loginUrl came with the challenge, so there is nowhere else to send them.
    expect(window.location.href).toBe("");
  });

  it("still offers sign-in when the body says nothing useful at all", async () => {
    // A door that 401s with an empty body is the same situation: the status is
    // the only signal there is.
    mockState({ toolsListBody: {} });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools/i }));
    expect(await screen.findByText("Sign in to continue")).toBeInTheDocument();
  });

  it("does not offer sign-in for a non-401 failure", async () => {
    // The guard must stay specific: a 500 is a broken upstream, and prompting
    // for credentials there sends the operator to fix the wrong thing.
    mockState({ toolsListBody: { error: "upstream exploded" }, toolsListStatus: 500 });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Get MCP Tools/i }));

    await waitFor(() => expect(screen.getByText(/upstream exploded/)).toBeInTheDocument());
    expect(screen.queryByText("Sign in to continue")).toBeNull();
  });
});
