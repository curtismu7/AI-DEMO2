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
});
