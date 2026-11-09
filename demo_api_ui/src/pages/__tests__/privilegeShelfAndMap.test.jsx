import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeShelfPage from "../PrivilegeShelfPage";
import PrivilegeMapPage from "../PrivilegeMapPage";
import features from "../../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../../config/privilegeMapPages";
import { buildFeatureDiagram } from "../../config/privilegeFeatureDiagram";

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

  it("lists the Privilege Logging Lab, linking its repository in a new tab", () => {
    renderAt(<PrivilegeShelfPage />);
    const a = screen.getByRole("link", { name: /Privilege Logging Lab/ });
    expect(a.getAttribute("href")).toBe("https://github.com/curtismu7/privilege-logging-LAB");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("links the privilege-map GitHub repository in a new tab", () => {
    renderAt(<PrivilegeShelfPage />);
    const a = screen.getByRole("link", { name: /privilege-map on GitHub/ });
    expect(a.getAttribute("href")).toBe("https://github.com/curtismu7/privilege-map-LAB");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toMatch(/noopener/);
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

describe("Privilege Map feature diagrams", () => {
  it("links the feature to its diagram, opening in a new tab", () => {
    renderAt(<PrivilegeMapPage />, "/privilege-map?page=oversight&feature=cedar-per-call-policy");
    const link = screen.getByRole("link", { name: /Open the diagram in a new tab/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.getAttribute("href")).toBe("/privilege-map?page=oversight&feature=cedar-per-call-policy&diagram=1");
  });

  it("renders the diagram view with Simulate and Reset, and a way back", () => {
    renderAt(<PrivilegeMapPage />, "/privilege-map?page=oversight&feature=cedar-per-call-policy&diagram=1");
    expect(screen.getByRole("heading", { level: 1, name: /Cedar per-call policy: what it uses/ })).toBeTruthy();
    expect(screen.getByTestId("pmap-diagram")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Simulate/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reset/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to the feature/ }).getAttribute("href")).toBe("/privilege-map?page=oversight&feature=cedar-per-call-policy");
  });

  it("falls back to the feature list when the diagram feature is unknown", () => {
    renderAt(<PrivilegeMapPage />, "/privilege-map?feature=nope&diagram=1");
    expect(screen.queryByTestId("pmap-diagram")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Privilege Map" })).toBeTruthy();
  });

  it.each(features.map((f) => [f.id, f]))("%s: the generated diagram is well formed and reuses the feature's own words", (_id, f) => {
    const c = buildFeatureDiagram(f, "Page");
    const ids = c.NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.NODES).toHaveLength(f.components.length + 1);
    c.NODES.forEach((n) => expect(c.GROUPS[n.group]).toBeTruthy());
    expect(c.EDGES).toHaveLength(f.components.length);
    c.EDGES.forEach(([s, t, label]) => {
      expect(ids).toContain(s);
      expect(ids).toContain(t);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(40);
    });
    const corpus = `${f.how} ${f.why}`;
    c.STEPS.forEach((s) => expect(s.what.endsWith("is one of the components this feature uses.") || corpus.includes(s.what)).toBe(true));
  });
});
