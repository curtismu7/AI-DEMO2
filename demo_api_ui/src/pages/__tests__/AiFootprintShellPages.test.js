// demo_api_ui/src/pages/__tests__/AiFootprintShellPages.test.js
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FootprintMockGalleryPage from "../FootprintMockGalleryPage";
import FootprintLiveShellPage from "../FootprintLiveShellPage";

jest.mock("../../hooks/useAgentSurfaceHost", () => ({
  useAgentSurfaceHost: () => jest.fn(),
}));

describe("AI footprint mock gallery", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders all four costume categories with selectable variants", () => {
    render(
      <MemoryRouter>
        <FootprintMockGalleryPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("footprint-mock-gallery")).toBeInTheDocument();
    expect(screen.getByText(/Platform-Native/)).toBeInTheDocument();
    expect(screen.getByText(/End-Point Native/)).toBeInTheDocument();
    expect(screen.getByText(/SaaS-Embedded/)).toBeInTheDocument();
    expect(screen.getByText(/Coding/)).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-vscode-classic-dark")).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-chatgpt-desktop-dark")).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-saas-zendesk")).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-coding-claude-code")).toBeInTheDocument();
  });

  it("persists a variant selection", () => {
    render(
      <MemoryRouter>
        <FootprintMockGalleryPage />
      </MemoryRouter>,
    );
    const card = screen.getByTestId("afm-card-vscode-light");
    fireEvent.click(card.querySelector("button.primary"));
    expect(JSON.parse(localStorage.getItem("ai-footprint-mock-selection-v1")).vscode).toBe(
      "light",
    );
  });
});

describe("AI footprint live shell", () => {
  it("renders selected VS Code chrome with agent host", () => {
    localStorage.setItem(
      "ai-footprint-mock-selection-v1",
      JSON.stringify({ vscode: "copilot-studio" }),
    );
    render(
      <MemoryRouter>
        <FootprintLiveShellPage category="vscode" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("footprint-live-vscode")).toBeInTheDocument();
    expect(screen.getByText(/Simulated shell/)).toBeInTheDocument();
    expect(screen.getByText("Copilot Chat")).toBeInTheDocument();
  });
});
