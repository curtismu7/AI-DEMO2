import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeShelfPage from "../PrivilegeShelfPage";
import PrivilegeMapPage from "../PrivilegeMapPage";
import features from "../../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../../config/privilegeMapPages";

const renderAt = (ui, url = "/") => render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);

describe("Privilege Map data", () => {
  it("puts every feature on exactly one known page with all four sections filled", () => {
    const pageIds = new Set(PRIVILEGE_MAP_PAGES.map((p) => p.id));
    const ids = features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of features) {
      expect(pageIds.has(f.page)).toBe(true);
      for (const k of ["why", "how", "userValue"]) expect(String(f[k] || "").trim()).not.toBe("");
      expect(f.components.length).toBeGreaterThan(0);
    }
    for (const p of PRIVILEGE_MAP_PAGES) expect(features.some((f) => f.page === p.id)).toBe(true);
  });
});

describe("PrivilegeShelfPage", () => {
  it("links every Privilege resource", () => {
    renderAt(<PrivilegeShelfPage />);
    expect(screen.getByRole("heading", { name: "Privilege shelf" })).toBeTruthy();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const p of PRIVILEGE_MAP_PAGES) expect(hrefs).toContain(`/privilege-map?page=${p.id}`);
    for (const h of ["/privilege-docs-index", "/privilege-mcp-learning", "/privilege-mcp-diagrams", "/privilege-gateway-topologies", "/external-door-diagrams", "/privilege-ai-policies", "/privilege-pf-token", "/privilege-demo"]) {
      expect(hrefs).toContain(h);
    }
  });
});

describe("PrivilegeMapPage", () => {
  it("shows the four standard sections for a feature and the draft note", () => {
    renderAt(<PrivilegeMapPage />);
    for (const t of ["Why we need it", "How it works", "Value to the end user", "Components used"]) {
      expect(screen.getByRole("heading", { name: t })).toBeTruthy();
    }
    expect(screen.getByRole("note").textContent).toMatch(/Draft content/);
  });

  it("switches page and feature from the buttons, and opens a page from the query string", () => {
    renderAt(<PrivilegeMapPage />, "/privilege-map?page=oversight&feature=cedar-per-call-policy");
    expect(screen.getByRole("heading", { name: "Cedar per-call policy" })).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "Privilege Map pages" });
    fireEvent.click(within(tabs).getByRole("button", { name: "LLM" }));
    const list = screen.getByRole("navigation", { name: "LLM features" });
    expect(within(list).getAllByRole("button").length).toBe(features.filter((f) => f.page === "llm").length);
  });
});
