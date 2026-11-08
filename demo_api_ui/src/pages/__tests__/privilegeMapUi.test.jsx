import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMapPage from "../PrivilegeMapPage";
import features from "../../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../../config/privilegeMapPages";

const FEATURE_URL = "/privilege-map?page=oversight&feature=cedar-per-call-policy";
const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><PrivilegeMapPage /></MemoryRouter>);

describe("Privilege Map on the Ping UI standard", () => {
  it("renders the banner first, before the title band, as a note that says nothing here is live", () => {
    const { container } = renderAt(FEATURE_URL);
    const page = container.querySelector(".pu-page.pmap-page");
    expect(page).toBeTruthy();
    expect(page.firstElementChild.className).toBe("pu-banner-wrap");
    const banner = screen.getByTestId("pmap-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toMatch(/Draft content compiled from Ping documentation/);
    expect(banner.textContent).toMatch(/Nothing\s+on this page calls Privilege/);
    expect(page.querySelector("header")).toBeTruthy();
    expect(banner.compareDocumentPosition(page.querySelector("header")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has exactly one primary button in the feature view, and it is the diagram link", () => {
    const { container } = renderAt(FEATURE_URL);
    const primaries = container.querySelectorAll(".pu-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0].tagName).toBe("A");
    expect(primaries[0].textContent).toMatch(/Open the diagram in a new tab/);
  });

  it("adds no page-owned primary in the diagram view (Simulate is the primary there)", () => {
    const { container } = renderAt(`${FEATURE_URL}&diagram=1`);
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Simulate/ })).toBeTruthy();
    expect(screen.getByTestId("pmap-banner").textContent).toMatch(/not from a trace of a real call/);
    expect(screen.getByTestId("pmap-banner").getAttribute("role")).toBe("note");
  });

  it("every chip carries a word, and the feature chips name the draft and the unverified count", () => {
    const { container } = renderAt(FEATURE_URL);
    const chips = [...container.querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(2);
    for (const c of chips) expect(c.textContent.trim().length).toBeGreaterThan(0);
    const feature = features.find((f) => f.id === "cedar-per-call-policy");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(`${feature.unverified.length} not verified`)).toBeTruthy();
    const used = screen.getByRole("heading", { name: "Components used" }).closest(".pu-card");
    expect(used.querySelectorAll(".pu-chip")).toHaveLength(feature.components.length);
  });

  it("shows the feature facts in a key-value list and the sources inside the disclosure", () => {
    const { container } = renderAt(FEATURE_URL);
    const feature = features.find((f) => f.id === "cedar-per-call-policy");
    expect(container.querySelectorAll("dl.pu-kv").length).toBe(2);
    const details = container.querySelector("details");
    expect(within(details).getByText("Sources")).toBeTruthy();
    expect(details.textContent).toContain(feature.sources[0]);
    for (const u of feature.unverified) expect(details.textContent).toContain(u);
  });

  it("uses real, named buttons for the pickers, with the selection in aria-pressed and a check mark", () => {
    renderAt(FEATURE_URL);
    const tabs = screen.getByRole("navigation", { name: "Privilege Map pages" });
    const buttons = within(tabs).getAllByRole("button");
    expect(buttons).toHaveLength(PRIVILEGE_MAP_PAGES.length);
    for (const b of buttons) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
      expect(b.className).toBe("pu-btn");
    }
    expect(within(tabs).getByRole("button", { name: "Oversight" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(tabs).getByRole("button", { name: "Identity" }).getAttribute("aria-pressed")).toBe("false");
    // the check mark is decoration: the accessible name stays the bare label
    expect(within(tabs).getByRole("button", { name: "Oversight" }).textContent).toMatch(/^✓ Oversight$/);
  });

  it("moves the selection and the detail with the buttons (the keyboard activates a button with a click)", () => {
    renderAt(FEATURE_URL);
    const list = screen.getByRole("navigation", { name: "Oversight features" });
    const next = within(list).getByRole("button", { name: "Audit evidence" });
    next.focus();
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(screen.getByRole("heading", { level: 2, name: "Audit evidence" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Cedar per-call policy" })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Oversight features" })).getByRole("button", { name: "Audit evidence" }).getAttribute("aria-pressed")).toBe("true");
    // the new feature's own diagram link follows
    expect(screen.getByRole("link", { name: /Open the diagram in a new tab/ }).getAttribute("href")).toBe("/privilege-map?page=oversight&feature=audit-evidence&diagram=1");
  });

  it("labels every section landmark with its heading", () => {
    renderAt(FEATURE_URL);
    const regions = screen.getAllByRole("region");
    expect(regions.length).toBeGreaterThanOrEqual(3);
    for (const r of regions) expect(r.getAttribute("aria-labelledby")).toBeTruthy();
  });
});
