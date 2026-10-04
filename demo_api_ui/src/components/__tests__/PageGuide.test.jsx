import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageGuide from "../PageGuide";
import { PAGE_GUIDES } from "../../config/pageGuides";
import { getLesson } from "../../learning/lessonCatalog";
import { DEMO_PRIMARY_USE_CASE_IDS } from "../../config/demoUseCaseSteps";
import { DEMO_STEP_GUIDES } from "../../config/demoStepGuides";

const at = (path) => render(<MemoryRouter initialEntries={[path]}><PageGuide /></MemoryRouter>);

test("every mapped lesson id exists", () => {
  for (const g of Object.values(PAGE_GUIDES)) for (const id of g.lessons || []) expect(getLesson(id)).not.toBeNull();
});

test("every guide has content and inline guides render", () => {
  for (const [route, g] of Object.entries(PAGE_GUIDES)) {
    expect(g.lessons || g.body || g.walkthrough?.length, route).toBeTruthy();
  }
  at("/llm-gateway");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByText("Choose a lane")).toBeTruthy();
});

test("every presenter demo step has a complete guide", () => {
  expect(DEMO_PRIMARY_USE_CASE_IDS.length).toBeGreaterThan(0);
  for (const id of DEMO_PRIMARY_USE_CASE_IDS) {
    const s = DEMO_STEP_GUIDES[id];
    for (const f of ["title", "what", "why", "businessValue", "howToRun"]) expect(s?.[f], `${id}.${f}`).toBeTruthy();
  }
});

test("dashboard guide lists the demo steps", () => {
  at("/dashboard");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByText(/UC24: /)).toBeTruthy();
  expect(screen.getByText(/UC47: /)).toBeTruthy();
});

test("no button on an unmapped route", () => {
  at("/nope");
  expect(screen.queryByText("Guide")).toBeNull();
});

test("button opens the lesson guide", () => {
  at("/pingone-mcp-inspector");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByText(getLesson("mcp").title)).toBeTruthy();
});
