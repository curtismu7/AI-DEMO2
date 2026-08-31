// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.denialDoor.test.jsx
//
// The denial modal's headline fact is WHICH DOOR was refused — the gateway
// itself never says, so if the page cannot name it the modal is worthless.
//
// It used to be captured inside refreshTools' catch, from `config.mcpUrl`. That
// reads the `config` of the render that DEFINED refreshTools, and on the
// auth=success remount discovery can run before setConfig has landed — so every
// live denial printed Door "(unknown)". Reordering the effects did not fix it,
// because a stale closure is not a sequencing problem. The door is now derived
// at render time.
//
// No artificial ordering is needed to reproduce it: refreshTools is created
// once (effect deps []), so its closure keeps the INITIAL empty config even
// after setConfig lands. A plain 403 is enough.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const GATEWAY = "https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  global.EventSource = class { addEventListener() {} close() {} };
});

it('names the door in the denial modal even when /state lands after the 403', async () => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return jsonResponse({
        config: { mcpUrl: GATEWAY, clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode: "agentless",
        gatewayConfigs: { agent: {}, agentless: {} },
        oauth: { authenticated: true },
        mainAppAuthenticated: true,
        user: { email: "cmuir+demo@pingone.com" },
        tools: [],
        presets: [],
      });
    }
    if (u.endsWith("/api/privilege-mcp/tools/list")) {
      return jsonResponse({ error: "MCP request failed: 403 Forbidden" }, { status: 403 });
    }
    return new Promise(() => {});
  });

  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client?auth=success"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByText("Access Denied")).toBeTruthy());
  // The door must be named, not "(unknown)".
  await waitFor(() => expect(screen.getByText("cmuir")).toBeTruthy());
  expect(screen.queryByText("(unknown)")).toBeNull();
});
