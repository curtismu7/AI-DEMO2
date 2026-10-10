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
import { A2A_SEQUENCE, DEMO_STEP_GUIDES } from "../../config/demoStepGuides";
import { A2A_REFERENCE } from "../../config/a2aReference";
import { demoStepNumber, stepLabel } from "../../config/demoStepNumbers";

const at = (path) => render(<MemoryRouter initialEntries={[path]}><PageGuide /></MemoryRouter>);

test("every mapped lesson id exists", () => {
  for (const g of Object.values(PAGE_GUIDES)) for (const id of g.lessons || []) expect(getLesson(id)).not.toBeNull();
});

test("walkthrough prose that names a page links to it (Privilege Gateway Topologies)", () => {
  // The privilege-a2a lesson's "Give each agent its own key" step names the
  // topologies page; PageGuide must render it as a link, not dictation.
  at("/privilege-gateway-topologies");
  fireEvent.click(screen.getByText("Guide"));
  const link = screen.getByRole("link", { name: "Privilege Gateway Topologies" });
  expect(link.getAttribute("href")).toBe("/privilege-gateway-topologies");
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
  // UC47 and UC37 also appear in the A2A sequence, so expect both copies.
  expect(screen.getAllByText(/Step 27 · UC47: /)).toHaveLength(2);
  expect(screen.getByText(/Step 30 · UC43: /)).toBeTruthy();
  // UC48 and the MUSE steps joined before the themed groups, shifting them.
  expect(screen.getByText(/Step 36 · UC17: /)).toBeTruthy();
  expect(screen.getByText(/Step 13 · ADMIN13: /)).toBeTruthy();
  expect(screen.getAllByText(/Step 47 · UC37: /)).toHaveLength(2);
  expect(screen.getByText(/Step 50 · UC4: /)).toBeTruthy();
});

test("step numbers match the menu, admin included, and skip non-steps", () => {
  expect(stepLabel("UC24")).toBe("Step 1 · UC24");
  expect(stepLabel("UC43")).toBe("Step 30 · UC43");
  expect(demoStepNumber("ADMIN13")).toBe(13);
  expect(stepLabel("UC999")).toBe("UC999");
  expect(demoStepNumber("UC40")).toBe(23); // first appearance wins over its Privilege-group slot
  expect(demoStepNumber("UC2")).toBe(9); // repeated in the A2A group, keeps its script number
  expect(demoStepNumber("UC2.6")).toBe(35); // past UC48's CIAM slot and the MUSE steps
  expect(demoStepNumber("UC37")).toBe(47);
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

test("the standalone learning pages each have a three-step guide", () => {
  for (const r of ["/a2a-protocol-learning", "/intent-binding-learning", "/privilege-mcp-learning",
    "/oauth-academy", "/learning", "/academy/demos", "/davinci-widget"]) {
    expect(PAGE_GUIDES[r]?.walkthrough, r).toHaveLength(3);
    expect(PAGE_GUIDES[r].talkingPoints, r).toHaveLength(3);
  }
});

test("the Jev page guide covers all four panels including the LangChain one", () => {
  // /jev-learning grew a fourth walkthrough step when the LangChain panel
  // landed (page + demo step UC-LEARN15); the pinned-at-three list above
  // deliberately excludes it.
  expect(PAGE_GUIDES["/jev-learning"].walkthrough).toHaveLength(4);
  expect(PAGE_GUIDES["/jev-learning"].talkingPoints).toHaveLength(3);
  const walk = PAGE_GUIDES["/jev-learning"].walkthrough.map((s) => s.title);
  expect(walk).toEqual([
    "Frame System One vs System Two",
    "Run both deciders on the same text",
    "Show that confidence is not permission, then the bake-offs",
    "Close with the LangChain panel",
  ]);
});

test("the dashboard guide leads with the A2A sequence, every step known", () => {
  expect(A2A_SEQUENCE.steps.map((s) => s.id)).toEqual(["UC2.7", "UC2", "UC2.5", "UC2.6", "UC37", "UC46", "UC47"]);
  for (const s of A2A_SEQUENCE.steps) {
    expect(DEMO_STEP_GUIDES[s.id], s.id).toBeTruthy();
    expect(s.adds && s.skipWhen, s.id).toBeTruthy();
  }
  at("/dashboard");
  fireEvent.click(screen.getByText("Guide"));
  const seq = screen.getByTestId("a2a-sequence");
  expect(seq.textContent).toContain("Step 11 · UC2.7");
  expect(seq.textContent).toContain("Step 27 · UC47");
});

test("the A2A reference covers the spec and the interfaces, and shows in both guides", () => {
  const headings = A2A_REFERENCE.sections.map((s) => s.heading);
  expect(headings).toEqual(expect.arrayContaining([
    "Interfaces between agents (transports)", "Agent Card", "Operations",
    "What this demo implements", "What this demo does not implement",
  ]));
  expect(A2A_REFERENCE.specVersion).toMatch(/1\.0/);
  for (const s of A2A_REFERENCE.sections) expect(s.points.length, s.heading).toBeGreaterThan(0);

  at("/a2a-protocol-learning");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByTestId("a2a-reference")).toBeTruthy();
  expect(screen.getByText("Interfaces between agents (transports)")).toBeTruthy();
});

test("the dashboard guide also carries the A2A reference", () => {
  at("/dashboard");
  fireEvent.click(screen.getByText("Guide"));
  expect(screen.getByTestId("a2a-reference")).toBeTruthy();
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
