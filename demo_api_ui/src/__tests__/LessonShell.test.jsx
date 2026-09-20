import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import LessonShell from "../components/learning/LessonShell";

const lesson = getLesson("delegation");
const appSource = fs.readFileSync(path.resolve(__dirname, "../App.js"), "utf8");
const authRequirements = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../demo_api_server/config/auth-requirements.json"), "utf8"),
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
      result: { kind: "redacted" },
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
      result: { kind: "redacted" },
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
  });

  it("derives observed provenance and evidence from a normalized non-cloud result", async () => {
    const onRun = vi.fn().mockResolvedValue({
      provenance: PROVENANCE.SIMULATED,
      evidence: ["policy-deny"],
      result: { kind: "redacted" },
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

    resolveRun({ provenance: PROVENANCE.LIVE_CLOUD, evidence: ["stale"], result: {} });
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
      result: { kind: "redacted" },
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

  it("registers public academy routes and their public chrome host", () => {
    expect(authRequirements.routes["/academy/:lessonId"]).toBe("public");
    expect(authRequirements.routes["/academy/:lessonId/:mode"]).toBe("public");
    expect(appSource).toMatch(/path="\/academy\/:lessonId\/:mode"[\s\S]*?AcademyLessonRoute/);
    expect(appSource).toMatch(/path="\/academy\/:lessonId"[\s\S]*?AcademyLessonRoute/);
    expect(appSource).toMatch(/function AcademyLessonRoute[\s\S]*?<TopNav user=\{user\}/);
    expect(appSource).toMatch(/function AcademyLessonRoute[\s\S]*?<main className="main-content">/);
  });

  it("deliberately normalizes invalid academy modes instead of silently selecting guided", () => {
    expect(appSource).toContain("normalizeAcademyMode");
    expect(appSource).toMatch(/normalizeAcademyMode\(routeMode\)[\s\S]*?Navigate to=\{`\/academy\/\$\{lessonId\}\/guided`\}/);
  });
});
