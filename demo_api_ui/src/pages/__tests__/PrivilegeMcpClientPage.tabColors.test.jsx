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
    for (const label of ["Agent Chat", "Tools", "User API Key & Secrets"]) {
      const tab = screen.getByRole("tab", { name: label });
      expect(tab.className).toMatch(/cur-tab--[a-z0-9-]+/);
    }
  });

  it("each tab key maps to a DIFFERENT accent color", () => {
    const keys = ["chat", "tools", "user-api-keys"];
    const colors = keys.map((key) => {
      const rule = CSS.match(
        new RegExp(`\\.cur-ide \\.cur-tab--${key}(?![\\w-])[^{]*{[^}]*--tab-accent:\\s*([^;]+);`),
      );
      expect(rule, `.cur-tab--${key} must set --tab-accent`).toBeTruthy();
      return rule[1].trim();
    });
    expect(new Set(colors).size).toBe(keys.length);
  });

  it("all six tabs (demo + inspect) have a unique accent", () => {
    const keys = ["chat", "tools", "user-api-keys", "mcp", "rpc", "policies"];
    const colors = keys.map((key) => {
      const rule = CSS.match(
        new RegExp(`\\.cur-ide \\.cur-tab--${key}(?![\\w-])[^{]*{[^}]*--tab-accent:\\s*([^;]+);`),
      );
      expect(rule, `.cur-tab--${key} must set --tab-accent`).toBeTruthy();
      return rule[1].trim();
    });
    expect(new Set(colors).size).toBe(keys.length);
  });

  it("the panel under the tab carries the active tab's key and shares its accent", async () => {
    renderPage();
    await screen.findByRole("tab", { name: "Agent Chat" });
    expect(document.querySelector(".cur-editor-area").className).toContain("cur-panel--chat");
    for (const key of ["chat", "tools", "user-api-keys", "mcp", "rpc", "policies"]) {
      expect(CSS).toMatch(new RegExp(`\\.cur-panel--${key}\\s*{\\s*--tab-accent`));
    }
    expect(CSS).toMatch(/\.cur-editor-area\[class\*="cur-panel--"\]\s*{[^}]*var\(--tab-accent\)/);
  });

  it("the ACTIVE tab and the section under it use the same soft mix of the accent", () => {
    const mix = (re) => {
      const m = CSS.match(re);
      expect(m).toBeTruthy();
      return m[1];
    };
    // Tab and section must be the SAME color, dark and light, hover included.
    const tab = mix(/\.cur-ide \.cur-tab--active\s*{[^}]*background:\s*color-mix\(in srgb, var\(--tab-accent[^)]*\) (\d+)%, (#[0-9a-f]+)\)/);
    const panel = mix(/\.cur-ide \.cur-editor-area\[class\*="cur-panel--"\]\s*{[^}]*background:\s*color-mix\(in srgb, var\(--tab-accent\) (\d+)%, (#[0-9a-f]+)\)/);
    expect(tab).toBe(panel);
    expect(CSS).toMatch(/\.cur-ide \.cur-tab--active:hover\s*{\s*background:\s*color-mix/);
  });
});
