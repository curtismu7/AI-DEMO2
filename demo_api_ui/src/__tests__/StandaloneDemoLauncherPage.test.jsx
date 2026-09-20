import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { PROVENANCE } from "../learning/provenance";
import StandaloneDemoLauncherPage from "../pages/StandaloneDemoLauncherPage";

const dependencies = [
  {
    id: "pingone",
    label: "PingOne",
    status: "available",
    provenance: PROVENANCE.LIVE_CLOUD,
    detail: "Cloud tenant verified",
  },
  {
    id: "authorize",
    label: "Authorize",
    status: "available",
    provenance: PROVENANCE.SIMULATED,
    detail: "Simulated policy engine selected",
  },
  {
    id: "davinci",
    label: "DaVinci",
    status: "configured",
    provenance: PROVENANCE.RECORDED,
    detail: "Configuration observed without a live cloud health signal",
  },
  {
    id: "privilege",
    label: "Privilege",
    status: "available",
    provenance: PROVENANCE.LIVE_LOCAL,
    detail: "Local relay initialized",
  },
  {
    id: "mcp",
    label: "MCP",
    status: "available",
    provenance: PROVENANCE.LIVE_LOCAL,
    detail: "Local gateway is healthy",
  },
];

const readiness = {
  environment: {
    provenance: PROVENANCE.LIVE_LOCAL,
    label: "Verified cloud services with local dependencies",
  },
  dependencies,
  lastCheckedAt: "2026-09-20T12:00:00.000Z",
  ready: false,
  warnings: [],
};

const SCENARIO_TITLES = [
  "Delegated access",
  "Authorize denial",
  "CIBA and approval",
  "Agent revocation",
  "MCP discovery",
  "Replay defense",
  "Prompt-injection defense",
  "Privilege MCP",
  "DaVinci orchestration",
  "Audit evidence",
];

function renderLauncher(props = {}) {
  return render(
    <MemoryRouter>
      <StandaloneDemoLauncherPage
        loadReadiness={() => Promise.resolve(readiness)}
        readinessPollIntervalMs={0}
        executeLesson={() => Promise.resolve(null)}
        resetExecution={() =>
          Promise.resolve({ cleared: true, tenantMutated: false })
        }
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("StandaloneDemoLauncherPage", () => {
  it("registers the public standalone demo launcher route", () => {
    const appSource = readFileSync(resolve("src/App.js"), "utf8");

    expect(appSource).toMatch(
      /<Route\s+path="\/academy\/demos"\s+element=\{\s*<StandaloneDemoLauncherRoute\b[\s\S]*?\/>\s*\}\s*\/>/,
    );
  });

  it("presents all ten short scenarios with a complete presenter runbook", async () => {
    renderLauncher();
    await screen.findByText("Needs attention");

    expect(screen.getAllByRole("article")).toHaveLength(10);
    for (const title of SCENARIO_TITLES) {
      const card = screen.getByRole("article", { name: title });
      expect(
        within(card).getByText(/^[3-7]-minute script$/),
      ).toBeInTheDocument();
      const presenterScript = within(card).getByRole("region", {
        name: "Presenter script",
      });
      expect(
        within(presenterScript).getAllByRole("listitem").length,
      ).toBeGreaterThanOrEqual(3);
      expect(
        within(card).getByRole("heading", { name: "Customer outcome" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("heading", { name: "Prerequisites" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("heading", { name: "Reset behavior" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("heading", { name: "Fallback behavior" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("link", { name: "Launch demo" }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("link", { name: "Explain this" }),
      ).toBeInTheDocument();
    }
  });

  it("filters scenarios by the category supplied by the lesson catalog", async () => {
    renderLauncher();
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "AI safety" }));

    expect(screen.getByRole("button", { name: "AI safety" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(
      screen.getByRole("article", { name: "Replay defense" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "Prompt-injection defense" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Delegated access" }),
    ).not.toBeInTheDocument();
  });

  it("derives direct launch and explanation links from the shared lesson", async () => {
    renderLauncher();
    await screen.findByText("Needs attention");

    const card = screen.getByRole("article", { name: "MCP discovery" });
    expect(
      within(card).getByRole("link", { name: "Launch demo" }),
    ).toHaveAttribute("href", "/pingone-mcp-inspector");
    expect(
      within(card).getByRole("link", { name: "Explain this" }),
    ).toHaveAttribute("href", "/mcp-discovery");
    expect(
      screen.getByRole("link", { name: "Return to guided journey" }),
    ).toHaveAttribute("href", "/academy/journey");
    expect(screen.getByRole("link", { name: "Learning hub" })).toHaveAttribute(
      "href",
      "/learning",
    );
  });

  it("shows live cloud, live local, recorded, and simulated labels without promotion", async () => {
    renderLauncher();
    await screen.findByText("Needs attention");

    const revocation = screen.getByRole("article", {
      name: "Agent revocation",
    });
    const discovery = screen.getByRole("article", { name: "MCP discovery" });
    const davinci = screen.getByRole("article", {
      name: "DaVinci orchestration",
    });
    const denial = screen.getByRole("article", { name: "Authorize denial" });

    expect(within(revocation).getByText("LIVE CLOUD")).toBeInTheDocument();
    expect(within(discovery).getByText("LIVE LOCAL")).toBeInTheDocument();
    expect(within(davinci).getByText("RECORDED")).toBeInTheDocument();
    expect(within(denial).getByText("SIMULATED")).toBeInTheDocument();
    expect(within(davinci).getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(within(davinci).queryByText("LIVE CLOUD")).not.toBeInTheDocument();
  });

  it("uses the catalog fallback when a prerequisite is unavailable", async () => {
    const unavailableReadiness = {
      ...readiness,
      dependencies: dependencies.map((item) =>
        item.id === "mcp"
          ? {
              ...item,
              status: "unavailable",
              provenance: PROVENANCE.RECORDED,
              detail: "MCP liveness is not verified",
            }
          : item,
      ),
    };
    renderLauncher({
      loadReadiness: () => Promise.resolve(unavailableReadiness),
    });
    await screen.findByText("Needs attention");

    const card = screen.getByRole("article", { name: "MCP discovery" });
    expect(within(card).getByText("UNAVAILABLE")).toBeInTheDocument();
    expect(within(card).getByText("SIMULATED")).toBeInTheDocument();
    expect(
      within(card).getByText(/Simulated MCP exchange.*not started/i),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", {
        name: "Check MCP discovery evidence",
      }),
    ).toBeDisabled();
  });

  it("captures observed evidence provenance and resets only launcher state", async () => {
    const executeLesson = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.RECORDED,
      evidence: [{ label: "Token events", count: 3 }],
      result: { kind: "observation", status: "observed", valuesRedacted: true },
      warnings: [],
    });
    const resetExecution = vi
      .fn()
      .mockResolvedValue({ cleared: true, tenantMutated: false });
    renderLauncher({ executeLesson, resetExecution });
    await screen.findByText("Needs attention");

    const card = screen.getByRole("article", { name: "Delegated access" });
    fireEvent.click(
      within(card).getByRole("button", {
        name: "Check Delegated access evidence",
      }),
    );
    expect(await within(card).findByText("RECORDED")).toBeInTheDocument();
    expect(executeLesson).toHaveBeenCalledWith("delegation", {
      mode: "standalone",
    });

    fireEvent.click(
      within(card).getByRole("button", { name: "Reset Delegated access" }),
    );
    expect(
      await within(card).findByText("Reset ready. Tenant state unchanged."),
    ).toBeInTheDocument();
    expect(resetExecution).toHaveBeenCalledWith("delegation");
  });
});
