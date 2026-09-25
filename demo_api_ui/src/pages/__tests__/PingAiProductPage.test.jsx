import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PingAiProductPage from "../PingAiProductPage";
import productPageStyles from "../PingAiProductPage.css?raw";

describe("PingAiProductPage", () => {
  it.each([
    ["core", "Agent IAM Core"],
    ["gateway", "Agent Gateway"],
    ["authorize", "PingOne Authorize"],
    ["privilegeLlm", "PingOne Privilege for AI — LLM protection"],
    ["privilegeA2a", "PingOne Privilege for AI — A2A protection"],
    ["privilegeMcp", "PingOne Privilege for AI — MCP protection"],
    ["protect", "PingOne Protect"],
  ])("renders the %s product story", (product, title) => {
    render(<MemoryRouter><PingAiProductPage product={product} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "AI product pages" })).toBeInTheDocument();
    expect(screen.getByText(/Boundary defined/)).toBeInTheDocument();
  });

  it("links the Privilege LLM story to a concrete prompt-injection run", () => {
    render(<MemoryRouter><PingAiProductPage product="privilegeLlm" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Prompt injection blocked/ })).toHaveAttribute(
      "href",
      "/llm-gateway?attack=prompt_injection",
    );
  });

  it("renders the standalone browser risk evaluation instead of authentication or agent dispatch", () => {
    render(<MemoryRouter><PingAiProductPage product="protect" /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /run pingone protect evaluation/i })).toBeInTheDocument();
    expect(screen.getAllByText(/displays the returned evaluation/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/requests PingOne MFA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Low continues to OIDC/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent dispatch/i)).not.toBeInTheDocument();
  });

  it("keeps inactive product navigation readable on the dark header", () => {
    expect(productPageStyles).toContain(
      ".pai-lesson-page .pai-product-nav__link:not(.pai-product-nav__link--active),",
    );
    expect(productPageStyles).toMatch(
      /\.pai-lesson-page \.pai-product-nav__link:not\(\.pai-product-nav__link--active\),[^}]*color:\s*var\(--th-text-invert\)\s*;[^}]*-webkit-text-fill-color:\s*var\(--th-text-invert\)\s*;/,
    );
  });
});
