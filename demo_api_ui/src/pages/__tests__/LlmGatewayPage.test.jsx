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
});
