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

/** The App-session row's own button, not the Gateway-identity row's. */
function appSessionSignOut() {
  const row = screen.getByText("App session").closest("li");
  return row.querySelector("button");
}

describe("PrivilegeMcpClientPage — App session sign out", () => {
  beforeEach(() => { navigateSpy.mockClear(); });

  test("signed in: the App session row offers a sign out that goes to /logout", async () => {
    mockState({ mainAppAuthenticated: true });
    render(<MemoryRouter><PrivilegeMcpClientPage /></MemoryRouter>);

    await waitFor(() => expect(appSessionSignOut()).toBeTruthy());
    const btn = appSessionSignOut();
    expect(btn).toHaveTextContent("Sign out");

    fireEvent.click(btn);
    // /logout is the app's ONE sign-out path (App.js), the same route
    // AdminSideNav uses — not a bespoke POST from this page.
    expect(navigateSpy).toHaveBeenCalledWith("/logout");
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
