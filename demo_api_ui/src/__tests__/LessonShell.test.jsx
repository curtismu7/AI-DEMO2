import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AcademyLessonRoute } from "../routes/AcademyRoutes";
import { SessionTokenProvider } from "../context/SessionTokenContext";
import { ThemeProvider } from "../context/ThemeContext";
import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import LessonShell from "../components/learning/LessonShell";

vi.mock("../vertical/useVertical", () => ({
  useVertical: () => ({ pageManifest: null }),
}));

const lesson = getLesson("delegation");
const authRequirements = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../demo_api_server/config/auth-requirements.json"),
    "utf8",
  ),
);

function renderShell(props = {}) {
  return render(
    <MemoryRouter>
      <LessonShell lesson={lesson} mode="guided" {...props}>
        <input aria-label="lesson input" defaultValue="preserve me" />
        <p>Shared lesson content</p>
      </LessonShell>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}</output>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

function StatefulLessonContent() {
  const [value, setValue] = useState("");
  return (
    <label>
      Routed lesson note
      <input aria-label="routed lesson note" value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

function renderAcademyRoute(initialEntries, child) {
  return render(
    <ThemeProvider>
      <SessionTokenProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <LocationProbe />
          <Routes>
            <Route
              path="/academy/:lessonId/:mode"
              element={<AcademyLessonRoute loading={false} user={null} logout={() => {}}>{child}</AcademyLessonRoute>}
            />
            <Route
              path="/academy/:lessonId"
              element={<AcademyLessonRoute loading={false} user={null} logout={() => {}}>{child}</AcademyLessonRoute>}
            />
            <Route path="/learning" element={<div data-testid="learning-redirect">Learning hub</div>} />
          </Routes>
        </MemoryRouter>
      </SessionTokenProvider>
    </ThemeProvider>,
  );
}

describe("LessonShell", () => {
  it("switches between guided and standalone presentation without remounting lesson content", () => {
    renderShell();

    const input = screen.getByRole("textbox", { name: "lesson input" });
    fireEvent.change(input, { target: { value: "customer scenario" } });
    fireEvent.click(screen.getByRole("button", { name: "Demo mode" }));

    expect(screen.getByText("Demo mode")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "lesson input" })).toHaveValue("customer scenario");
    expect(screen.getByText("Shared lesson content")).toBeInTheDocument();
  });

  it("shows live cloud provenance only after a normalized cloud result", async () => {
    const onRun = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.LIVE_CLOUD,
      evidence: ["delegated-token"],
      result: { kind: "observation", status: "observed" },
    });
    renderShell({ onRun });
    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    await waitFor(() => expect(screen.getByText("LIVE CLOUD")).toBeInTheDocument());

    expect(screen.getByText(/Observed run result/i)).toBeInTheDocument();
  });

  it("runs a lesson and resets presenter state", async () => {
    const onRun = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.LIVE_CLOUD,
      evidence: ["delegated-token"],
      result: { kind: "observation", status: "observed" },
    });
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ lesson, mode: "guided" }));
    await waitFor(() => expect(screen.getByText("Run captured")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Reset demo/i }));
    await waitFor(() => expect(screen.getByText("Ready to run")).toBeInTheDocument());
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ reset: true, lesson }));
  });

  it("shows policy state and disables live run when no runner is connected", () => {
    renderShell();

    expect(screen.getByText("PREFERRED")).toBeInTheDocument();
    expect(screen.getByText(/No live execution is connected/i)).toBeInTheDocument();
    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run live lesson/i })).toBeDisabled();
    expect(screen.getByText("Ready to configure")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Reset demo/i }));
    expect(screen.getByText("Ready to configure")).toBeInTheDocument();
    expect(screen.queryByText("Ready to run")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run live lesson/i })).toBeDisabled();
  });

  it("derives observed provenance and evidence from a normalized non-cloud result", async () => {
    const onRun = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.SIMULATED,
      evidence: ["policy-deny"],
      result: { kind: "observation", status: "observed" },
    });
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    await waitFor(() => expect(screen.getByText("SIMULATED")).toBeInTheDocument());

    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
    expect(screen.getByText("policy-deny")).toBeInTheDocument();
    expect(screen.getByText("Run captured")).toBeInTheDocument();
  });

  it("does not report completion when the runner returns no normalized result", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    await waitFor(() => expect(screen.getByText(/No normalized run result/i)).toBeInTheDocument());

    expect(screen.queryByText("Run captured")).not.toBeInTheDocument();
  });

  it.each([
    {
      status: "no-evidence",
      warning: "No matching lesson evidence was observed.",
    },
    {
      status: "not-run",
      warning: "No safe lesson action is configured.",
    },
    {
      status: "unavailable",
      warning: "The observation endpoint is unavailable.",
    },
  ])("keeps a $status outcome non-captured and retryable", async ({ status, warning }) => {
    const onRun = vi.fn().mockResolvedValue({
      provenance: null,
      evidence: [],
      result: { kind: "observation", status },
      warnings: [warning],
    });
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    await waitFor(() => expect(screen.getByText(warning)).toBeInTheDocument());

    expect(screen.queryByText("Run captured")).not.toBeInTheDocument();
    expect(screen.queryByText("Observed run result", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
    expect(screen.getByText("0 observed events")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run live lesson/i })).toBeEnabled();
  });

  it("ignores a stale run completion after reset", async () => {
    let resolveRun;
    let resolveReset;
    const onRun = vi.fn(({ reset }) =>
      new Promise((resolve) => {
        if (reset) resolveReset = resolve;
        else resolveRun = resolve;
      }),
    );
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    await waitFor(() => expect(screen.getByText("Running")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Reset demo/i }));

    resolveRun({
      provenance: PROVENANCE.LIVE_CLOUD,
      evidence: ["stale"],
      result: { kind: "observation", status: "observed" },
    });
    resolveReset();
    await waitFor(() => expect(screen.getByText("Ready to run")).toBeInTheDocument());

    expect(screen.queryByText("Run captured")).not.toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("surfaces reset failure instead of claiming the shell is ready", async () => {
    const onRun = vi.fn(({ reset }) => (reset ? Promise.reject(new Error("reset failed")) : Promise.resolve()));
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Reset demo/i }));
    await waitFor(() => expect(screen.getByText(/Reset failed/i)).toBeInTheDocument());
    expect(screen.queryByText("Ready to run")).not.toBeInTheDocument();
  });

  it("reports mode changes so the route can keep the URL synchronized", () => {
    const onModeChange = vi.fn();
    renderShell({ onModeChange });

    fireEvent.click(screen.getByRole("button", { name: "Demo mode" }));
    expect(onModeChange).toHaveBeenCalledWith("standalone");
    expect(screen.getByRole("button", { name: "Demo mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("links standalone demos to the detailed explanation route", () => {
    renderShell({ mode: "standalone" });

    const explain = screen.getByRole("link", { name: "Explain what just happened" });
    expect(explain).toHaveAttribute("href", lesson.route);
  });

  it("renders an observed simulated provenance label from the shared contract", async () => {
    const onRun = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.SIMULATED,
      evidence: ["simulated-policy"],
      result: { kind: "observation", status: "observed" },
    });
    render(
      <MemoryRouter>
        <LessonShell
          lesson={lesson}
          mode="guided"
          onRun={onRun}
        >
          <p>Content</p>
        </LessonShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    await waitFor(() => expect(screen.getByText("SIMULATED")).toBeInTheDocument());
    expect(screen.queryByText("LIVE CLOUD")).not.toBeInTheDocument();
  });

  it("renders both public academy deep-link forms with one public chrome main", async () => {
    expect(authRequirements.routes["/academy/:lessonId"]).toBe("public");
    expect(authRequirements.routes["/academy/:lessonId/:mode"]).toBe("public");

    const { unmount } = renderAcademyRoute(["/academy/delegation"]);
    await waitFor(() => expect(document.querySelector("header.topnav")).toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation");
    expect(screen.getByRole("main")).toHaveClass("main-content");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    unmount();

    renderAcademyRoute(["/academy/delegation/standalone"]);
    expect(await screen.findByRole("button", { name: "Demo mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation/standalone");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("keeps the mode URL synchronized through toggles and browser back navigation", async () => {
    renderAcademyRoute(["/academy/delegation/guided"]);

    fireEvent.click(await screen.findByRole("button", { name: "Demo mode" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation/standalone"));
    expect(screen.getByRole("button", { name: "Demo mode" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation/guided"));
    expect(screen.getByRole("button", { name: "Guided Journey" })).toHaveAttribute("aria-pressed", "true");
  });

  it("redirects invalid lessons to the learning hub and invalid modes to guided", async () => {
    const { unmount } = renderAcademyRoute(["/academy/not-a-lesson"]);
    expect(await screen.findByTestId("learning-redirect")).toBeInTheDocument();
    unmount();

    renderAcademyRoute(["/academy/delegation/sideways"]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation/guided"));
    expect(screen.getByRole("button", { name: "Guided Journey" })).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves stateful routed lesson content through mode navigation and browser back", async () => {
    renderAcademyRoute(["/academy/delegation"], <StatefulLessonContent />);
    const input = await screen.findByRole("textbox", { name: "routed lesson note" });
    fireEvent.change(input, { target: { value: "preserve through route mode" } });

    fireEvent.click(screen.getByRole("button", { name: "Demo mode" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation/standalone"));
    expect(screen.getByRole("textbox", { name: "routed lesson note" })).toHaveValue("preserve through route mode");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/academy/delegation"));
    expect(screen.getByRole("textbox", { name: "routed lesson note" })).toHaveValue("preserve through route mode");
  });
});
