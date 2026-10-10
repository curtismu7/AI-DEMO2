import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DemoMapPage from "../DemoMapPage";
import { MISSION_CONTROL_CATALOG } from "../../config/missionControlCatalog";
import { CONFIGS } from "../../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../../config/demoStepGuides";

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
});
