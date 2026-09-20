import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("advances through the ordered nine-step customer story", async () => {
    renderJourney();
    await screen.findByText("Needs attention");

    const stages = [
      "Business problem",
      "PingOne login",
      "Delegation",
      "MCP",
      "PingOne Authorize",
      "HITL and step-up",
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
      "/academy/journey?step=product-map",
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
      screen.getByRole("button", { name: "Business problem, skipped" }),
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
      screen.getByRole("heading", { level: 2, name: "Business problem" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Business problem, current" }),
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

  it("reveals customer talking points on demand", async () => {
    renderJourney("/academy/journey?step=login");
    await screen.findByText("Needs attention");

    expect(
      screen.queryByText(
        /PingOne authenticates the person while the BFF keeps browser tokens server-side/i,
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show customer talking points" }),
    );
    expect(
      screen.getByText(
        /PingOne authenticates the person while the BFF keeps browser tokens server-side/i,
      ),
    ).toBeInTheDocument();
  });

  it("summarizes journey progress on the evidence step", async () => {
    renderJourney();
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    for (let index = 0; index < 7; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }

    expect(
      screen.getByRole("heading", { level: 2, name: "Evidence summary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("7 completed steps")).toBeInTheDocument();
    expect(screen.getByText("1 skipped step")).toBeInTheDocument();
    expect(screen.getByText("0 captured lesson runs")).toBeInTheDocument();
  });

  it("does not restore an in-flight result after the journey restarts", async () => {
    const pendingRun = deferred();
    renderJourney("/academy/journey?step=ai-architecture", {
      executeLesson: () => pendingRun.promise,
    });
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Run live lesson" }));
    expect(screen.getByText("Running")).toBeInTheDocument();
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
    for (let index = 0; index < 8; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }

    expect(screen.getByText("0 captured lesson runs")).toBeInTheDocument();
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
    renderJourney("/academy/journey?step=ai-architecture", { executeLesson });
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Run live lesson" }));
    expect(await screen.findByText("Run captured")).toBeInTheDocument();
    for (let index = 0; index < 8; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    }

    expect(screen.getByText("1 captured lesson run")).toBeInTheDocument();
    expect(screen.getByText("SIMULATED")).toBeInTheDocument();
    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
  });

  it("excludes the final summary stage from the itemized evidence count", async () => {
    const executeLesson = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.SIMULATED,
      evidence: ["Summary-stage architecture trace"],
      result: { kind: "observation", status: "observed" },
      warnings: [],
    });
    renderJourney("/academy/journey?step=product-map", { executeLesson });
    await screen.findByText("Needs attention");

    fireEvent.click(screen.getByRole("button", { name: "Run live lesson" }));
    expect(await screen.findByText("Run captured")).toBeInTheDocument();

    expect(screen.getByText("0 captured lesson runs")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Run live lesson" }));
    expect(await screen.findByText("Live run failed.")).toBeInTheDocument();
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
