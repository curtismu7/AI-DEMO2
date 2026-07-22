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
    expect(screen.getByText(/Claude Code \/ IDE/)).toBeInTheDocument();
    expect(screen.getByText(/Platform-Native/)).toBeInTheDocument();
    expect(screen.getByText(/End-Point Native/)).toBeInTheDocument();
    expect(screen.getByText(/SaaS-Embedded/)).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-coding-claude-code")).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-vscode-classic-dark")).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-chatgpt-desktop-dark")).toBeInTheDocument();
    expect(screen.getByTestId("afm-card-saas-zendesk")).toBeInTheDocument();
  });

  it("persists a variant selection", () => {
    render(
      <MemoryRouter>
        <FootprintMockGalleryPage />
      </MemoryRouter>,
    );
    // Default locked pick is light — select a different vscode variant.
    const card = screen.getByTestId("afm-card-vscode-classic-dark");
    fireEvent.click(card.querySelector("button.primary"));
    expect(JSON.parse(localStorage.getItem("ai-footprint-mock-selection-v1")).vscode).toBe(
      "classic-dark",
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

describe("AI footprint locked picks page", () => {
  it("renders the four locked costumes with a picker", async () => {
    const { default: FootprintPicksPage } = await import("../FootprintPicksPage");
    render(
      <MemoryRouter>
        <FootprintPicksPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("footprint-picks-page")).toBeInTheDocument();
    expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Light workbench").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Desktop light").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vendor embed").length).toBeGreaterThan(0);
  });
});
