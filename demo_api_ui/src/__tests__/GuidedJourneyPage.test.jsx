import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SessionTokenProvider } from "../context/SessionTokenContext";
import { ThemeProvider } from "../context/ThemeContext";
import { PROVENANCE } from "../learning/provenance";
import GuidedJourneyPage from "../pages/GuidedJourneyPage";
import { GuidedJourneyRoute } from "../routes/AcademyRoutes";

vi.mock("../vertical/useVertical", () => ({
  useVertical: () => ({ pageManifest: null }),
}));

const readiness = {
  environment: {
    provenance: "LIVE_LOCAL",
    label: "Local or configured services",
  },
  dependencies: [],
  lastCheckedAt: "2026-09-20T12:00:00.000Z",
  ready: false,
  warnings: [],
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
}

function renderJourney(initialEntry = "/academy/journey", props = {}) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <GuidedJourneyPage
        loadReadiness={() => Promise.resolve(readiness)}
        readinessPollIntervalMs={0}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("GuidedJourneyPage", () => {
  it("registers the production journey path with GuidedJourneyRoute", () => {
    const appSource = readFileSync(resolve("src/App.js"), "utf8");

    expect(appSource).toMatch(
      /<Route\s+path="\/academy\/journey"\s+element=\{\s*<GuidedJourneyRoute\b[\s\S]*?\/>\s*\}\s*\/>/,
    );
  });

  it("advances through the ordered fourteen-step customer story", async () => {
    renderJourney();
    await screen.findByText("Needs attention");

    const stages = [
      "Discover agents",
      "PingOne login",
      "Delegation",
      "Multi-party delegation",
      "Personal Agent",
      "Digital Assistant",
      "MCP",
      "PingOne Authorize",
      "HITL and step-up",
      "A2A delegation",
      "Privilege MCP",
      "Attack defense",
      "Agent lifecycle",
      "Evidence summary",
    ];

    expect(
      screen.getByRole("heading", { level: 2, name: stages[0] }),
    ).toBeInTheDocument();
    for (const stage of stages.slice(1)) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
      expect(
        screen.getByRole("heading", { level: 2, name: stage }),
      ).toBeInTheDocument();
    }

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/academy/journey?step=evidence-timeline",
    );
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
  });

  it("marks skipped steps and supports previous and restart controls", async () => {
    renderJourney();
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "PingOne login" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discover agents, skipped" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "PingOne login" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "PingOne login, current, completed" }),
    ).toHaveAttribute("aria-current", "step");

    fireEvent.click(screen.getByRole("button", { name: "Restart journey" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Discover agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discover agents, current" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "PingOne login, not started" }),
    ).toBeInTheDocument();
  });

  it("opens a deep-linked step and navigates directly from the progress rail", async () => {
    renderJourney("/academy/journey?step=authorize");
    await screen.findByText("Needs attention");

    expect(
      screen.getByRole("heading", { level: 2, name: "PingOne Authorize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open standalone demo" }),
    ).toHaveAttribute("href", "/agent-gateway-inspector");

    fireEvent.click(
      screen.getByRole("button", { name: "Attack defense, not started" }),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Attack defense" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/academy/journey?step=threat-defense",
    );
  });

  it("shows the personal-agent client choices inside the guided journey", async () => {
    renderJourney("/academy/journey?step=consumer-agent");
    await screen.findByText("Needs attention");

    expect(screen.getByRole("region", { name: "Personal agent clients" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open LibreChat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open LM Studio setup" })).toHaveAttribute(
      "href",
      "/privilege-mcp-client?client=lm-studio",
    );
  });

  it("hides customer talking points on demand", async () => {
    renderJourney("/academy/journey?step=login");
    await screen.findByText("Needs attention");

    expect(
      screen.getByText(
        /PingOne authenticates the person while the BFF keeps browser tokens server-side/i,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide customer talking points" }),
    );
    expect(
      screen.queryByText(
        /PingOne authenticates the person while the BFF keeps browser tokens server-side/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("summarizes journey progress on the evidence step", async () => {
    renderJourney();
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    for (let index = 0; index < 12; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }

    expect(
      screen.getByRole("heading", { level: 2, name: "Evidence summary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("12 completed steps")).toBeInTheDocument();
    expect(screen.getByText("1 skipped step")).toBeInTheDocument();
    expect(screen.getByText("0 captured evidence checks")).toBeInTheDocument();
  });

  it("does not restore an in-flight result after the journey restarts", async () => {
    const pendingRun = deferred();
    renderJourney("/academy/journey?step=agent-landscape", {
      executeLesson: () => pendingRun.promise,
    });
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Check live evidence" }));
    expect(screen.getByText("Checking evidence")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart journey" }));

    await act(async () => {
      pendingRun.resolve({
        provenance: PROVENANCE.SIMULATED,
        evidence: ["Stale architecture trace"],
        result: { kind: "observation", status: "observed" },
        warnings: [],
      });
      await pendingRun.promise;
    });
    for (let index = 0; index < 13; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }

    expect(screen.getByText("0 captured evidence checks")).toBeInTheDocument();
    expect(
      screen.queryByText("Stale architecture trace"),
    ).not.toBeInTheDocument();
  });

  it("preserves non-cloud provenance in the journey evidence summary", async () => {
    const executeLesson = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.SIMULATED,
      evidence: ["Simulated architecture trace"],
      result: { kind: "observation", status: "observed" },
      warnings: [],
    });
    renderJourney("/academy/journey?step=agent-landscape", { executeLesson });
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Check live evidence" }));
    expect(await screen.findByText("Evidence captured")).toBeInTheDocument();
    for (let index = 0; index < 13; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }

    expect(screen.getByText("1 captured evidence check")).toBeInTheDocument();
    expect(screen.getByText("SIMULATED")).toBeInTheDocument();
    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
  });

  it("does not offer an unrelated evidence check on the final summary stage", async () => {
    const executeLesson = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.SIMULATED,
      evidence: ["Summary-stage architecture trace"],
      result: { kind: "observation", status: "observed" },
      warnings: [],
    });
    renderJourney("/academy/journey?step=evidence-timeline", { executeLesson });
    await screen.findByText("Needs attention");

    expect(
      screen.getByRole("button", { name: "Check live evidence" }),
    ).toBeDisabled();
    expect(screen.getByText("Ready to configure")).toBeInTheDocument();
    expect(screen.getByText("0 captured evidence checks")).toBeInTheDocument();
    expect(executeLesson).not.toHaveBeenCalled();
  });

  it("keeps readiness and live-run failures explicit and non-cloud", async () => {
    const executeLesson = vi
      .fn()
      .mockRejectedValue(new Error("dependency down"));
    renderJourney("/academy/journey?step=mcp", {
      loadReadiness: () => Promise.reject(new Error("readiness down")),
      executeLesson,
    });

    expect(
      await screen.findByText("Readiness unavailable"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run banking read tool" }));
    expect(await screen.findByText("Evidence check failed.")).toBeInTheDocument();
    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
  });

  it("matches the public journey route and renders its query deep link inside existing chrome", async () => {
    render(
      <ThemeProvider>
        <SessionTokenProvider>
          <MemoryRouter initialEntries={["/academy/journey?step=authorize"]}>
            <Routes>
              <Route
                path="/academy/journey"
                element={
                  <GuidedJourneyRoute
                    user={null}
                    logout={() => {}}
                    journeyProps={{
                      loadReadiness: () => Promise.resolve(readiness),
                      readinessPollIntervalMs: 0,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </SessionTokenProvider>
      </ThemeProvider>,
    );

    await screen.findByText("Needs attention");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Guided customer journey",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "PingOne Authorize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to dashboard" }),
    ).toBeInTheDocument();
  });
});
