import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom";
import PrivilegeShelfPage from "../PrivilegeShelfPage";
import { PRIVILEGE_MAP_PAGES } from "../../config/privilegeMapPages";

const renderPage = () => render(<MemoryRouter><PrivilegeShelfPage /></MemoryRouter>);

describe("PrivilegeShelfPage on the Ping UI Standard", () => {
  it("puts the index banner first, as a note, above the title band", () => {
    const { container } = renderPage();
    const page = container.querySelector(".pu-page");
    expect(page).toBeTruthy();
    expect(page.firstElementChild.classList.contains("pu-banner-wrap")).toBe(true);
    const banner = screen.getByTestId("pshelf-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toMatch(/links to other pages/);
    expect(banner.textContent).toMatch(/no simulated/);
  });

  it("has one section landmark per group, each with a heading", () => {
    renderPage();
    for (const name of ["Privilege Map", "Guides and diagrams", "Documentation", "Demos", "Source code"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
  });

  it("makes every card exactly one named link (keyboard reachable) with a heading", () => {
    const { container } = renderPage();
    const cards = container.querySelectorAll(".pshelf-card");
    expect(cards.length).toBeGreaterThan(10);
    expect(screen.getAllByRole("listitem").length).toBe(cards.length);
    expect(screen.getAllByRole("list").length).toBe(5);
    for (const card of cards) {
      const links = within(card).getAllByRole("link");
      expect(links.length).toBe(1);
      expect(links[0].textContent.trim()).not.toBe("");
      expect(within(card).getByRole("heading", { level: 3 })).toBeTruthy();
    }
  });

  it("has no buttons, so no primary button in any state", () => {
    const { container } = renderPage();
    expect(screen.queryAllByRole("button").length).toBe(0);
    expect(container.querySelectorAll(".pu-btn--primary").length).toBe(0);
  });

  it("gives every chip a word and keeps the legacy page class off the old card markup", () => {
    const { container } = renderPage();
    const chips = container.querySelectorAll(".pu-chip");
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c.textContent.trim().length).toBeGreaterThan(0);
    expect(container.querySelector(".pshelf-body")).toBeNull();
    expect(screen.getAllByText("New in the Platform Update").length).toBe(6);
    expect(screen.getAllByText("Opens in a new tab").length).toBe(2);
  });

  it("never prints a section's title twice: the kicker adds the position and the link count instead", () => {
    const { container } = renderPage();
    const kickers = [...container.querySelectorAll(".pu-kicker")].map((k) => k.textContent);
    expect(kickers).toEqual([
      `1 of 5 \u00b7 ${PRIVILEGE_MAP_PAGES.length} links`,
      "2 of 5 \u00b7 4 links",
      "3 of 5 \u00b7 1 link",
      "4 of 5 \u00b7 9 links",
      "5 of 5 \u00b7 1 link",
    ]);
    for (const region of screen.getAllByRole("region")) {
      const title = within(region).getByRole("heading", { level: 2 }).textContent;
      expect(region.querySelector(".pu-kicker").textContent).not.toContain(title);
    }
  });

  it("gives the external link its new-tab warning as its accessible description", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /privilege-map on GitHub/ });
    expect(link).toHaveAccessibleDescription("Opens in a new tab");
    // in-app links have nothing extra to announce
    expect(screen.getByRole("link", { name: "Privilege Docs Index" })).not.toHaveAttribute("aria-describedby");
  });
});
