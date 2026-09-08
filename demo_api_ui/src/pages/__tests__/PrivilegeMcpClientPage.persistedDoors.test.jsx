// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.persistedDoors.test.jsx
//
// The console auth_token lasts about an hour, but the BFF persists every read
// (privilegeDoorStore.lmdb) and ships the summary on /state as `doorDiscovery`.
// The Policies tab used to ignore that and demand a fresh token to answer
// "which policies name this door" — a question already answered on disk. These
// tests pin the persisted view, and pin what it must NOT claim: names only, no
// Spec, no "grants", and no statement about whether a policy mentions the user.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const GATEWAY = "https://mcpgw.ai-demo.ping-devops.com/openapi2/mcp";

const DISCOVERY = {
  persisted: true,
  appCount: 2,
  policyCount: 3,
  discoveredAt: Date.parse("2026-09-08T12:00:00Z"),
  gatewayOrigin: "https://mcpgw.ai-demo.ping-devops.com",
  applications: [
    { name: "openapi2", status: "Ready", policies: ["banking-tools", "all-doors"] },
    { name: "opensearch22", status: "", policies: [] },
  ],
};

function mockApi(doorDiscovery) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    const ok = (body) => Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    });
    if (u.endsWith("/api/privilege-mcp/state")) {
      return ok({
        config: { mcpUrl: GATEWAY, clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode: "privilege",
        gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
        oauth: { authenticated: true },
        mainAppAuthenticated: true,
        user: { email: "cmuir+demo@pingone.com" },
        // Must stay empty — a non-empty list steals the tab (see the policies spec).
        tools: [],
        presets: [],
        doorDiscovery,
      });
    }
    return new Promise(() => {});
  });
}

beforeEach(() => {
  global.EventSource = class { addEventListener() {} close() {} };
  // viewMode is persisted in localStorage, so a spec that left the page in
  // Inspect makes the Policies tab appear here without asking for it. Clearing
  // it pins the real default (Demo) and keeps this file order-independent.
  try { localStorage.removeItem("cur_priv_view"); } catch { /* storage disabled */ }
});

async function openPoliciesTab() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
  // Policies is an Inspect surface; the page opens in Demo (VIEW_TABS).
  fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
  // Selected by class: "Policies" is also a section heading once the panel opens.
  let tab;
  await waitFor(() => {
    tab = [...document.querySelectorAll(".cur-tab")].find((b) => b.textContent.trim() === "Policies");
    expect(tab).toBeTruthy();
  });
  fireEvent.click(tab);
}

describe("Policies tab — persisted door discovery", () => {
  it("lists the last console read with each door's policy mentions, with no token pasted", async () => {
    mockApi(DISCOVERY);
    await openPoliciesTab();

    expect(await screen.findByText("Last console read — 2 doors, 3 policies")).toBeTruthy();
    // Scoped to the list: the door name also appears in the connection banner
    // and the door picker, so an unscoped getByText goes ambiguous.
    const rows = document.querySelector(".cur-console-list").textContent;
    expect(rows).toContain("openapi2");
    expect(rows).toContain("mentioned by banking-tools, all-doors");
    // A door no policy names is the likeliest cause of a 403, so it must say so
    // rather than render an empty cell.
    expect(rows).toContain("no policy mentions it");
  });

  it("still offers the token form, because names alone cannot answer the rest", async () => {
    mockApi(DISCOVERY);
    await openPoliciesTab();

    expect(await screen.findByPlaceholderText("paste the auth_token cookie value")).toBeTruthy();
  });

  it("marks the door currently in use", async () => {
    mockApi(DISCOVERY);
    await openPoliciesTab();

    await screen.findByText("Last console read — 2 doors, 3 policies");
    const active = document.querySelector(".cur-console-row--active");
    expect(active.textContent).toContain("openapi2");
  });

  it("shows nothing persisted when nobody has ever connected the console", async () => {
    mockApi({ persisted: false, appCount: 0, policyCount: 0, discoveredAt: null, gatewayOrigin: null, applications: [] });
    await openPoliciesTab();

    // The token form is the only thing on offer — same as before this feature.
    expect(await screen.findByPlaceholderText("paste the auth_token cookie value")).toBeTruthy();
    expect(screen.queryByText(/Last console read/)).toBeNull();
  });
});
