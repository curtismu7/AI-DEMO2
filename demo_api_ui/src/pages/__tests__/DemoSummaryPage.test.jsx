import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import DemoSummaryPage from "../DemoSummaryPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <DemoSummaryPage />
    </MemoryRouter>,
  );

describe("DemoSummaryPage", () => {
  it("lists catalog pages with links to their routes", async () => {
    renderPage();
    // Weather MCP is a known catalog entry; its blurb and route must be linked.
    const link = await screen.findByRole("link", { name: /Weather MCP/i });
    expect(link).toHaveAttribute("href", "/weather-mcp");
    // The one-line "what it demos" blurb is shown.
    expect(screen.getByText(/Miami is denied/i)).toBeInTheDocument();
  });

  it("hides non-demo entries: external tools, redirect stubs, dev pages", () => {
    renderPage();
    // PAC Editor's "route" is an external local tool, not an app route.
    expect(screen.queryByText("PAC Editor")).not.toBeInTheDocument();
    // Redirect stubs duplicate their target page ("Same as ..." demos).
    expect(screen.queryByText("DaVinci Login")).not.toBeInTheDocument();
    // Dev-only pages are on the explicit hide list.
    expect(screen.queryByText("Code Explorer")).not.toBeInTheDocument();
  });

  it("filters groups by search query", async () => {
    renderPage();
    await screen.findByRole("link", { name: /Weather MCP/i });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "weather" } });
    expect(screen.getByRole("link", { name: /Weather MCP/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Security Dashboard/i })).not.toBeInTheDocument();
  });

  it("offers a way to bring the side nav back when it is hidden", () => {
    localStorage.setItem("adminSideNav.hidden", "1");
    renderPage();
    const restore = screen.getByRole("button", { name: /show side menu/i });
    fireEvent.click(restore);
    expect(localStorage.getItem("adminSideNav.hidden")).toBe("0");
    localStorage.removeItem("adminSideNav.hidden");
  });

  it("does not offer the restore button when the side nav is visible", () => {
    localStorage.setItem("adminSideNav.hidden", "0");
    renderPage();
    expect(screen.queryByRole("button", { name: /show side menu/i })).not.toBeInTheDocument();
    localStorage.removeItem("adminSideNav.hidden");
  });

  it("opens with an honest static-index banner before the title band", () => {
    const { container } = renderPage();
    const banner = screen.getByTestId("dsum-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner).toHaveTextContent(/static index/i);
    expect(banner).toHaveTextContent(/nothing on it calls a service/i);
    // P2: the banner is the first thing on the page, above the header band.
    expect(container.querySelector(".pu-page").firstElementChild).toContainElement(banner);
  });

  it("shows each page as a card with its route and a word-bearing access chip", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: /Weather MCP/i });
    const card = link.closest(".pu-card");
    expect(card).not.toBeNull();
    expect(card.querySelector("h3")).toContainElement(link);
    expect(card).toHaveTextContent("/weather-mcp");
    const chip = card.querySelector(".pu-chip");
    expect(chip.textContent.trim()).not.toBe("");
    // Admin and signed-in pages say so in words too.
    const admin = screen.getByRole("link", { name: /^Security Dashboard$/i }).closest(".pu-card");
    expect(admin.querySelector(".pu-chip")).toHaveTextContent("Admin");
    // Every chip on the page carries a word.
    for (const c of document.querySelectorAll(".pu-chip")) expect(c.textContent.trim()).not.toBe("");
  });

  it("reports how many pages match the filter", () => {
    renderPage();
    expect(screen.getByTestId("dsum-count")).toHaveTextContent(/^Showing all \d+ pages\.$/);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "weather" } });
    expect(screen.getByTestId("dsum-count")).toHaveTextContent(/^Showing \d+ of \d+ pages\.$/);
  });

  it("says so when nothing matches the filter", () => {
    renderPage();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz-no-such-page" } });
    expect(screen.getByTestId("dsum-empty")).toHaveTextContent(/No page matches/i);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("has no primary button while the side menu is visible", () => {
    localStorage.setItem("adminSideNav.hidden", "0");
    const { container } = renderPage();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    localStorage.removeItem("adminSideNav.hidden");
  });

  it("makes Show side menu the one primary when the side menu is hidden, and keeps focus in the page", () => {
    localStorage.setItem("adminSideNav.hidden", "1");
    const { container } = renderPage();
    const primaries = container.querySelectorAll(".pu-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent(/show side menu/i);
    primaries[0].focus();
    fireEvent.click(primaries[0]);
    // The button goes away once the menu is back; focus lands on the filter field, not on the body.
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.queryByRole("button", { name: /show side menu/i })).not.toBeInTheDocument();
    localStorage.removeItem("adminSideNav.hidden");
  });
  it("uses the trimmed query in the title, so a whitespace-only filter is not 'Results for \" \"'", () => {
    renderPage();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "   " } });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Everything you can demo");
    expect(h1).not.toHaveTextContent(/Results for/);
    expect(screen.getByTestId("dsum-count")).toHaveTextContent(/^Showing all \d+ pages\.$/);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  weather " } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Results for\s+.weather.$/);
  });

  it("moves focus to the filter field when the menu is restored elsewhere while the button has focus", () => {
    localStorage.setItem("adminSideNav.hidden", "1");
    renderPage();
    screen.getByRole("button", { name: /show side menu/i }).focus();
    // Ctrl+Shift+B in the shell writes the flag and fires this event; the button then unmounts.
    act(() => {
      localStorage.setItem("adminSideNav.hidden", "0");
      window.dispatchEvent(new CustomEvent("admin-sidenav-hidden-toggle"));
    });
    expect(screen.queryByRole("button", { name: /show side menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    localStorage.removeItem("adminSideNav.hidden");
  });

  it("leaves focus alone when the menu is restored while focus is elsewhere", () => {
    localStorage.setItem("adminSideNav.hidden", "1");
    renderPage();
    const box = screen.getByRole("searchbox");
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    act(() => {
      localStorage.setItem("adminSideNav.hidden", "0");
      window.dispatchEvent(new CustomEvent("admin-sidenav-hidden-toggle"));
    });
    expect(box).not.toHaveFocus();
    expect(other).toHaveFocus();
    other.remove();
    localStorage.removeItem("adminSideNav.hidden");
  });
});
