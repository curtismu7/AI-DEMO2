import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import ArchitectureTokenFlowPage from "../ArchitectureTokenFlowPage";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn().mockResolvedValue({ data: { events: [] } }) } }));

const HERE = dirname(fileURLToPath(import.meta.url));

describe("Token Flow page", () => {
  it("draws the steps as a Ping-style React Flow figure with a movie reel, and a reel click opens that step's token card and detail", () => {
    const { container } = render(
      <MemoryRouter>
        <ArchitectureTokenFlowPage user={null} />
      </MemoryRouter>,
    );
    expect(container.querySelector("img.arch-diagram-img")).toBeNull();
    expect(container.querySelector(".sfx")).toBeNull();
    expect(container.querySelector(".sfd--ping")).not.toBeNull();
    const cards = screen.getAllByText("OAuth 2.0 PKCE login");
    fireEvent.click(cards[0]);
    expect(screen.getAllByText("Authorization Code Request").length).toBeGreaterThan(0);
    // the reel's detail panel: request form, then the standards behind the hop
    expect(screen.getByTestId("token-flow-diagram-reel-detail").textContent).toContain("code_challenge_method=S256");
    expect(screen.getByTestId("token-flow-diagram-reel-refs").textContent).toContain("RFC 7636");
  });

  it("carries no leftover of the replaced PNG overlay (imageSrc, regions config, keyword scan)", () => {
    const src = readFileSync(join(HERE, "..", "ArchitectureTokenFlowPage.js"), "utf8");
    expect(src).not.toMatch(/token-flow\.png/);
    expect(src).not.toMatch(/diagram-token-flow-regions/);
    expect(src).not.toMatch(/scanKeywords/);
    // The regions config itself is gone from the repo.
    expect(() => {
      readFileSync(join(HERE, "..", "..", "config", "diagram-token-flow-regions.js"));
    }).toThrow();
  });
});
