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

  it("renders the response as color-coded JSON, not a plain text dump", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    const pane = await screen.findByTestId("lt-response");
    // A plain <pre>{JSON.stringify(...)}</pre> has no descendant elements at
    // all — these classes only exist if JsonHighlight actually rendered.
    expect(pane.querySelector(".jh-key")).toBeInTheDocument();
    expect(pane.querySelector(".jh-string")).toBeInTheDocument();
  });

  // The toggle mirrors the Chat console's Last Decision view. JSON stays the
  // default here — the raw body is this page's contract, pinned by the tests
  // above — and Form is the opt-in: every leaf as a path-labelled row.
  it("offers a Form view of the response, and JSON stays the default", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));
    await screen.findByTestId("lt-response");

    expect(screen.getByRole("button", { name: /^json$/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("lt-response-form")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^form$/i }));
    const dl = screen.getByTestId("lt-response-form");
    // A path-labelled leaf with its verbatim value — a rendering, not a summary.
    expect(dl).toHaveTextContent("choices[0].message.content");
    expect(dl).toHaveTextContent("Paris");
    expect(screen.queryByTestId("lt-response")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^json$/i }));
    expect(screen.getByTestId("lt-response")).toBeInTheDocument();
  });

  // A body that did not parse has no fields to lay out; a toggle would be a lie.
  it("hides the Form toggle when the response is not JSON", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        request: { url: "https://gw.test/llm/anthropic/v1/chat/completions", headers: {} },
        response: { status: 200, ok: true, raw: "plain text, not json" },
        latencyMs: 12,
      }),
    }));
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByTestId("lt-response")).toHaveTextContent("plain text, not json");
    expect(screen.queryByRole("button", { name: /^form$/i })).not.toBeInTheDocument();
  });

  // 429 is the headline proof-point this whole page exists to surface — a real
  // rate limit, enforced by Privilege or the provider behind it. It must stand
  // out visually, not read as one of three equally-weighted status colors.
  it("gives a 429 its own bold treatment, distinct from a plain success or failure", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        request: { url: "https://gw.test/llm/anthropic/v1/chat/completions", headers: {} },
        response: { status: 429, ok: false, json: { error: { message: "rate limited" } } },
        latencyMs: 146,
      }),
    }));
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    const pill = await screen.findByTestId("lt-status");
    expect(pill).toHaveTextContent("HTTP 429");
    expect(pill).toHaveClass("is-warn");
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

  it("offers /v1/models as a path, and hides the body editor when it is chosen", async () => {
    mockFetch(() => OK_RAW);
    render(<LlmTestPage />);
    await ready();

    const path = screen.getByLabelText(/^path$/i);
    const opts = Array.from(path.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("/llm/anthropic/v1/models");

    fireEvent.change(path, { target: { value: "/llm/anthropic/v1/models" } });

    expect(screen.getByText(/GET request/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/request body/i)).not.toBeInTheDocument();
  });

  it("sends /v1/models as a bodiless GET, not a POST with an empty body", async () => {
    let sentBody;
    global.fetch = vi.fn((url, opts) => {
      const u = String(url);
      if (u.endsWith("/llm/config")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) });
      }
      if (u.endsWith("/llm/raw")) {
        sentBody = JSON.parse(opts.body);
        return Promise.resolve(OK_RAW);
      }
      return new Promise(() => {});
    });
    render(<LlmTestPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^path$/i), { target: { value: "/llm/anthropic/v1/models" } });
    fireEvent.click(screen.getByRole("button", { name: /send request/i }));

    await screen.findByTestId("lt-status");
    expect(sentBody).toEqual({ provider: "anthropic", path: "/llm/anthropic/v1/models", method: "GET" });
  });

  it("offers /completions, /embeddings and /responses alongside chat/completions and models", async () => {
    mockFetch(() => new Promise(() => {}));
    render(<LlmTestPage />);
    await ready();

    const opts = Array.from(screen.getByLabelText(/^path$/i).querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(expect.arrayContaining([
      "/llm/anthropic/v1/chat/completions",
      "/llm/anthropic/v1/messages",
      "/llm/anthropic/v1/completions",
      "/llm/anthropic/v1/embeddings",
      "/llm/anthropic/v1/responses",
      "/llm/anthropic/v1/models",
    ]));
  });

  it("sends a prompt string, not a messages array, on the legacy /completions path", async () => {
    mockFetch(() => new Promise(() => {}));
    render(<LlmTestPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^path$/i), { target: { value: "/llm/anthropic/v1/completions" } });

    const body = JSON.parse(screen.getByLabelText(/request body/i).value);
    expect(body.prompt).toBe("What is the capital of Texas?");
    expect(body.messages).toBeUndefined();
  });

  it("sends input, not messages, on /embeddings", async () => {
    mockFetch(() => new Promise(() => {}));
    render(<LlmTestPage />);
    await ready();
    fireEvent.change(screen.getByLabelText(/^path$/i), { target: { value: "/llm/anthropic/v1/embeddings" } });

    const body = JSON.parse(screen.getByLabelText(/request body/i).value);
    expect(body.input).toBe("What is the capital of Texas?");
    expect(body.messages).toBeUndefined();
    expect(body.prompt).toBeUndefined();
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
    // Rendered as colored JSON now (an array), so the model id sits inside a
    // quoted-string span rather than being the element's whole exact text.
    expect(screen.getByText(/secret-model/)).toBeInTheDocument();
  });

  // An unauthenticated direct side must not read as "the gateway hid everything".
  it("says to check the key when the direct side returned nothing", async () => {
    await compareWith(CMP({ models: { direct: { status: 401, count: 0, ids: [] }, identical: false } }));
    expect(await screen.findByTestId("lt-compare-verdict")).toHaveTextContent(/check the key/i);
  });

  it("will not compare when neither side has a key, and does not call the server", async () => {
    mockFetch(() => OK_RAW, () => CMP());
    render(<LlmTestPage />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));

    expect(await screen.findByText(/No key for the direct side/i)).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([u]) => String(u).endsWith("/llm/compare"))).toHaveLength(0);
  });

  // With a server key the comparison is one click, and the field becomes an override.
  it("compares with no typing when the server holds the direct key", async () => {
    const withServerKey = {
      ...CONFIG,
      lanes: CONFIG.lanes.map((l) => (l.provider === "anthropic"
        ? { ...l, directKeyConfigured: true, directKeyEnv: "LLM_DIRECT_ANTHROPIC_KEY" }
        : l)),
    };
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.endsWith("/llm/config")) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(withServerKey) });
      if (u.endsWith("/llm/compare")) return Promise.resolve(CMP());
      return new Promise(() => {});
    });
    render(<LlmTestPage />);
    await ready();

    expect(screen.getByPlaceholderText(/using LLM_DIRECT_ANTHROPIC_KEY/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));

    expect(await screen.findByTestId("lt-compare-verdict")).toBeInTheDocument();
    // Nothing typed, so no key rides along in the request.
    const body = JSON.parse(global.fetch.mock.calls.find(([u]) => String(u).endsWith("/llm/compare"))[1].body);
    expect(body.directKey).toBeUndefined();
  });

  it("uses a password field so the key is not shoulder-readable", async () => {
    mockFetch(() => OK_RAW, () => CMP());
    render(<LlmTestPage />);
    await ready();
    expect(screen.getByLabelText(/provider api key/i)).toHaveAttribute("type", "password");
  });
});


// ── LM Studio: the local, ungoverned lane ───────────────────────────────────
// It earns its place by being the one call with nothing in front of it. The page
// must never imply the gateway is involved, and must not hide the reasoning-model
// trap where a small budget returns HTTP 200 with an empty string.

const LOCAL_CFG = {
  ...CONFIG,
  local: {
    provider: "lmstudio",
    title: "LM Studio (local)",
    baseUrl: "http://host.docker.internal:1234",
    route: "/v1/chat/completions",
    defaultMaxTokens: 512,
  },
};

function mockLocal({ models = ["qwen3.8-27b", "google/gemma-4-12b-qat"], modelsFail, raw } = {}) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/llm/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(LOCAL_CFG) });
    }
    if (u.endsWith("/llm/models/lmstudio")) {
      return modelsFail
        ? Promise.resolve({ ok: false, status: 502, text: async () => JSON.stringify({ error: "LM Studio unreachable at http://host.docker.internal:1234" }) })
        : Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ models }) });
    }
    if (u.endsWith("/llm/raw")) return Promise.resolve(raw || OK_RAW);
    return new Promise(() => {});
  });
}

async function pickLocal() {
  await ready();
  fireEvent.change(screen.getByLabelText(/^lane$/i), { target: { value: "lmstudio" } });
}

describe("LM Studio lane", () => {
  it("is offered under its own group, apart from the Privilege lanes", async () => {
    mockLocal();
    render(<LlmTestPage />);
    await ready();

    const lane = screen.getByLabelText(/^lane$/i);
    const groups = Array.from(lane.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["Through Privilege", "Local, no gateway"]);
  });

  it("offers the models LM Studio reports right now, not a fixed list", async () => {
    mockLocal({ models: ["qwen3.8-27b", "another-loaded-model"] });
    render(<LlmTestPage />);
    await pickLocal();

    const sel = await screen.findByLabelText(/^model$/i);
    expect(Array.from(sel.querySelectorAll("option")).map((o) => o.value))
      .toEqual(["qwen3.8-27b", "another-loaded-model"]);
  });

  // Measured: max_tokens 24 returned "" in 7.6s; 512 returned "Paris".
  it("defaults max_tokens high, because a small budget returns an empty 200", async () => {
    mockLocal();
    render(<LlmTestPage />);
    await pickLocal();

    await screen.findByLabelText(/^model$/i);
    expect(JSON.parse(screen.getByLabelText(/request body/i).value).max_tokens).toBe(512);
  });

  it("says the call is unmediated, and names the address", async () => {
    mockLocal();
    render(<LlmTestPage />);
    await pickLocal();

    expect(await screen.findByText(/no virtual key, no gateway/i)).toBeInTheDocument();
    expect(screen.getByText("http://host.docker.internal:1234")).toBeInTheDocument();
  });

  // Comparing "direct vs through Privilege" is meaningless when there is no gateway side.
  it("hides the direct-vs-gateway comparison for the local lane", async () => {
    mockLocal();
    render(<LlmTestPage />);
    expect(await screen.findByLabelText(/direct vs gateway/i)).toBeInTheDocument();

    await pickLocal();
    await screen.findByLabelText(/^model$/i);
    expect(screen.queryByLabelText(/direct vs gateway/i)).not.toBeInTheDocument();
  });

  it("can send without any Privilege key configured", async () => {
    mockLocal();
    render(<LlmTestPage />);
    await pickLocal();
    await screen.findByLabelText(/^model$/i);

    expect(screen.getByRole("button", { name: /send request/i })).not.toBeDisabled();
  });

  // An empty dropdown would read as "no models"; unreachable is a different problem.
  it("names the address when LM Studio cannot be reached", async () => {
    mockLocal({ modelsFail: true });
    render(<LlmTestPage />);
    await pickLocal();

    expect(await screen.findByText(/LM Studio unreachable at http:\/\/host\.docker\.internal:1234/))
      .toBeInTheDocument();
  });
});
