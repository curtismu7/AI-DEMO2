// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.tabColors.test.jsx
//
// The tab bar's active tab was near-invisible (#1e1e1e active on a #181818 bar).
// Each tab now carries its own accent color: a per-tab class (cur-tab--<key>)
// sets --tab-accent, and the active tab renders that accent as its background,
// so you can tell at a glance which surface you are on.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const STATE = {
  config: { mcpUrl: "https://mcpgw.example.com/pingone-admin/mcp", clientId: "a6219652", scopes: "openid profile email" },
  gatewayMode: "privilege",
  gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
  oauth: { authenticated: true, scope: "openid profile email" },
  mainAppAuthenticated: true,
  user: { email: "curtis@example.com" },
  tools: [],
  presets: [],
};

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, "..", "PrivilegeMcpClientPage.css"), "utf8");

beforeEach(() => {
  localStorage.clear();
  global.EventSource = class { addEventListener() {} close() {} };
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(STATE) });
    }
    return new Promise(() => {});
  });
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client?tab=chat"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("PrivilegeMcpClientPage tab colors", () => {
  it("gives every demo tab a per-tab color class", async () => {
    renderPage();
    await screen.findByRole("tab", { name: "Agent Chat" });
    for (const label of ["Agent Chat", "A2A", "Tools", "User API Key & Secrets"]) {
      const tab = screen.getByRole("tab", { name: label });
      expect(tab.className).toMatch(/cur-tab--[a-z0-9-]+/);
    }
  });

  it("each tab key maps to a DIFFERENT accent color", () => {
    const keys = ["chat", "a2a", "tools", "user-api-keys"];
    const colors = keys.map((key) => {
      const rule = CSS.match(
        new RegExp(`\\.cur-ide \\.cur-tab--${key}(?![\\w-])[^{]*{[^}]*--tab-accent:\\s*([^;]+);`),
      );
      expect(rule, `.cur-tab--${key} must set --tab-accent`).toBeTruthy();
      return rule[1].trim();
    });
    expect(new Set(colors).size).toBe(keys.length);
  });

  it("the ACTIVE tab shows its accent as its background (not near-page-black)", () => {
    const rule = CSS.match(/\.cur-ide \.cur-tab--active\s*{[^}]*}/);
    expect(rule).toBeTruthy();
    // The old background #1e1e1e is the bug: indistinguishable from the #181818 bar.
    expect(rule[0]).not.toContain("#1e1e1e");
    expect(rule[0]).toMatch(/var\(--tab-accent/);
  });
});
