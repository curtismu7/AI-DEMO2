// /llm-gateway and /llm-test used to be two separate pages with two nav
// entries to the same subject. This pins that they are now one page,
// switchable by tab, with each URL still opening the tab a bookmark expects.
import { fireEvent, render, screen } from "@testing-library/react";
import LlmGatewayCombinedPage from "../LlmGatewayCombinedPage";

function mockFetch() {
  global.fetch = vi.fn(() => new Promise(() => {}));
}

describe("LLM Gateway combined page", () => {
  it("defaultTab='chat' opens the chat console, matching a bookmarked /llm-gateway", () => {
    mockFetch();
    render(<LlmGatewayCombinedPage defaultTab="chat" />);

    expect(screen.getByRole("tab", { name: /chat console/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /raw request/i })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText(/^prompt$/i)).toBeInTheDocument();
  });

  it("defaultTab='raw' opens the raw tester, matching a bookmarked /llm-test", () => {
    mockFetch();
    render(<LlmGatewayCombinedPage defaultTab="raw" />);

    expect(screen.getByRole("tab", { name: /raw request/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/^lane$/i)).toBeInTheDocument();
  });

  it("switches tabs on click, unmounting the other view", async () => {
    mockFetch();
    render(<LlmGatewayCombinedPage defaultTab="chat" />);
    expect(screen.getByLabelText(/^prompt$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /raw request/i }));

    expect(await screen.findByLabelText(/^lane$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^prompt$/i)).not.toBeInTheDocument();
  });

  describe("text size control", () => {
    beforeEach(() => {
      try { localStorage.clear(); } catch { /* jsdom localStorage always available in practice */ }
    });

    it("starts at 100% and grows on A+, shrinks on A−", () => {
      mockFetch();
      render(<LlmGatewayCombinedPage defaultTab="chat" />);

      expect(screen.getByText("100%")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /increase text size/i }));
      expect(screen.getByText("115%")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /decrease text size/i }));
      fireEvent.click(screen.getByRole("button", { name: /decrease text size/i }));
      expect(screen.getByText("85%")).toBeInTheDocument();
    });

    it("actually changes the font-size custom properties on the page wrapper, not just the label", () => {
      mockFetch();
      const { container } = render(<LlmGatewayCombinedPage defaultTab="chat" />);
      const wrapper = container.querySelector(".lgwc");
      const before = wrapper.style.getPropertyValue("--font-size-base");

      fireEvent.click(screen.getByRole("button", { name: /increase text size/i }));

      const after = wrapper.style.getPropertyValue("--font-size-base");
      expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    });

    it("stays within its bounds — A− disables at the floor, A+ disables at the ceiling", () => {
      mockFetch();
      render(<LlmGatewayCombinedPage defaultTab="chat" />);
      const smaller = screen.getByRole("button", { name: /decrease text size/i });
      const bigger = screen.getByRole("button", { name: /increase text size/i });

      for (let i = 0; i < 5; i += 1) fireEvent.click(smaller);
      expect(smaller).toBeDisabled();

      for (let i = 0; i < 10; i += 1) fireEvent.click(bigger);
      expect(bigger).toBeDisabled();
    });
  });
});
