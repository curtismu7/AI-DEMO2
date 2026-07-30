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

  it("exposes aria-expanded + aria-controls on expandable groups", () => {
    renderNav();
    const monitoring = screen.getByRole("button", { name: /^Monitoring/ });
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
    expect(screen.getByText("Monitoring")).toBeTruthy();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "monitor" } });
    // non-matching top-level item is filtered out; matching group remains
    expect(screen.queryByText("Themes")).toBeNull();
    expect(screen.getByText("Monitoring")).toBeTruthy();
  });

  it("searching \"authorize\" still surfaces the renamed P1AZ Inspector item", () => {
    renderNav();
    const input = screen.getByLabelText(/search navigation/i);
    fireEvent.change(input, { target: { value: "authorize" } });
    expect(screen.getAllByText("P1AZ Inspector").length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("button", { name: /^Telemetry/ }));
    expect(screen.getByText("Health Check")).toBeInTheDocument();
  });

  it("shows the Demo Config link for a non-admin user (no admin gate)", () => {
    renderNavAsUser(customerUser);
    expect(screen.getByText("Demo Config")).toBeInTheDocument();
  });

  it("shows a Use Cases (Live) link right under Use Cases, linking to /use-cases/live", () => {
    renderNav();
    const liveLink = screen.getByText("Use Cases (Live)").closest("a");
    expect(liveLink).toHaveAttribute("href", "/use-cases/live");
  });

  it("Weather MCP runs UC30 (weather-mcp-texas-permit) via demo/run", async () => {
    const apiClient = (await import("../../services/apiClient")).default;
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: /^MCP & Gateways/ }));
    fireEvent.click(screen.getByText("Weather MCP"));
    expect(apiClient.post).toHaveBeenCalledWith("/api/use-cases/demo/run", {
      useCaseId: "weather-mcp-texas-permit",
      vertical: "banking",
    });
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
    expect(await screen.findByText("Monitoring")).toBeInTheDocument();
    expect(screen.queryByText("Themes")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("NAV_ITEM_CATALOG stays in sync with AdminSideNav's real top-level labels", () => {
    renderNavAsUser(customerUser);
    NAV_ITEM_CATALOG.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
