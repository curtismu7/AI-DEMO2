import { render, screen, fireEvent } from "@testing-library/react";
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

describe("LearningHub Agent Gateway lesson", () => {
  it("lists and opens the live Agent Gateway Authorization story", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /agent gateway authorization/i })).toBeInTheDocument();
    expect(screen.getByText(/delegated identity, runtime policy, mcp enforcement, and audit evidence/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /agent gateway authorization/i }));
    expect(screen.getByTestId("location")).toHaveTextContent("/agent-gateway-authorization");
  });

  it("finds the story through Learning Hub search", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /search learning topics/i }), {
      target: { value: "delegated identity" },
    });
    expect(screen.getByRole("button", { name: /agent gateway authorization/i })).toBeInTheDocument();
  });
});
