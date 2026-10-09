import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LearningHub from "../LearningHub";

vi.mock("../../context/ThemeContext", () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../LearningHubAgent", () => ({ default: () => null }));
vi.mock("../TokenChainTraceRail", () => ({ default: () => null }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe("LearningHub Jev lesson", () => {
  it("lists the Jev decision-model lesson and opens /jev-learning", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /jev: decision model/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /jev: decision model/i }));
    expect(screen.getByTestId("location")).toHaveTextContent("/jev-learning");
  });

  it("finds the lesson through Learning Hub search", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /search learning topics/i }), {
      target: { value: "bake-off" },
    });
    expect(screen.getByRole("button", { name: /jev: decision model/i })).toBeInTheDocument();
  });

  it("shows the lesson's demo step number and links to the use-cases launcher", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
      </MemoryRouter>,
    );

    // The number comes from the canonical demoStepNumbers module (not hardcoded
    // in the component), so derive the expectation rather than pinning it —
    // renumbering the script must not break this test.
    const card = screen.getByRole("button", { name: /jev: decision model/i });
    const chip = within(card).getByRole("link", { name: /demo step \d+ · \/use-cases/i });
    expect(chip).toHaveAttribute("href", "/use-cases#UC-LEARN15");
    expect(chip.textContent).not.toContain("53");
  });
});
