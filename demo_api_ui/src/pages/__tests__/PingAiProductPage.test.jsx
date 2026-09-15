import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PingAiProductPage from "../PingAiProductPage";

describe("PingAiProductPage", () => {
  it.each([
    ["core", "Agent IAM Core"],
    ["gateway", "Agent Gateway"],
    ["authorize", "PingOne Authorize"],
    ["privilegeLlm", "PingOne Privilege for AI — LLM protection"],
    ["privilegeA2a", "PingOne Privilege for AI — A2A protection"],
    ["privilegeMcp", "PingOne Privilege for AI — MCP protection"],
  ])("renders the %s product story", (product, title) => {
    render(<MemoryRouter><PingAiProductPage product={product} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "AI product pages" })).toBeInTheDocument();
    expect(screen.getByText(/Boundary defined/)).toBeInTheDocument();
  });
});
