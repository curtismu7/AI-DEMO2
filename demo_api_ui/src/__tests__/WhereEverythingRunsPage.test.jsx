// WhereEverythingRunsPage.test.jsx - /where-everything-runs draws the bundled sample as a movable ReactFlow map, flips between
// Today and After, opens a detail panel on a card click, and Reset puts the boxes back. The sample carries no hostnames,
// URLs, IPs, ids or secrets (the repo is public).
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
