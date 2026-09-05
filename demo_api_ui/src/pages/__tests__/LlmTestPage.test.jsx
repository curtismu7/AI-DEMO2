// The test page's value is that it interprets nothing: it shows the status and the
// body the gateway returned. If it ever starts summarising, it stops being useful
// as the tiebreaker when /llm-gateway's verdict looks wrong.
import { fireEvent, render, screen } from "@testing-library/react";
import LlmTestPage from "../LlmTestPage";

const CONFIG = {
  gatewayUrl: "https://mcpgw.ai-demo.ping-devops.com",
  lanes: [
    { provider: "anthropic", route: "/llm/anthropic/v1/messages", model: "claude-haiku-4-5-20251001", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC" },
    { provider: "openai", route: "/llm/openai/v1/chat/completions", model: "gpt-4o-mini", keyConfigured: false, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI" },
  ],
};

function mockFetch(raw, compare) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/llm/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) });
    }
    if (u.endsWith("/llm/compare")) return Promise.resolve(compare ? compare() : new Promise(() => {}));
    if (u.endsWith("/llm/raw")) return Promise.resolve(raw());
    return new Promise(() => {});
  });
}

const CMP = (over = {}) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    provider: "anthropic",
    models: {
      direct: { status: 200, count: 11, ids: [] },
      gateway: { status: 200, count: 11, ids: [] },
      onlyDirect: [], onlyGateway: [], identical: true,
      ...over.models,
    },
    completion: {
      direct: { status: 200, latencyMs: 500, json: { ok: 1 } },
      gateway: { status: 200, latencyMs: 900, json: { ok: 1 } },
    },
  }),
});

const OK_RAW = {
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    request: {
      url: "https://mcpgw.ai-demo.ping-devops.com/llm/anthropic/v1/chat/completions",
      method: "POST",
      headers: { Authorization: "Bearer sk-orion-••••••••8ca3" },
      body: { model: "claude-haiku-4-5-20251001" },
    },
    response: { status: 200, ok: true, json: { choices: [{ message: { content: "Paris" } }] } },
    latencyMs: 872,
  }),
};


// The form renders before /llm/config resolves, so the body is empty for a tick.
// Waiting on the prefilled model is what proves the lane actually loaded — clicking
// Send earlier posts nothing and looks exactly like a broken page.
async function ready() {
  await screen.findByDisplayValue(/claude-haiku-4-5-20251001/);
}

describe("LLM Gateway Test page", () => {
  it("defaults to the OpenAI-compatible path, which is the shape the SDK snippet uses", async () => {
    mockFetch(() => new Promise(() => {}));
    render(<LlmTestPage />);

    const path = await screen.findByLabelText(/^path$/i);
    expect(path).toHaveValue("/llm/anthropic/v1/chat/completions");
    // Anthropic's native route is offered too, because our own service calls it.
    const opts = Array.from(path.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("/llm/anthropic/v1/messages");
  });

  it("shows the status, the timing and the untouched response body", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByTestId("lt-status")).toHaveTextContent("HTTP 200");
    expect(screen.getByText(/872 ms/)).toBeInTheDocument();
    // The raw JSON, not a summary of it.
    expect(screen.getByTestId("lt-response")).toHaveTextContent(/"content": "Paris"/);
  });

  // A 4xx from the gateway is a result to read, not a page failure to swallow.
  it("renders a gateway 4xx body rather than an error banner", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        request: { url: "https://gw.test/llm/anthropic/v1/chat/completions", headers: {} },
        response: {
          status: 403, ok: false,
          json: { error: { message: "model x not allowed for this key" } },
        },
        latencyMs: 41,
      }),
    }));
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByTestId("lt-status")).toHaveTextContent("HTTP 403");
    expect(screen.getByTestId("lt-response")).toHaveTextContent(/not allowed for this key/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses to send invalid JSON instead of posting it", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/request body/i), { target: { value: "{ nope" } });
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByText(/Body is not valid JSON/)).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([u]) => String(u).endsWith("/llm/raw"))).toHaveLength(0);
  });

  // The key is injected server-side; the page must never be able to show it.
  it("shows a masked key and a snippet that cannot be pasted as-is", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));
    await screen.findByTestId("lt-status");

    expect(screen.getByText(/Bearer sk-orion-••••••••8ca3/)).toBeInTheDocument();
    expect(screen.getByText(/base_url="https:\/\/mcpgw\.ai-demo\.ping-devops\.com\/llm\/anthropic\/v1"/)).toBeInTheDocument();
    expect(screen.getByText(/api_key="sk-orion-…"/)).toBeInTheDocument();
  });

  it("disables send for a lane with no key, and names the variable", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^lane$/i), { target: { value: "openai" } });

    expect(await screen.findByText(/PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI is not set/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send request/i })).toBeDisabled();
  });
});


describe("direct vs gateway comparison", () => {
  async function compareWith(res) {
    mockFetch(() => OK_RAW, () => res);
    render(<LlmTestPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/provider api key/i), { target: { value: "operator-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));
  }

  it("reads identical lists as constraining calling, not seeing", async () => {
    await compareWith(CMP());
    expect(await screen.findByTestId("lt-compare-verdict"))
      .toHaveTextContent(/constrains what the key may CALL, not what it can SEE/i);
  });

  it("names how many models each side withheld when the lists differ", async () => {
    await compareWith(CMP({ models: { identical: false, onlyDirect: ["secret-model"], onlyGateway: [] } }));
    expect(await screen.findByTestId("lt-compare-verdict")).toHaveTextContent(/1 only direct/);
    expect(screen.getByText("secret-model")).toBeInTheDocument();
  });

  // An unauthenticated direct side must not read as "the gateway hid everything".
  it("says to check the key when the direct side returned nothing", async () => {
    await compareWith(CMP({ models: { direct: { status: 401, count: 0, ids: [] }, identical: false } }));
    expect(await screen.findByTestId("lt-compare-verdict")).toHaveTextContent(/check the key/i);
  });

  it("will not compare without a key, and does not call the server", async () => {
    mockFetch(() => OK_RAW, () => CMP());
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));

    expect(await screen.findByText(/Paste a provider API key/i)).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([u]) => String(u).endsWith("/llm/compare"))).toHaveLength(0);
  });

  it("uses a password field so the key is not shoulder-readable", async () => {
    mockFetch(() => OK_RAW, () => CMP());
    render(<LlmTestPage />);
    await ready();
    expect(screen.getByLabelText(/provider api key/i)).toHaveAttribute("type", "password");
  });
});
