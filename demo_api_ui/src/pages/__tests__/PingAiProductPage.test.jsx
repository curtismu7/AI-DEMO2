import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import apiClient from "../../services/apiClient";
import PingAiProductPage from "../PingAiProductPage";
import productPageStyles from "../PingAiProductPage.css?raw";

vi.mock("../../services/apiClient", () => ({ default: { post: vi.fn(), patch: vi.fn() } }));
vi.mock("../../vertical/useVertical", () => ({ useVertical: () => ({ activeId: "banking" }) }));

function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="current-route">{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
}

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

  it("launches the PingOne Protect demo chip from its product page", async () => {
    apiClient.patch.mockResolvedValue({ data: {} });
    apiClient.post.mockImplementation((path) => {
      if (path === "/api/use-cases/demo/run") {
        return Promise.resolve({ data: { useCaseId: "protect-agent-dispatch-risk", triggerText: "show my balance", type: "chip" } });
      }
      return Promise.resolve({ data: {} });
    });

    render(<MemoryRouter initialEntries={["/ai-products/protect"]}>
      <PingAiProductPage product="protect" />
      <CurrentRoute />
    </MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /run pingone protect demo/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/use-cases/demo/run", {
      useCaseId: "protect-agent-dispatch-risk",
      vertical: "banking",
    }));
    await waitFor(() => {
      const route = JSON.parse(screen.getByTestId("current-route").textContent);
      expect(route.pathname).toBe("/dashboard");
      expect(route.state.useCaseId).toBe("protect-agent-dispatch-risk");
      expect(route.state.triggerText).toBe("show my balance");
    });
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
