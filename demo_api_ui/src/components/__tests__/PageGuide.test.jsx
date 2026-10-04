import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageGuide from "../PageGuide";
import { PAGE_GUIDES } from "../../config/pageGuides";
import { getLesson } from "../../learning/lessonCatalog";
import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  PRIVILEGE_USE_CASE_IDS,
} from "../../config/demoUseCaseSteps";
import { DEMO_STEP_GUIDES } from "../../config/demoStepGuides";
import { demoStepNumber, stepLabel } from "../../config/demoStepNumbers";

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

test("every demo step in the menu has a complete guide", () => {
  const ids = [
    ...DEMO_PRIMARY_USE_CASE_IDS,
    ...CIAM_AGENT_TYPE_USE_CASE_IDS,
    ...PRIVILEGE_USE_CASE_IDS,
    ...ADMIN_PRIMARY_USE_CASE_IDS,
  ];
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const s = DEMO_STEP_GUIDES[id];
    for (const f of ["title", "what", "why", "businessValue", "howToRun"]) expect(s?.[f], `${id}.${f}`).toBeTruthy();
  }
});

test("dashboard guide lists the demo steps", () => {
  at("/dashboard");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByText(/Step 1 · UC24: /)).toBeTruthy();
  expect(screen.getByText(/Step 26 · UC47: /)).toBeTruthy();
  expect(screen.getByText(/Step 27 · UC43: /)).toBeTruthy();
  expect(screen.getByText(/Step 32 · UC17: /)).toBeTruthy();
  expect(screen.getByText(/Step 13 · ADMIN13: /)).toBeTruthy();
});

test("step numbers match the menu, admin included, and skip non-steps", () => {
  expect(stepLabel("UC24")).toBe("Step 1 · UC24");
  expect(stepLabel("UC43")).toBe("Step 27 · UC43");
  expect(demoStepNumber("ADMIN13")).toBe(13);
  expect(stepLabel("UC999")).toBe("UC999");
  expect(demoStepNumber("UC40")).toBe(22); // first appearance wins over its Privilege-group slot
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
