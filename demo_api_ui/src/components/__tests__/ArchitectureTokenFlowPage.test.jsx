import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ArchitectureTokenFlowPage from "../ArchitectureTokenFlowPage";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn().mockResolvedValue({ data: { events: [] } }) } }));

describe("Token Flow page", () => {
  it("draws the steps as a React Flow sequence with a movie reel, and a reel click opens that step's token card", () => {
    const { container } = render(
      <MemoryRouter>
        <ArchitectureTokenFlowPage user={null} />
      </MemoryRouter>,
    );
    expect(container.querySelector("img.arch-diagram-img")).toBeNull();
    expect(container.querySelector(".sfx")).not.toBeNull();
    const cards = screen.getAllByText("OAuth 2.0 PKCE login");
    fireEvent.click(cards[0]);
    expect(screen.getAllByText("Authorization Code Request").length).toBeGreaterThan(0);
  });
});
