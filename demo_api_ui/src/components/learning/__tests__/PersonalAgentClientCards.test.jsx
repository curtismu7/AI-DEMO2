import fs from 'node:fs';
import path from 'node:path';
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
    expect(screen.getAllByText("Hosted always-on agent").length).toBeGreaterThan(0);
    expect(screen.getByText("CIMD / DCR")).toBeInTheDocument();
    expect(screen.getByText("MCP connection")).toBeInTheDocument();
    expect(screen.getByText("Own memory")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Open LM Studio setup" })).toHaveClass(
      "personal-agent-client-cards__action--link",
    );
    expect(screen.getByRole("link", { name: "Open the Dot workbench" })).toHaveAttribute(
      "href",
      "/personal-agent/dot",
    );
    openSpy.mockRestore();
  });

  it('lays the client groups out side by side, not in one column', () => {
    // jsdom does no layout, so pin the rule that makes it: the groups container is a multi-column grid.
    const css = fs.readFileSync(path.resolve(__dirname, '../PersonalAgentClientCards.css'), 'utf8');
    const rule = css.match(/\.personal-agent-client-cards__groups\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(auto-fit/);
  });
});
