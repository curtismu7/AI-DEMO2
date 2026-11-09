// WhereEverythingRunsPage.test.jsx - /where-everything-runs draws the bundled sample as a movable ReactFlow map, flips between
// Today and After, opens a detail panel on a card click, and Reset puts the boxes back. The sample carries no hostnames,
// URLs, IPs, ids or secrets (the repo is public).
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import pageCss from "../components/WhereEverythingRunsPage.css?raw";
import WhereEverythingRunsPage, { ENV_MAP_URL } from "../components/WhereEverythingRunsPage";
import { WHERE_RUNS_SAMPLE } from "../config/whereRunsSample";
import { MISSION_CONTROL_CATALOG } from "../config/missionControlCatalog";
import { buildViews, chooseViewport, MIN_ZOOM } from "../utils/whereRunsModel";

const renderPage = () => render(<MemoryRouter><WhereEverythingRunsPage /></MemoryRouter>);
const cardIds = (container) => [...container.querySelectorAll('[data-testid^="wr-card-"]')].map((n) => n.getAttribute("data-testid").slice("wr-card-".length));

describe("WhereEverythingRunsPage", () => {
  it("renders the header, the Sample data banner with the standalone link, and the Today map", async () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Where Everything Runs" })).toBeTruthy();
    const banner = screen.getByTestId("wr-banner");
    expect(banner.textContent).toContain("Sample data");
    expect(within(banner).getByRole("link").getAttribute("href")).toBe(ENV_MAP_URL);
    expect(screen.getByTestId("wr-view-today").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(5));
    expect(screen.getByTestId("wr-region-mac")).toBeTruthy();
    expect(screen.getByTestId("wr-region-ai-demo")).toBeTruthy();
    expect(screen.getByTestId("wr-region-pingone")).toBeTruthy();
    expect(screen.queryByTestId("wr-after-note")).toBeNull();
  });

  it("changes the node set when toggled to After", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(cardIds(container).length).toBeGreaterThan(5));
    const today = cardIds(container);
    fireEvent.click(screen.getByTestId("wr-view-after"));
    await waitFor(() => expect(screen.getByTestId("wr-stage").getAttribute("data-view")).toBe("after"));
    await waitFor(() => expect(cardIds(container)).not.toEqual(today));
    expect(screen.getByTestId("wr-after-note").textContent).toContain("Kubernetes for servers only");
    expect(cardIds(container)).toContain("ai-demo::deploy");
    expect(today).not.toContain("ai-demo::deploy");
    fireEvent.click(screen.getByTestId("wr-view-today"));
    await waitFor(() => expect(cardIds(container)).toEqual(today));
  });

  it("opens the detail panel when a card is clicked", async () => {
    const { container } = renderPage();
    expect(within(screen.getByTestId("wr-side")).getByText("Pick a box")).toBeTruthy();
    await waitFor(() => expect(container.querySelector('[data-testid="wr-card-mac::g-web-front-ends"]')).toBeTruthy());
    fireEvent.click(screen.getByTestId("wr-card-mac::g-web-front-ends"));
    await waitFor(() => expect(screen.getByTestId("wr-side-title").textContent).toBe("Web front ends"));
    const list = screen.getByTestId("wr-side-list");
    expect(within(list).getByText("ui")).toBeTruthy();
    expect(within(list).getByText("grafana")).toBeTruthy();
  });

  it("shows what changes in the panel on After and the new plan tags on a card", async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByTestId("wr-view-after"));
    await waitFor(() => expect(container.querySelector('[data-testid="wr-card-ai-demo::deploy"]')).toBeTruthy());
    expect(screen.getByTestId("wr-change-toDeploy")).toBeTruthy();
    fireEvent.click(screen.getByTestId("wr-card-ai-demo::deploy"));
    await waitFor(() => expect(screen.getByTestId("wr-side-title").textContent).toBe("To deploy on Kubernetes"));
    expect(within(screen.getByTestId("wr-side-list")).getAllByText(/to deploy, from This Mac/).length).toBeGreaterThan(0);
  });

  it("has a Reset layout button (the drag-and-reset behaviour is in WhereEverythingRunsPage.reset.test.jsx)", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Reset layout" })).toBeTruthy();
  });
});

describe("WhereEverythingRunsPage Ping UI Standard", () => {
  it("puts the banner first (role=note), then the title, and says nothing was checked", () => {
    const { container } = renderPage();
    const banner = screen.getByTestId("wr-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toMatch(/nothing here was checked/i);
    const page = container.querySelector(".pu-page.wr-page");
    expect(page).toBeTruthy();
    expect(page.firstElementChild.contains(banner)).toBe(true);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(banner.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has exactly one primary button (Reset layout) in the Today and After states", () => {
    const { container } = renderPage();
    const primaries = () => [...container.querySelectorAll("button.pu-btn--primary")].map((b) => b.textContent);
    expect(primaries()).toEqual(["Reset layout"]);
    fireEvent.click(screen.getByTestId("wr-view-after"));
    expect(primaries()).toEqual(["Reset layout"]);
  });

  it("names the two sections and keeps the arrangement toggle pressed-state in sync", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "Today or After" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Boxes and links" })).toBeTruthy();
    const today = screen.getByTestId("wr-view-today");
    const after = screen.getByTestId("wr-view-after");
    expect([today.getAttribute("aria-pressed"), after.getAttribute("aria-pressed")]).toEqual(["true", "false"]);
    fireEvent.click(after);
    expect([today.getAttribute("aria-pressed"), after.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
  });

  it("keeps the After note in a live region that is mounted before the note appears", () => {
    renderPage();
    const note = () => screen.queryByTestId("wr-after-note");
    expect(note()).toBeNull();
    const live = screen.getByTestId("wr-stamp").nextElementSibling;
    expect(live.getAttribute("role")).toBe("status");
    fireEvent.click(screen.getByTestId("wr-view-after"));
    expect(screen.getByTestId("wr-stamp").nextElementSibling).toBe(live);
    expect(live.contains(note())).toBe(true);
  });

  it("every card has a keyboard control with a stable name; picking opens the panel, announces once, and focus stays on it", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[data-testid="wr-pick-mac::g-web-front-ends"]')).toBeTruthy());
    const picks = [...container.querySelectorAll('[data-testid^="wr-pick-"]')];
    expect(picks.length).toBe(cardIds(container).length);
    expect(picks.every((b) => b.tagName === "BUTTON" && b.getAttribute("aria-label"))).toBe(true);
    const pick = screen.getByTestId("wr-pick-mac::g-web-front-ends");
    const name = pick.getAttribute("aria-label");
    expect(name).toMatch(/^Web front ends, \d+ workloads?$/);
    const status = screen.getByTestId("wr-selection-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
    pick.focus();
    fireEvent.click(pick);
    await waitFor(() => expect(screen.getByTestId("wr-side-title").textContent).toBe("Web front ends"));
    expect(status.textContent).toBe(`Showing ${name}.`);
    expect(screen.getByTestId("wr-selection-status")).toBe(status);
    expect(document.activeElement).toBe(screen.getByTestId("wr-pick-mac::g-web-front-ends"));
    expect(screen.getByTestId("wr-pick-mac::g-web-front-ends").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("wr-pick-mac::g-web-front-ends").getAttribute("aria-label")).toBe(name);
  });

  it("the detail panel is a named card, not a live region, and its chips are neutral recorded states", async () => {
    const { container } = renderPage();
    const side = screen.getByTestId("wr-side");
    expect(side.classList.contains("pu-card")).toBe(true);
    expect(side.getAttribute("aria-label")).toBe("Box details");
    expect(side.getAttribute("aria-live")).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-testid="wr-card-mac::g-web-front-ends"]')).toBeTruthy());
    fireEvent.click(screen.getByTestId("wr-card-mac::g-web-front-ends"));
    await waitFor(() => expect(screen.getByTestId("wr-side-title")).toBeTruthy());
    const chips = [...screen.getByTestId("wr-side-list").querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((c) => c.textContent.trim().length > 0)).toBe(true);
    expect(chips.some((c) => c.classList.contains("pu-chip--ok"))).toBe(false);
  });

  it("no chip on the map claims success: the card chips are neutral and carry a word", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(cardIds(container).length).toBeGreaterThan(5));
    const chips = [...container.querySelectorAll('[data-testid^="wr-card-"] .pu-chip')];
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) {
      expect(c.classList.contains("pu-chip--neutral")).toBe(true);
      expect(c.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows the What changes counts as a key-value list on After", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("wr-view-after"));
    const dl = await screen.findByTestId("wr-changes");
    expect(dl.tagName).toBe("DL");
    expect(dl.classList.contains("pu-kv")).toBe(true);
    expect(screen.getByTestId("wr-change-toDeploy").tagName).toBe("DD");
    expect(Number(screen.getByTestId("wr-change-toDeploy").textContent)).toBeGreaterThan(0);
    expect(dl.querySelectorAll("dt").length).toBe(dl.querySelectorAll("dd").length);
  });

  it("lets a mouse press on a box title reach the box so it can still be dragged (the pick button ignores pointer events)", () => {
    const css = pageCss;
    const rule = /\.wr-page \.wr-card__pick\s*\{([^}]*)\}/.exec(css);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/pointer-events:\s*none/);
  });

  it("announces when a pick is cleared by Reset layout, in the same status region, and not before anything was picked", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[data-testid="wr-pick-mac::g-web-front-ends"]')).toBeTruthy());
    const status = screen.getByTestId("wr-selection-status");
    fireEvent.click(screen.getByTestId("wr-reset"));
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByTestId("wr-pick-mac::g-web-front-ends"));
    await waitFor(() => expect(status.textContent).toMatch(/^Showing Web front ends/));
    const reset = screen.getByTestId("wr-reset");
    reset.focus();
    fireEvent.click(reset);
    await waitFor(() => expect(status.textContent).toBe("Selection cleared."));
    expect(screen.getByTestId("wr-selection-status")).toBe(status);
    expect(document.activeElement).toBe(reset);
    fireEvent.click(screen.getByTestId("wr-pick-mac::g-web-front-ends"));
    await waitFor(() => expect(status.textContent).toMatch(/^Showing Web front ends/));
  });

  it("in After, a box of workloads moved to the Mac does not claim they are running, and the panel labels their state as today's", async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByTestId("wr-view-after"));
    await waitFor(() => expect(container.querySelector('[data-testid^="wr-card-mac::moved"]')).toBeTruthy());
    const moved = container.querySelector('[data-testid^="wr-card-mac::moved"]');
    const chip = moved.querySelector(".pu-chip");
    expect(chip.textContent).toMatch(/^\d+ moved$/);
    expect(chip.textContent).not.toMatch(/running|up/);
    fireEvent.click(moved);
    await waitFor(() => expect(screen.getByTestId("wr-side-title").textContent).toMatch(/moved from/));
    const chips = [...screen.getByTestId("wr-side-list").querySelectorAll(".pu-chip")].map((c) => c.textContent);
    expect(chips.some((t) => /^today /.test(t))).toBe(true);
    expect(chips.every((t) => !/^(up|at 0|down|partly up) /.test(t))).toBe(true);
  });

  it("the map is a labelled region", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "Diagram of where everything runs" })).toBeTruthy();
  });
});

describe("whereRunsModel", () => {
  const views = buildViews(WHERE_RUNS_SAMPLE);

  it("After moves servers to Kubernetes and front ends to the Mac", () => {
    const ch = views.after.changes;
    expect(ch.toDeploy.map((x) => x.name)).toEqual(expect.arrayContaining(["pingfederate", "postgres", "redis"]));
    expect(ch.leavesLocal.map((x) => x.name)).toEqual(expect.arrayContaining(["demo-api-server", "oauth-mcp"]));
    expect(ch.toScaleUp.map((x) => x.name)).toEqual(["loki"]);
    expect(ch.alreadyLocal.map((x) => x.name)).toEqual(["ui", "grafana"]);
    expect(ch.removed.map((x) => x.name)).toEqual(expect.arrayContaining(["ui", "grafana", "cimd-lab", "legacy-console"]));
    expect(ch.movedToLocal.map((x) => x.name)).toEqual(expect.arrayContaining(["cimd-lab"]));
    const mac = views.after.regions.find((r) => r.envId === "mac");
    expect(mac.cards.flatMap((c) => c.workloads).every((x) => x.role === "frontend" || x.role === "lab")).toBe(true);
    const k8s = views.after.regions.filter((r) => r.kind === "k8s");
    expect(k8s.flatMap((r) => r.cards.flatMap((c) => c.workloads)).every((x) => x.role === "server")).toBe(true);
  });

  it("starts at a zoom of at least 0.9", () => {
    expect(MIN_ZOOM).toBeGreaterThanOrEqual(0.9);
    expect(chooseViewport({ x: 0, y: 0, zoom: 0.4 }).zoom).toBe(MIN_ZOOM);
    expect(chooseViewport({ x: 0, y: 0, zoom: 1.1 }).zoom).toBe(1.1);
  });

  it("draws links between cards on both views (a link inside one card is not drawn)", () => {
    expect(views.today.links.length).toBeGreaterThan(5);
    expect(views.after.links.length).toBeGreaterThan(0);
    for (const v of [views.today, views.after]) {
      const ids = new Set(v.regions.flatMap((r) => r.cards.map((c) => c.id)));
      expect(v.links.every((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to)).toBe(true);
    }
  });
});

describe("sample data is sanitized", () => {
  const text = JSON.stringify(WHERE_RUNS_SAMPLE);
  it("has no URLs, hostnames, IPs, uuids, emails or secrets", () => {
    expect(text).not.toMatch(/https?:|:\/\/|@|\bhosts?\b|"ports?"|context/i);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(text).not.toMatch(/secret|password|token(?![- ]exchange)|client[-_ ]?id|tenant/i);
  });
  it("is linked from Mission Control", () => {
    expect(JSON.stringify(MISSION_CONTROL_CATALOG)).toContain("/where-everything-runs");
  });
});
