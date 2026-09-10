// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.silentAutoConnect.test.jsx
//
// The Privilege gateway is its own authorization server, so the banking app's
// PingOne token can never be reused directly — a separate token is required.
//
// REVERSED 2026-09-10, on the demo owner's call. This page used to obtain that
// token by redirecting to the IdP BY ITSELF on mount. Even when it worked it
// looked like a failure: the demo navigates away from itself before anyone
// touches it, and a silent attempt that cannot complete drops the user on a
// real PingOne login page nobody asked for.
//
// The rule now: NOTHING navigates the browser without a click. The rail's
// "Gateway identity" row shows a Sign in button, and the page waits.
//
// These tests are the ban. Any future "helpful" auto-connect must fail them.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const AUTH_URL = "https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/authorize?client_id=dcr-1";

function mockState({ mainAppAuthenticated, authenticated = false, gatewayMode = "agentless" }) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp", clientId: "a6219652", scopes: "openid profile email" },
            gatewayMode,
            gatewayConfigs: { agent: {}, agentless: {} },
            oauth: { authenticated },
            mainAppAuthenticated,
            tools: [],
            presets: [],
          }),
      });
    }
    if (u.endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ authUrl: AUTH_URL }),
      });
    }
    return new Promise(() => {});
  });
}

function authStartCalls() {
  return global.fetch.mock.calls.filter(
    ([url, opts]) => String(url).endsWith("/api/privilege-mcp/auth/start") && opts?.method === "POST",
  );
}

function ShowSearch() {
  return <span data-testid="search">{useLocation().search}</span>;
}

function renderAt(entry) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PrivilegeMcpClientPage />
      <ShowSearch />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
  // jsdom refuses a real navigation assignment; the page only ever sets href.
  delete window.location;
  window.location = { href: "", search: "" };
});

describe("Privilege silent auto-connect", () => {
  it("does NOT auto-start when the main app is signed in and Privilege is not", async () => {
    mockState({ mainAppAuthenticated: true });
    renderAt("/privilege-mcp-client");

    // The button is the affordance; the redirect is the user's to trigger.
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy());
    expect(authStartCalls()).toHaveLength(0);
    expect(window.location.href).toBe("");
  });

  it("does NOT auto-start after a round trip, so a failed silent attempt cannot force a login page", async () => {
    mockState({ mainAppAuthenticated: true });
    renderAt("/privilege-mcp-client?auth=silent_failed");

    await waitFor(() => expect(screen.getByTestId("sign-in-prompt")).toBeTruthy());
    expect(authStartCalls()).toHaveLength(0);
    expect(window.location.href).toBe("");
  });

  // 2026-09-08. The round-trip guard above is correct, but `auth` used to be
  // left in the URL forever. So the guard fired on every later visit too: a
  // reload, a bookmark or a shared /privilege-mcp-client?auth=success link went
  // straight to a sign-in prompt on a session that could have signed itself in
  // silently. That is the reported "it asks me to sign in even though I am
  // signed in to the app". The marker is consumed once, then stripped.
  it("strips the auth marker from the URL so the next visit is treated as fresh", async () => {
    mockState({ mainAppAuthenticated: true });
    renderAt("/privilege-mcp-client?auth=success&reason=x");

    // Still honoured on THIS mount — we really did just come back from a trip.
    await waitFor(() => expect(screen.getByTestId("sign-in-prompt")).toBeTruthy());
    expect(authStartCalls()).toHaveLength(0);

    await waitFor(() => expect(screen.getByTestId("search").textContent).not.toMatch(/auth=/));
    expect(screen.getByTestId("search").textContent).not.toMatch(/reason=/);
  });

  it("still does not auto-start on a reload of the stripped URL", async () => {
    mockState({ mainAppAuthenticated: true });
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy());
    expect(authStartCalls()).toHaveLength(0);
  });

  it("does not auto-start when the main app is not signed in", async () => {
    mockState({ mainAppAuthenticated: false });
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(authStartCalls()).toHaveLength(0);
  });

  // 2026-09-07. Direct used to be excluded from auto-connect on the reading that
  // it has "no auth at all". It does not: every direct door is a façade door
  // with requireBearer (mcpFacade.js DOORS), so excluding it meant Direct could
  // never obtain a token and all four of its doors answered "Not authenticated"
  // forever — with no way for the operator to get past it, because the sign-in
  // it needs is the one that was being skipped.
  //
  // Direct still needs a bearer — every direct door is a façade door with
  // requireBearer — but "needs one" is not a licence to go and get one
  // unprompted. What makes Direct "direct" is WHERE it signs in (our own
  // broker, never Privilege), not whether it does so without being asked.
  it("does not auto-start in Direct mode either", async () => {
    mockState({ mainAppAuthenticated: true, gatewayMode: "direct" });
    renderAt("/privilege-mcp-client");

    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy());
    expect(authStartCalls()).toHaveLength(0);
    expect(window.location.href).toBe("");
  });
});
