// The LLM Gateway console exists to separate two failures that look identical in a
// log: Privilege refused the prompt (it never reached a model), and the provider
// credential behind the virtual key was rejected (it did). Everything below pins
// that distinction, plus the honesty rule — no number is presented as a Privilege
// cap unless it is one.
import { fireEvent, render, screen } from "@testing-library/react";
import LlmGatewayPage from "../LlmGatewayPage";

const CONFIG = {
  gatewayUrl: "https://mcpgw.ai-demo.ping-devops.com",
  lanes: [
    { provider: "anthropic", route: "/llm/anthropic/v1/messages", model: "claude-haiku-4-5-20251001", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC" },
    { provider: "google", route: "/llm/google/v1/chat/completions", model: "gemini-2.0-flash", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE" },
    { provider: "openai", route: "/llm/openai/v1/chat/completions", model: "gpt-4o-mini", keyConfigured: false, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI" },
  ],
};

function mockFetch(call) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/llm/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) });
    }
    if (u.endsWith("/llm/call")) return Promise.resolve(call());
    return new Promise(() => {});
  });
}

async function ask(text = "hello") {
  fireEvent.change(await screen.findByLabelText(/^prompt$/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

describe("LLM Gateway console", () => {
  it("lists each lane with its route and model, and names a missing key", async () => {
    mockFetch(() => new Promise(() => {}));
    render(<LlmGatewayPage />);

    expect(await screen.findByText("/llm/anthropic/v1/messages")).toBeInTheDocument();
    expect(screen.getByText("gemini-2.0-flash")).toBeInTheDocument();
    // A lane with no key says so up front instead of failing cryptically on Send.
    expect(screen.getByText(/PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI is not set/)).toBeInTheDocument();
  });

  it("attributes a denial to Privilege and says the model was never reached", async () => {
    mockFetch(() => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        error: "blocked", code: "llm_policy_denied", reason: "no PII",
        provider: "anthropic", route: "/llm/anthropic/v1/messages",
        latencyMs: 60, reachedProvider: false,
      }),
    }));
    render(<LlmGatewayPage />);
    await ask("customer SSN 123-45-6789");

    const dec = await screen.findByTestId("lgw-decision");
    expect(dec).toHaveTextContent(/Denied by policy/);
    expect(dec).toHaveTextContent(/Privilege/);
    expect(dec).toHaveTextContent(/no/);
    expect(screen.getByText(/nothing was sent to the model and nothing was billed/i)).toBeInTheDocument();
  });

  it("attributes a provider refusal to the provider, and says it WAS reached", async () => {
    mockFetch(() => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({
        error: "Privilege LLM proxy (anthropic) 401: API key is invalid.",
        provider: "anthropic", route: "/llm/anthropic/v1/messages",
        latencyMs: 285, reachedProvider: true,
      }),
    }));
    render(<LlmGatewayPage />);
    await ask("hello");

    const dec = await screen.findByTestId("lgw-decision");
    expect(dec).toHaveTextContent(/Provider refused/);
    // The denial-only reassurance must NOT appear here — this call did reach out.
    expect(screen.queryByText(/nothing was billed/i)).not.toBeInTheDocument();
  });

  // The honesty rule. These figures come from the provider, not from Privilege.
  it("labels the rate figures as the provider's, never as the key's caps", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        reply: "Paris.", provider: "anthropic", route: "/llm/anthropic/v1/messages",
        latencyMs: 300, reachedProvider: true,
        providerLimits: { requestsLimit: 10000, requestsRemaining: 9999, tokensLimit: 200000, tokensRemaining: 199997, resetRequests: "8.64s" },
      }),
    }));
    render(<LlmGatewayPage />);
    await ask("capital of France?");

    expect(await screen.findByText("Paris.")).toBeInTheDocument();
    expect(screen.getByText(/Provider limits/i)).toBeInTheDocument();
    expect(screen.getByText("9,999 / 10,000")).toBeInTheDocument();
  });

  // "Refused by" under a verdict of "Answered" is a contradiction the live page
  // showed on its first successful call.
  it("shows no 'Refused by' row when the call succeeded", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        reply: "Paris.", provider: "openai", route: "/llm/openai/v1/chat/completions",
        latencyMs: 1600, reachedProvider: true,
      }),
    }));
    render(<LlmGatewayPage />);
    await ask("capital of France?");

    const dec = await screen.findByTestId("lgw-decision");
    expect(dec).toHaveTextContent(/Answered/);
    expect(dec).not.toHaveTextContent(/Refused by/);
  });

  // Spend has no source anywhere, so the page must not imply one.
  it("shows no spend meter, and says why", async () => {
    mockFetch(() => new Promise(() => {}));
    render(<LlmGatewayPage />);
    await screen.findByText("/llm/anthropic/v1/messages");

    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByText(/no per-key usage today/i)).toBeInTheDocument();
  });

  describe("resizable columns", () => {
    // The Last Decision column previously defaulted to a fixed 15rem
    // (~240px); its dt/dd rows wrapped hard at that width.
    it("defaults the Last Decision column wider than the old fixed 15rem, with two resize-handle tracks", () => {
      mockFetch(() => new Promise(() => {}));
      const { container } = render(<LlmGatewayPage />);

      const grid = container.querySelector(".lgw-body");
      // "minmax(0, 1fr)" has an internal space, so a plain split(" ") over-counts —
      // pull out just the trailing px value, which is the decision column.
      const decisionWidth = parseInt(grid.style.gridTemplateColumns.match(/(\d+)px$/)[1], 10);
      expect(decisionWidth).toBeGreaterThan(240);
      expect(container.querySelectorAll(".lgw-resize-handle")).toHaveLength(2);
    });

    it("defaults to its own max — already at the drag ceiling, so growing further does nothing", () => {
      mockFetch(() => new Promise(() => {}));
      const { container } = render(<LlmGatewayPage />);
      const [, decisionHandle] = container.querySelectorAll(".lgw-resize-handle");
      const grid = container.querySelector(".lgw-body");
      const readDecisionWidth = () => parseInt(grid.style.gridTemplateColumns.match(/(\d+)px$/)[1], 10);
      expect(readDecisionWidth()).toBe(560);

      // invert:true — dragging LEFT would grow the right-hand pane, but it
      // is already clamped at max, so this must be a no-op, not 560+60.
      fireEvent.mouseDown(decisionHandle, { clientX: 800 });
      fireEvent.mouseMove(document, { clientX: 740 });
      fireEvent.mouseUp(document);

      expect(readDecisionWidth()).toBe(560);
    });

    it("dragging the right handle right shrinks the Last Decision column back down", () => {
      mockFetch(() => new Promise(() => {}));
      const { container } = render(<LlmGatewayPage />);
      const [, decisionHandle] = container.querySelectorAll(".lgw-resize-handle");
      const grid = container.querySelector(".lgw-body");
      const readDecisionWidth = () => parseInt(grid.style.gridTemplateColumns.match(/(\d+)px$/)[1], 10);
      const before = readDecisionWidth();

      // invert:true — dragging RIGHT (away from the middle column) shrinks it.
      fireEvent.mouseDown(decisionHandle, { clientX: 800 });
      fireEvent.mouseMove(document, { clientX: 860 });
      fireEvent.mouseUp(document);

      expect(readDecisionWidth()).toBe(before - 60);
    });

    it("dragging the left handle resizes the Lanes column", () => {
      mockFetch(() => new Promise(() => {}));
      const { container } = render(<LlmGatewayPage />);
      const [railHandle] = container.querySelectorAll(".lgw-resize-handle");
      const grid = container.querySelector(".lgw-body");
      const before = parseInt(grid.style.gridTemplateColumns.split(" ")[0], 10);

      fireEvent.mouseDown(railHandle, { clientX: 272 });
      fireEvent.mouseMove(document, { clientX: 320 });
      fireEvent.mouseUp(document);

      const after = parseInt(grid.style.gridTemplateColumns.split(" ")[0], 10);
      expect(after).toBe(before + 48);
    });
  });

  describe("reset", () => {
    it("is disabled with an empty conversation", async () => {
      mockFetch(() => new Promise(() => {}));
      render(<LlmGatewayPage />);
      await screen.findByText("/llm/anthropic/v1/messages");

      expect(screen.getByRole("button", { name: /^reset$/i })).toBeDisabled();
    });

    it("clears the turns, the last decision and the prompt, so a long session or a fired attack does not accumulate forever", async () => {
      mockFetch(() => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          reply: "Paris.", provider: "anthropic", route: "/llm/anthropic/v1/messages",
          latencyMs: 300, reachedProvider: true,
        }),
      }));
      render(<LlmGatewayPage />);
      await ask("capital of France?");
      await screen.findByText("Paris.");
      await screen.findByTestId("lgw-decision");

      const resetBtn = screen.getByRole("button", { name: /^reset$/i });
      expect(resetBtn).not.toBeDisabled();
      fireEvent.click(resetBtn);

      expect(screen.queryByText("Paris.")).not.toBeInTheDocument();
      expect(screen.queryByText("capital of France?")).not.toBeInTheDocument();
      expect(screen.queryByTestId("lgw-decision")).not.toBeInTheDocument();
      // Back to the empty-conversation prompt, and the button is disabled again.
      expect(await screen.findByText(/Ask something through/i)).toBeInTheDocument();
      expect(resetBtn).toBeDisabled();
    });
  });

  describe("decision view toggle", () => {
    async function sendAndGetDecision() {
      mockFetch(() => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          reply: "Paris.", provider: "anthropic", route: "/llm/anthropic/v1/messages",
          latencyMs: 300, reachedProvider: true,
        }),
      }));
      render(<LlmGatewayPage />);
      await ask("capital of France?");
      await screen.findByTestId("lgw-decision");
    }

    it("has no toggle before a decision exists", async () => {
      mockFetch(() => new Promise(() => {}));
      render(<LlmGatewayPage />);
      await screen.findByText("/llm/anthropic/v1/messages");

      expect(screen.queryByRole("button", { name: /^json$/i })).not.toBeInTheDocument();
    });

    it("defaults to the form view, and JSON shows the same decision data raw", async () => {
      await sendAndGetDecision();

      expect(screen.getByRole("button", { name: /^form$/i })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByTestId("lgw-decision-json")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^json$/i }));

      expect(screen.queryByTestId("lgw-decision")).not.toBeInTheDocument();
      const json = screen.getByTestId("lgw-decision-json");
      expect(json).toHaveTextContent(/"verdict"/);
      expect(json).toHaveTextContent(/"provider"/);
      expect(json).toHaveTextContent(/anthropic/);
    });

    it("switches back to the form view", async () => {
      await sendAndGetDecision();
      fireEvent.click(screen.getByRole("button", { name: /^json$/i }));
      await screen.findByTestId("lgw-decision-json");

      fireEvent.click(screen.getByRole("button", { name: /^form$/i }));

      expect(screen.queryByTestId("lgw-decision-json")).not.toBeInTheDocument();
      expect(await screen.findByTestId("lgw-decision")).toBeInTheDocument();
    });
  });
});
