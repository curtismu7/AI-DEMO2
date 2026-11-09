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

  it("links the Privilege LLM story to a prompt-injection attempt without promising a verdict", () => {
    render(<MemoryRouter><PingAiProductPage product="privilegeLlm" /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /Try a prompt-injection attack/ });
    expect(link).toHaveAttribute("href", "/llm-gateway?attack=prompt_injection");
    expect(screen.queryByText(/prompt injection blocked/i)).not.toBeInTheDocument();
    expect(link.closest(".pai-run")).toHaveTextContent(/outcome is not decided in advance/i);
  });

  it.each(["core", "gateway", "authorize", "privilegeLlm", "privilegeA2a", "privilegeMcp"])(
    "%s banner does not claim every destination labels what it runs live and what it simulates",
    (product) => {
      render(<MemoryRouter><PingAiProductPage product={product} /></MemoryRouter>);
      const text = screen.getByTestId("pai-banner").textContent;
      expect(text).not.toMatch(/each of those says/i);
      expect(text).toMatch(/not every one of them labels/i);
      expect(text).toMatch(/Start with button and the cards below open other demo pages/i);
    },
  );

  it.each(["core", "gateway", "authorize", "privilegeLlm", "privilegeA2a", "privilegeMcp"])(
    "%s run cards each say what the destination is, and none reads as a real verdict",
    (product) => {
      const { container } = render(<MemoryRouter><PingAiProductPage product={product} /></MemoryRouter>);
      const cards = container.querySelectorAll(".pai-run");
      expect(cards.length).toBeGreaterThan(0);
      const kinds = [/live calls/, /mixes live and simulated/, /simulated option/, /sample data/, /nothing is called/, /Opens drawings; admins also get live controls/];
      cards.forEach((card) => {
        expect(card.querySelector(".pai-run__label").textContent).toMatch(new RegExp(kinds.map((k) => k.source).join("|")));
        const title = card.querySelector("h3").textContent;
        // "Gateway ..." is reserved for pages that call the real gateway (the live inspector); never for a mix, a sample or an explainer.
        if (/^Gateway\b/.test(title)) expect(card.querySelector(".pai-run__label").textContent).toMatch(/live calls|simulated option/);
        expect(title).not.toMatch(/\b(blocked|denied)\b/i);
        expect(card.textContent).not.toMatch(/Open agent run/);
      });
    },
  );

  it("words the shared workbench and the Authorize console honestly", () => {
    const { container, unmount } = render(<MemoryRouter><PingAiProductPage product="gateway" /></MemoryRouter>);
    const workbench = [...container.querySelectorAll(".pai-run")].find((c) => c.querySelector("a").getAttribute("href") === "/use-cases/live");
    expect(workbench.querySelector(".pai-run__label")).toHaveTextContent(/mixes live and simulated/);
    expect(workbench).toHaveTextContent(/Run sim cards are labelled simulations/);
    unmount();
    render(<MemoryRouter><PingAiProductPage product="authorize" /></MemoryRouter>);
    const consoleCard = screen.getByRole("link", { name: "Policy console" }).closest(".pai-run");
    expect(consoleCard).toHaveTextContent(/starts in Mock mode/);
    expect(consoleCard).not.toHaveTextContent(/evaluate live/i);
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

  it("the Agent-to-agent architecture card does not say nothing is called: its default tab calls the admin API", () => {
    const { container } = render(<MemoryRouter><PingAiProductPage product="privilegeA2a" /></MemoryRouter>);
    const card = [...container.querySelectorAll(".pai-run")].find((c) => c.querySelector("h3").textContent === "Agent-to-agent architecture");
    expect(card).toBeTruthy();
    expect(card.querySelector(".pai-run__label").textContent).toBe("Opens drawings; admins also get live controls");
    expect(card.textContent).not.toMatch(/nothing is called/);
    expect(card.textContent).toMatch(/admin API/);
  });
});
