import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PersonalAgentClientCards from "../PersonalAgentClientCards";

describe("PersonalAgentClientCards", () => {
  it("groups the browser and Mac personal-agent choices", () => {
    render(
      <MemoryRouter>
        <PersonalAgentClientCards />
      </MemoryRouter>,
    );

    expect(screen.getByRole("region", { name: "Personal agent clients" })).toBeInTheDocument();
    expect(screen.getAllByText("Browser personal agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mac personal agent").length).toBeGreaterThan(0);
    expect(screen.getByText("CIMD / DCR")).toBeInTheDocument();
    expect(screen.getByText("MCP connection")).toBeInTheDocument();
  });

  it("opens LibreChat and routes LM Studio to setup", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter>
        <PersonalAgentClientCards />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open LibreChat" }));
    expect(openSpy).toHaveBeenCalledWith("http://localhost:3080", "_blank", "noopener,noreferrer");
    expect(screen.getByRole("link", { name: "Open LM Studio setup" })).toHaveAttribute(
      "href",
      "/privilege-mcp-client?client=lm-studio",
    );
    openSpy.mockRestore();
  });
});
