import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

// AdminSideNav pulls in several contexts/services; mock them to their minimal
// used shape so we can render the nav in isolation and exercise the new
// a11y + filter behavior.
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: false, setAgentUi: vi.fn() }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({ activeId: "banking" }),
}));
vi.mock("../../services/demoScenarioService", () => ({ persistAgentUi: vi.fn() }));
vi.mock("../../services/logout", () => ({ performLogout: vi.fn() }));
vi.mock("../../services/apiClient", () => ({
  default: {
    post: vi.fn(() =>
      Promise.resolve({
        data: {
          useCaseId: "weather-mcp-texas-permit",
          triggerText: "what's the weather in Austin, TX",
          type: "chip",
        },
      }),
    ),
  },
}));
vi.mock("../../utils/authUi", () => ({ requestSilentReauth: vi.fn() }));
vi.mock("../../utils/dashboardLayout", () => ({ setDashboardLayout: vi.fn() }));
vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
vi.mock("../ConfirmModal", () => ({ default: () => null }));
vi.mock("../ControlPlaneIntroModal", () => ({ default: () => null }));
vi.mock("../KillSwitchConfirmModal", () => ({ default: () => null }));

import AdminSideNav from "../AdminSideNav";
import { NAV_ITEM_CATALOG } from "../../config/navItemsCatalog";
import { NAV_STRUCTURE_CATALOG } from "../../config/navStructureCatalog";

// The sidebar now rests as an icon rail (labels hidden). These suites exercise
// the expanded tree — filtering by label, group auto-expand — so they opt into
// the expanded state explicitly rather than relying on a default.
beforeEach(() => {
  try { window.localStorage.setItem("adminSideNav.collapsed", "false"); } catch { /* jsdom always has it */ }
  try { window.sessionStorage.removeItem("adminSideNav.expandedSections.admin"); } catch { /* jsdom always has it */ }
});


const adminUser = { id: "4", username: "admin", role: "admin" };
const customerUser = { id: "1", username: "customer", role: "customer" };
const renderNav = (path = "/admin") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminSideNav user={adminUser} />
    </MemoryRouter>,
  );
const renderNavAsUser = (user, path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminSideNav user={user} />
    </MemoryRouter>,
  );

describe("AdminSideNav — best-of-breed pass", () => {
  it("labels the primary navigation landmark", () => {
    renderNav();
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
  });

  it("uses the compact PingOne platform rail hierarchy", () => {
    renderNav();
    expect(screen.getByText("Super Banking")).toBeInTheDocument();
    expect(screen.getByText("PingOne platform demo")).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("PingOne Platform")).toBeInTheDocument();
    expect(screen.getByText("Separate Areas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^AI Gateway/ }).closest(".admin-side-nav__group")).toHaveClass(
      "admin-side-nav__group--product-card",
    );
    expect(screen.getByRole("button", { name: /^DaVinci/ }).closest(".admin-side-nav__group")).toHaveClass(
      "admin-side-nav__group--product-card",
    );
    expect(screen.getByRole("button", { name: /^Utilities/ }).closest(".admin-side-nav__group")).toHaveClass(
      "admin-side-nav__group--utility",
    );
  });

  it("exposes aria-expanded + aria-controls on expandable groups", () => {
    renderNav();
    const monitoring = screen.getByRole("button", { name: /^Observability/ });
    expect(monitoring.getAttribute("aria-expanded")).toBe("false");
    const controls = monitoring.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    fireEvent.click(monitoring);
    expect(monitoring.getAttribute("aria-expanded")).toBe("true");
    // the controlled region now exists and is labelled by the group
    expect(document.getElementById(controls)).toBeTruthy();
  });

  it("no longer renders the removed Learn/education section", () => {
    renderNav();
    expect(screen.queryByText(/Guided Demo Tour/i)).toBeNull();
    expect(screen.queryByText(/Agentic Maturity Model/i)).toBeNull();
  });

  it("live-filters nav items by label", () => {
    renderNav();
    // present before filtering
    expect(screen.getByText("Themes")).toBeTruthy();
    expect(screen.getByText("Observability")).toBeTruthy();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "observability" } });
    // non-matching top-level item is filtered out; matching group remains
    expect(screen.queryByText("Themes")).toBeNull();
    expect(screen.getByText("Observability")).toBeTruthy();
  });

  it("searching \"authorize\" still surfaces the renamed P1AZ Inspector item", () => {
    renderNav();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "authorize" } });
    expect(screen.getAllByText("P1AZ Inspector").length).toBeGreaterThan(0);
  });

  it("searching agent authorization surfaces the live walkthrough", () => {
    renderNav();
    fireEvent.change(screen.getByLabelText(/search navigation/i), { target: { value: "agent authorization" } });
    expect(screen.getByText("Agent Gateway Authorization").closest("a")).toHaveAttribute(
      "href",
      "/agent-gateway-authorization",
    );
  });

  it("searching activity surfaces both activity destinations", () => {
    renderNav();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "activity" } });
    expect(screen.getByText("Activity Log")).toBeInTheDocument();
    expect(screen.getByText("API Activity")).toBeInTheDocument();
  });

  it("searching api surfaces the persisted API activity page", () => {
    renderNav();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "api" } });
    expect(screen.getByText("API Activity").closest("a")).toHaveAttribute(
      "href",
      "/monitoring/api-activity",
    );
  });

  it("searching discovery surfaces MCP Discovery", () => {
    renderNav();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "discovery" } });
    expect(screen.getByText("MCP Discovery").closest("a")).toHaveAttribute(
      "href",
      "/mcp-discovery",
    );
  });

  it("searching OAuth agents surfaces the AI-Gateway Shadow AI Detector page", () => {
    renderNav();
    fireEvent.change(screen.getByLabelText(/search navigation/i), { target: { value: "oauth agents" } });
    expect(screen.getByText("AI Gateway")).toBeInTheDocument();
    expect(screen.getByText("AI Guard").closest("a")).toHaveAttribute(
      "href",
      "/ai-gateway/shadow-ai-detector",
    );
  });

  it("shows a local-only PAC Editor item under Authorize and opens the PAC editor", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /^Authorize/ }));
    fireEvent.click(screen.getByRole("button", { name: "PAC Editor" }));
    expect(openSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:9099",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("shows an empty state when nothing matches", () => {
    renderNav();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "zzzznope" } });
    expect(screen.getByText(/no matches/i)).toBeTruthy();
  });

  it("marks the active quick-link with aria-current", () => {
    renderNav("/admin");
    const adminQuick = screen
      .getAllByRole("button", { name: "Admin" })
      .find((b) => b.className.includes("quick-link--active"));
    expect(adminQuick).toBeTruthy();
  });

  it("shows the Health Check nav item for a non-admin user (no admin gate)", () => {
    renderNavAsUser(customerUser);
    fireEvent.click(screen.getByRole("button", { name: /^Utilities/ }));
    expect(screen.getByText("Health Check")).toBeInTheDocument();
  });

  it("shows MCP Runtime Inventory for a non-admin user and links to discovery", () => {
    renderNavAsUser(customerUser);
    fireEvent.click(screen.getByRole("button", { name: /^MCP & Integrations/ }));
    const link = screen.getByText("MCP Runtime Inventory").closest("a");
    expect(link).toHaveAttribute("href", "/mcp-discovery");
  });

  it("finds MCP Runtime Inventory by searching for runtime", () => {
    renderNavAsUser(customerUser);
    fireEvent.change(screen.getByLabelText(/search navigation/i), { target: { value: "runtime" } });
    expect(screen.getByText("MCP Runtime Inventory")).toBeInTheDocument();
  });

  it("shows the Demo Config link for a non-admin user (no admin gate)", () => {
    renderNavAsUser(customerUser);
    fireEvent.click(screen.getByRole("button", { name: /^Administration/ }));
    expect(screen.getByText("Demo Config")).toBeInTheDocument();
  });

  it("shows a Use Cases (Live) link inside the Demos group, linking to /use-cases/live", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /^AI Experiences/ }));
    const liveLink = screen.getByText("Use Cases (Live)").closest("a");
    expect(liveLink).toHaveAttribute("href", "/use-cases/live");
  });

  it("exposes LibreChat and LM Studio as personal-agent clients", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /^MCP & Integrations/ }));

    expect(screen.getByRole("button", { name: "LibreChat (browser)" })).toBeInTheDocument();
    expect(screen.getByText("LM Studio (Mac)").closest("a")).toHaveAttribute(
      "href",
      "/privilege-mcp-client?client=lm-studio",
    );
  });

  it("opens LibreChat from the personal-agent navigation entry", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /^MCP & Integrations/ }));
    fireEvent.click(screen.getByRole("button", { name: "LibreChat (browser)" }));
    expect(openSpy).toHaveBeenCalledWith("http://localhost:3080", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("includes Delegated Commerce in the AI Flows customization catalog", () => {
    const flows = NAV_STRUCTURE_CATALOG.find((group) => group.label === "AI Experiences");
    expect(flows.children).toContain("Delegated Commerce (guided demo)");
  });

  // Both showcases are PAGES now, not kickoff actions. The nav used to POST the
  // use case straight from the click and bounce to /dashboard, which showed the
  // outcome without ever showing the policy that produced it; the page runs the
  // same use case from a button that says which outcome to expect. Asserting the
  // link (not a POST) is what keeps the nav from silently reverting to a
  // fire-and-forget action.
  it("Weather MCP and Brave Search MCP link to their showcase pages, not a demo/run POST", async () => {
    const apiClient = (await import("../../services/apiClient")).default;
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /^AI Experiences/ }));

    expect(screen.getByText("Weather MCP").closest("a")).toHaveAttribute(
      "href",
      "/weather-mcp",
    );
    expect(screen.getByText("Brave Search MCP").closest("a")).toHaveAttribute(
      "href",
      "/brave-mcp",
    );

    fireEvent.click(screen.getByText("Weather MCP"));
    expect(apiClient.post).not.toHaveBeenCalledWith(
      "/api/use-cases/demo/run",
      expect.anything(),
    );
  });

  it("hides a nav item the user marked hidden via Demo Config, once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/user/nav-config")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ hiddenLabels: ["Themes"], activeConfigId: null, flagOn: true }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );
    renderNav();
    expect(await screen.findByText("Observability")).toBeInTheDocument();
    expect(screen.queryByText("Themes")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("NAV_ITEM_CATALOG stays in sync with AdminSideNav's real top-level labels", () => {
    renderNavAsUser(customerUser);
    NAV_ITEM_CATALOG.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  // A saved navOrder is a snapshot of the nav when the user dragged it. Groups
  // added afterwards are absent from it, and used to be appended to the very
  // bottom — a newly added product group rendered below the operational tools, which reads
  // as missing rather than as reordered. Reported from the live demo.
  it("places a group the saved navOrder predates at its natural position, not last", async () => {
    // A realistic stale order: no "AI Gateway", and labels from groups
    // that have since been renamed.
    const staleOrder = [
      "Home", "Dashboard", "AI Experiences", "Utilities", "Themes",
      "Observability", "Administration",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/user/nav-config")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                hiddenLabels: [],
                activeConfigId: null,
                navOrder: staleOrder,
                childOrder: null,
                flagOn: true,
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );
    renderNav();
    await screen.findByText("AI Gateway");

    const labels = Array.from(
      document.querySelectorAll(".admin-side-nav__label"),
    ).map((el) => el.textContent.trim());
    const idx = (l) => labels.indexOf(l);

    // It sits after Themes — its position in allNavItems — because
    // Dashboard is the nearest preceding sibling the saved order knows about.
    expect(idx("AI Gateway")).toBeGreaterThan(-1);
    expect(idx("AI Gateway")).toBe(idx("Themes") + 1);
    // And crucially NOT dumped at the bottom past everything ordered.
    expect(idx("AI Gateway")).toBeLessThan(idx("DaVinci"));

    // The user's explicit ordering is still honoured for what it does contain.
    expect(idx("AI Experiences")).toBeLessThan(idx("Themes"));
    vi.unstubAllGlobals();
  });

  it("applies a saved childOrder — a child moved to another group renders there, not in its origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/user/nav-config")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                hiddenLabels: [],
                activeConfigId: null,
                navOrder: null,
                childOrder: {
                  Utilities: [
                    "PingOne MCP Setup",
                    "MCP Inspector",
                    "MCP Runtime Inventory",
                    "Health Check",
                  ],
                },
                flagOn: true,
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
    );
    renderNav();
    expect(await screen.findByText("Utilities")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Utilities"));
    const utilities = screen.getByRole("region", { name: "Utilities" });
    expect(within(utilities).getByText("MCP Inspector")).toBeInTheDocument();

    // The claiming override moves MCP Inspector into Utilities, and the
    // moved child appears exactly once in its new group.
    expect(screen.getAllByText("MCP Inspector")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("Industry Verticals has one entry per destination — no duplicate-path React keys", () => {
    renderNav();
    if (!screen.queryByRole("region", { name: "Administration" })) {
      fireEvent.click(screen.getByRole("button", { name: /^Administration/ }));
    }
    const group = screen.getByRole("region", { name: "Administration" });
    const paths = within(group)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    // Two children resolving to the same path collide on the path-derived key.
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p === "/admin/sporting-goods")).toHaveLength(1);
  });

  it("NAV_STRUCTURE_CATALOG top-level labels stay in sync with AdminSideNav", () => {
    renderNavAsUser(customerUser);
    NAV_STRUCTURE_CATALOG.forEach((group) => {
      expect(screen.getByText(group.label)).toBeInTheDocument();
    });
  });
});
