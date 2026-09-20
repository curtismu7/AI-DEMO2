import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import LessonShell from "../components/learning/LessonShell";

const lesson = getLesson("delegation");

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

  it("shows the live cloud provenance and dependency detail", () => {
    renderShell();

    expect(screen.getByText("LIVE CLOUD")).toBeInTheDocument();
    expect(screen.getByText(/PingOne cloud tenant/i)).toBeInTheDocument();
    expect(screen.getByText(/Recorded token-chain trace/i)).toBeInTheDocument();
  });

  it("runs a lesson and resets presenter state", async () => {
    const onRun = vi.fn();
    renderShell({ onRun });

    fireEvent.click(screen.getByRole("button", { name: /Run live lesson/i }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ lesson, mode: "guided" }));
    await waitFor(() => expect(screen.getByText("Run captured")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Reset demo/i }));
    await waitFor(() => expect(screen.getByText("Ready to run")).toBeInTheDocument());
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ reset: true, lesson }));
  });

  it("links standalone demos to the detailed explanation route", () => {
    renderShell({ mode: "standalone" });

    const explain = screen.getByRole("link", { name: "Explain what just happened" });
    expect(explain).toHaveAttribute("href", lesson.route);
  });

  it("renders provenance labels from the shared provenance contract", () => {
    render(
      <MemoryRouter>
        <LessonShell
          lesson={{ ...lesson, provenance: { primary: PROVENANCE.SIMULATED, fallback: [] } }}
          mode="guided"
        >
          <p>Content</p>
        </LessonShell>
      </MemoryRouter>,
    );

    expect(screen.getByText("SIMULATED")).toBeInTheDocument();
  });
});
