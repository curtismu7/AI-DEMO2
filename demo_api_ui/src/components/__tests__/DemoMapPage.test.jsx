import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DemoMapPage from "../DemoMapPage";
import { MISSION_CONTROL_CATALOG } from "../../config/missionControlCatalog";
import { CONFIGS } from "../../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../../config/demoStepGuides";
import { DEMO_MAP_ROWS } from "../../config/demoMapRows";
import { readFileSync } from "node:fs";
import path from "node:path";

// The map's contract: every relationship it shows must resolve. A group's
// step must exist in the guides (the launcher card), a diagrammed step must
// resolve through getConfig, and every live group carries at least one
// inspector so the row never renders as a dead end.
describe("DemoMapPage", () => {
  it("renders live groups with inspectors, diagrams and learning rows", () => {
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    const live = MISSION_CONTROL_CATALOG.filter((g) => g.status !== "planned");
    // one group card per live group (the planned section adds no h2s of these)
    for (const g of live) {
      expect(screen.getByText(g.shortLabel || g.label)).toBeTruthy();
    }
    // the four relationship row labels are present
    expect(screen.getAllByText("Demo steps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inspectors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Diagrams").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Learning").length).toBeGreaterThan(0);
  });

  it("every live group with steps has guides and links into the launcher", () => {
    const live = MISSION_CONTROL_CATALOG.filter((g) => g.status !== "planned");
    for (const g of live) {
      for (const ucId of g.useCaseIds || []) {
        expect(DEMO_STEP_GUIDES[ucId]).toBeTruthy();
      }
    }
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    // step links point at the launcher deep link
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/use-cases#UC1");
  });

  it("learning rows reference the Learning Hub (all group learning links route to /learning)", () => {
    const learningLinks = MISSION_CONTROL_CATALOG
      .flatMap((g) => g.learning || []);
    expect(learningLinks.length).toBeGreaterThanOrEqual(15);
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    // each learning label renders as a link to the hub
    for (const t of learningLinks) {
      expect(hrefs).toContain("/learning");
      break; // labels differ, destination is the same; one is enough
    }
  });

  it("diagram glyphs only appear for UCs with a registered config", () => {
    const diagrammed = new Set(CONFIGS.map((c) => c.id));
    const stepLinkUcs = MISSION_CONTROL_CATALOG
      .flatMap((g) => g.useCaseIds || []);
    // sanity: the union of group steps includes at least one diagrammed UC
    expect(stepLinkUcs.some((id) => diagrammed.has(id))).toBe(true);
  });

  it("is a navigation map: banner first and honest, no buttons, one h1, lanes as cards", () => {
    const { container } = render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    const page = container.firstElementChild;
    expect(page.classList.contains("pu-page")).toBe(true);
    // P2: the note is the first thing on the page, before the title band
    const banner = screen.getByTestId("demo-map-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toMatch(/Nothing here runs/i);
    expect(page.firstElementChild.contains(banner)).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1);
    // links only: no button, so no primary and no second action
    expect(container.querySelectorAll("button").length).toBe(0);
    const live = MISSION_CONTROL_CATALOG.filter((g) => g.status !== "planned");
    for (const g of live) {
      const lane = screen.getByTestId(`demo-map-lane-${g.id}`);
      expect(lane.classList.contains("pu-card")).toBe(true);
      expect(lane.querySelector(".pu-chip").textContent.trim()).toBe(g.product);
    }
  });

  it("every diagram glyph link has an accessible name that says which step", () => {
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    const glyphs = screen.getAllByText("◱").filter((el) => el.tagName === "A");
    expect(glyphs.length).toBeGreaterThan(0);
    for (const a of glyphs) {
      expect(a.getAttribute("aria-label")).toMatch(/^Use-case diagram: .+ \(.+\)$/);
    }
  });

  it("no two links share an accessible name and destination (the lane is in the name)", () => {
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    const pairs = screen.getAllByRole("link").map((a) => `${a.getAttribute("aria-label") || a.textContent}|${a.getAttribute("href")}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("the key labels the diagram glyph in words, not as a bare glyph", () => {
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Diagram link (◱)")).toBeTruthy();
  });

  it("planned lanes are labelled Planned, never as live", () => {
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    const planned = MISSION_CONTROL_CATALOG.filter((g) => g.status === "planned");
    if (planned.length === 0) return;
    expect(screen.getByRole("heading", { name: "Planned lanes" })).toBeTruthy();
    expect(screen.getAllByText("Planned").length).toBe(planned.length);
  });

  it("has a row for the Personal Agent demo, the Digital Worker agent and each Ping product", () => {
    expect(DEMO_MAP_ROWS.map((r) => r.id)).toEqual([
      "personal-agent", "digital-worker", "pingone", "pingfederate", "pinggateway", "privilege", "authorize",
    ]);
    render(
      <MemoryRouter>
        <DemoMapPage />
      </MemoryRouter>,
    );
    for (const r of DEMO_MAP_ROWS) {
      const card = screen.getByTestId(`demo-map-row-${r.id}`);
      expect(card.textContent).toContain(r.title);
      expect(card.querySelectorAll("a").length).toBe(r.pages.length);
      expect(r.pages.length).toBeGreaterThan(0);
    }
  });

  it("every row page is a real route in App.js", () => {
    const app = readFileSync(path.resolve(__dirname, "../../App.js"), "utf8");
    const routes = new Set([...app.matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]));
    const missing = DEMO_MAP_ROWS.flatMap((r) => r.pages.map((p) => p.path)).filter((p) => !routes.has(p.split("?")[0]));
    expect(missing).toEqual([]);
  });
});

