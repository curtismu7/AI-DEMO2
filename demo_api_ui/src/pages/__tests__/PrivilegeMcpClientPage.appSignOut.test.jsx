// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.appSignOut.test.jsx
//
// Row 2 (Gateway identity) could always be signed out; row 1 (App session)
// could not. That gap bites in one specific way: the gateway session lives in
// BFF process MEMORY (services/privilegeGatewaySession.js), so any BFF restart
// empties it while row 1's badge — read from the app cookie — still says ✅.
// The page then looks signed in against a server holding nothing, and there was
// no control on the page to reset it.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

function mockState({ mainAppAuthenticated }) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://ai-demo.example.com/mcp-facade/opensearch/mcp", clientId: "a6219652", scopes: "openid profile email" },
            gatewayMode: "privilege",
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            oauth: { authenticated: false },
            mainAppAuthenticated,
            user: { email: "cmuir+demo-user@pingone.com" },
            tools: [],
            presets: [],
          }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, text: async () => "{}" });
  });
}

/** The app sign-out, by its own name. Both sign-outs now live in the one action
 *  cluster beside "Get MCP Tools", so they are told apart by label rather than by
 *  which rail row contains them — which is exactly why each names what it ends. */
function appSessionSignOut() {
  return screen.queryByRole("button", { name: /Sign out of app/i });
}

describe("PrivilegeMcpClientPage — App session sign out", () => {
  beforeEach(() => { navigateSpy.mockClear(); });

  test("signed in: the App session row offers a sign out that goes to /logout", async () => {
    mockState({ mainAppAuthenticated: true });
    render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);

    await waitFor(() => expect(appSessionSignOut()).toBeTruthy());
    const btn = appSessionSignOut();
    expect(btn).toHaveTextContent("Sign out of app");

    fireEvent.click(btn);
    // /logout is the app's ONE sign-out path (App.js), the same route
    // AdminSideNav uses — not a bespoke POST from this page.
    expect(navigateSpy).toHaveBeenCalledWith("/logout");
  });

  test("the two sign-outs name what they end, so neither is a coin toss", async () => {
    mockState({ mainAppAuthenticated: true });
    render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);

    await waitFor(() => expect(appSessionSignOut()).toBeTruthy());
    // Both sit in the same action cluster now, so the LABEL is the only thing
    // telling them apart. A bare "Sign out" on either would be ambiguous — and
    // would match two nodes here, which is what makes this assertion bite.
    expect(screen.queryByRole("button", { name: /^Sign out$/i })).toBeNull();
  });

  test("signed out: no App session sign out is offered", async () => {
    mockState({ mainAppAuthenticated: false });
    render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("App session")).toBeTruthy());
    // Nothing to sign out of — offering it would be a dead control.
    expect(appSessionSignOut()).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
