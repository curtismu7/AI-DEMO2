import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageGuide from "../PageGuide";
import PageGuideButton from "../PageGuideButton";
import { PAGE_GUIDES } from "../../config/pageGuides";
import { getLesson } from "../../learning/lessonCatalog";
import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  EXTRA_STEP_GROUPS,
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
    ...EXTRA_STEP_GROUPS.flatMap((g) => g.ids),
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
  expect(screen.getByText(/Step 43 · UC37: /)).toBeTruthy();
  expect(screen.getByText(/Step 46 · UC4: /)).toBeTruthy();
});

test("step numbers match the menu, admin included, and skip non-steps", () => {
  expect(stepLabel("UC24")).toBe("Step 1 · UC24");
  expect(stepLabel("UC43")).toBe("Step 27 · UC43");
  expect(demoStepNumber("ADMIN13")).toBe(13);
  expect(stepLabel("UC999")).toBe("UC999");
  expect(demoStepNumber("UC40")).toBe(22); // first appearance wins over its Privilege-group slot
  expect(demoStepNumber("UC2")).toBe(9); // repeated in the A2A group, keeps its script number
  expect(demoStepNumber("UC2.6")).toBe(31);
  expect(demoStepNumber("UC37")).toBe(43);
});

test("the requested pages each have a three-step guide", () => {
  const routes = [
    "/use-cases", "/demo-track", "/agent-builder", "/agent-lifecycle", "/autonomous-agents", "/langchain",
    "/ungoverned-agent", "/delegation-chain-value", "/group-policy", "/agent-guardrails",
    "/ai-products/core", "/ai-products/gateway", "/ai-products/authorize", "/ai-products/protect",
    "/ai-products/privilege-llm", "/ai-products/privilege-a2a", "/ai-products/privilege-mcp",
    "/agent-gateway-capabilities", "/pingone-authorize-capabilities", "/agentic-trust", "/iga-for-ai",
    "/transaction-consent", "/actor-token-education", "/pingfederate-ai-agent",
  ];
  expect(routes).toHaveLength(24);
  for (const r of routes) {
    expect(PAGE_GUIDES[r]?.walkthrough, r).toHaveLength(3);
    expect(PAGE_GUIDES[r].talkingPoints, r).toHaveLength(3);
  }
  at("/ai-products/authorize");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByText("Separate who from what")).toBeTruthy();
});

test("with a header Guide button the floating one is hidden and the header one opens the modal", () => {
  render(
    <MemoryRouter initialEntries={["/pingone-mcp-inspector"]}>
      <PageGuideButton />
      <PageGuide />
    </MemoryRouter>,
  );
  expect(document.querySelector(".page-guide__trigger")).toBeNull();
  fireEvent.click(screen.getByTestId("topnav-guide"));
  expect(screen.getByText(getLesson("mcp").title)).toBeTruthy();
});

test("two headers on one page still show a single Guide button", () => {
  render(
    <MemoryRouter initialEntries={["/pingone-mcp-inspector"]}>
      <PageGuideButton />
      <PageGuideButton />
    </MemoryRouter>,
  );
  expect(screen.getAllByTestId("topnav-guide")).toHaveLength(1);
});

test("the header button is absent on routes with no guide", () => {
  render(
    <MemoryRouter initialEntries={["/nope"]}>
      <PageGuideButton />
    </MemoryRouter>,
  );
  expect(screen.queryByTestId("topnav-guide")).toBeNull();
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
