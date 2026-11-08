import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
    expect(screen.getByText(product === "protect" ? "Live form on this page" : "Explainer only")).toBeInTheDocument();
  });

  it.each(["core", "gateway", "authorize", "privilegeLlm", "privilegeA2a", "privilegeMcp", "protect"])(
    "%s opens with a role=note banner and every chip carries a word",
    (product) => {
      const { container } = render(<MemoryRouter><PingAiProductPage product={product} /></MemoryRouter>);
      expect(container.querySelector(".pu-page").firstElementChild).toHaveClass("pu-banner-wrap");
      const banner = screen.getByTestId("pai-banner");
      expect(banner).toHaveAttribute("role", "note");
      expect(banner).toHaveTextContent(product === "protect" ? /one live form/i : /product explainer/i);
      const chips = container.querySelectorAll(".pu-chip");
      expect(chips.length).toBeGreaterThan(0);
      chips.forEach((chip) => expect(chip.textContent.trim().length).toBeGreaterThan(0));
    },
  );

  it.each(["core", "gateway", "authorize", "privilegeLlm", "privilegeA2a", "privilegeMcp"])(
    "%s has exactly one primary button: the hero button that opens the first agent run",
    (product) => {
      const { container } = render(<MemoryRouter><PingAiProductPage product={product} /></MemoryRouter>);
      const primaries = container.querySelectorAll(".pu-btn--primary");
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toHaveTextContent(/^Start with /);
    },
  );

  it("the hero button navigates to the first agent run", () => {
    const Here = () => <p data-testid="here">{useLocation().pathname}</p>;
    render(
      <MemoryRouter initialEntries={["/ai-products/core"]}>
        <Routes>
          <Route path="/ai-products/core" element={<PingAiProductPage product="core" />} />
          <Route path="*" element={<Here />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start with Agent lifecycle" }));
    expect(screen.getByTestId("here")).toHaveTextContent("/agent-lifecycle");
  });

  it("each run card is one named link, so the whole card is a single keyboard stop", () => {
    const { container } = render(<MemoryRouter><PingAiProductPage product="gateway" /></MemoryRouter>);
    const cards = container.querySelectorAll(".pai-run");
    expect(cards).toHaveLength(3);
    cards.forEach((card) => {
      const links = within(card).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0].textContent.trim().length).toBeGreaterThan(0);
    });
  });

  it("marks the current product in the nav", () => {
    render(<MemoryRouter><PingAiProductPage product="gateway" /></MemoryRouter>);
    expect(within(screen.getByRole("navigation", { name: "AI product pages" })).getByRole("link", { current: "page" })).toHaveTextContent("Agent Gateway");
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
    const run = screen.getByRole("button", { name: /run pingone protect evaluation/i });
    expect(run).toBeInTheDocument();
    // Protect has no agent runs: the form's submit is the view's one primary, so the hero adds none.
    expect(document.querySelector(".pai-hero button")).toBeNull();
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
