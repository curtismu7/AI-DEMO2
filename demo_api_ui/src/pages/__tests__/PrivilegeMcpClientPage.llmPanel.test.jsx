// Privilege LLM protection: the app never holds a provider API key — the
// gateway injects it — and a policy can deny the call before it reaches the
// provider. The denial is the demo, so it renders as an explained block with
// the provider, the route and the reason, never as a generic failure.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

function stateBody() {
  return JSON.stringify({
    config: { mcpUrl: "https://gw.test/opensearch22/mcp", clientId: "", scopes: "" },
    gatewayMode: "privilege",
    gatewayConfigs: {},
    oauth: { authenticated: true },
    mainAppAuthenticated: true,
    tools: [],
    presets: [],
    gatewaySession: { ready: true },
  });
}

function mockFetch(llmCall) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody() });
    }
    if (u.endsWith("/api/privilege-mcp/llm/call")) return Promise.resolve(llmCall());
    return new Promise(() => {});
  });
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

async function ask(text = "hello") {
  fireEvent.change(await screen.findByLabelText(/prompt/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

describe("Privilege LLM panel", () => {
  it("shows the reply, the gateway route and the latency", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          reply: "hello from claude",
          provider: "anthropic",
          route: "/llm/anthropic/v1/messages",
          latencyMs: 412,
        }),
    }));
    renderPage();
    await ask();

    expect(await screen.findByText(/hello from claude/)).toBeInTheDocument();
    expect(await screen.findByText("/llm/anthropic/v1/messages")).toBeInTheDocument();
    expect(await screen.findByText(/412\s*ms/i)).toBeInTheDocument();
  });

  // The load-bearing case: a denial is the security story, not an error.
  it("renders a policy denial with its reason and provider, not as a failure", async () => {
    mockFetch(() => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: "blocked by policy: no PII",
          code: "llm_policy_denied",
          reason: "blocked by policy: no PII",
          provider: "anthropic",
          route: "/llm/anthropic/v1/messages",
        }),
    }));
    renderPage();
    await ask("my SSN is 123");

    const denial = await screen.findByTestId("llm-denial");
    expect(denial).toHaveTextContent(/no PII/);
    expect(denial).toHaveTextContent(/anthropic/i);
    // Not rendered through the generic error channel.
    expect(screen.queryByTestId("llm-error")).not.toBeInTheDocument();
  });

  it("shows a real failure through the error channel instead", async () => {
    mockFetch(() => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "socket hang up" }),
    }));
    renderPage();
    await ask();

    expect(await screen.findByTestId("llm-error")).toHaveTextContent(/socket hang up/);
    expect(screen.queryByTestId("llm-denial")).not.toBeInTheDocument();
  });

  it("says which config is missing when the provider is not set up", async () => {
    mockFetch(() => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: "PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured" }),
    }));
    renderPage();
    await ask();

    expect(await screen.findByTestId("llm-error")).toHaveTextContent(/VIRTUAL_KEY_OPENAI/);
  });

  it("does not send an empty prompt", async () => {
    mockFetch(() => ({ ok: true, status: 200, text: async () => "{}" }));
    renderPage();

    await screen.findByLabelText(/prompt/i);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    const calls = global.fetch.mock.calls.filter(([u]) => String(u).endsWith("/llm/call"));
    expect(calls).toHaveLength(0);
  });

  // "Prove the policy" must send something without the operator typing it —
  // that is the whole point of the control on stage.
  it("prove the policy sends a prompt of its own", async () => {
    mockFetch(() => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: "blocked by policy: no PII",
          code: "llm_policy_denied",
          reason: "blocked by policy: no PII",
          provider: "anthropic",
        }),
    }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /prove the policy/i }));

    expect(await screen.findByTestId("llm-denial")).toHaveTextContent(/no PII/);
    const [, init] = global.fetch.mock.calls.find(([u]) => String(u).endsWith("/llm/call"));
    expect(JSON.parse(init.body).prompt.length).toBeGreaterThan(0);
  });
});

// ── Per-lane probe table ────────────────────────────────────────────────────
// Three lanes, each with an editable route and model and its own Test button.
// The value is attribution: a policy denial and a dead provider credential are
// both "it didn't answer", and the table has to tell them apart on sight.

const LANES_BODY = JSON.stringify({
  gatewayUrl: "https://gw.test",
  lanes: [
    { provider: "anthropic", route: "/llm/anthropic/v1/messages", model: "claude-haiku-4-5-20251001", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC" },
    { provider: "google", route: "/llm/google/v1/chat/completions", model: "gemini-2.0-flash", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE" },
    { provider: "openai", route: "/llm/openai/v1/chat/completions", model: "gpt-4o-mini", keyConfigured: false, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI" },
  ],
});

function mockFetchWithLanes(llmCall) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody() });
    }
    if (u.endsWith("/api/privilege-mcp/llm/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => LANES_BODY });
    }
    if (u.endsWith("/api/privilege-mcp/llm/call")) return Promise.resolve(llmCall());
    return new Promise(() => {});
  });
}

describe("Privilege LLM lane table", () => {
  it("prefills each lane from the server and flags a missing key", async () => {
    mockFetchWithLanes(() => new Promise(() => {}));
    renderPage();

    expect(await screen.findByLabelText("anthropic route")).toHaveValue("/llm/anthropic/v1/messages");
    expect(screen.getByLabelText("google model")).toHaveValue("gemini-2.0-flash");
    // The lane whose key is unset says so instead of failing mysteriously on Test.
    expect(screen.getByText(/PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not set/)).toBeInTheDocument();
  });

  it("sends the edited route and model, and reports a reply", async () => {
    mockFetchWithLanes(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ reply: "ping", route: "/llm/anthropic/v1/chat/completions", latencyMs: 120 }),
    }));
    renderPage();

    fireEvent.change(await screen.findByLabelText("anthropic route"), {
      target: { value: "/llm/anthropic/v1/chat/completions" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^test$/i })[0]);

    expect(await screen.findByTestId("lane-result-anthropic")).toHaveTextContent(/reply/);
    const call = global.fetch.mock.calls.find((c) => String(c[0]).endsWith("/llm/call"));
    expect(JSON.parse(call[1].body)).toMatchObject({
      provider: "anthropic",
      route: "/llm/anthropic/v1/chat/completions",
    });
  });

  // The distinction the table exists for.
  it("attributes a policy denial to Privilege, not to the provider", async () => {
    mockFetchWithLanes(() => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "blocked", code: "llm_policy_denied", reason: "no PII" }),
    }));
    renderPage();

    fireEvent.click((await screen.findAllByRole("button", { name: /^test$/i }))[0]);

    expect(await screen.findByTestId("lane-result-anthropic")).toHaveTextContent(/Privilege policy/);
  });

  it("attributes a 502 to the provider behind the virtual key", async () => {
    mockFetchWithLanes(() => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "401: API key is invalid." }),
    }));
    renderPage();

    fireEvent.click((await screen.findAllByRole("button", { name: /^test$/i }))[0]);

    const result = await screen.findByTestId("lane-result-anthropic");
    expect(result).toHaveTextContent(/provider/);
    expect(result).not.toHaveTextContent(/Privilege policy/);
  });
});

// ── LLM as a Path ───────────────────────────────────────────────────────────
// Picking an LLM path retargets the CHAT: the prompt goes to a model through a
// Privilege virtual key instead of into the MCP agent loop. It must not touch the
// MCP connection — switching destination for a prompt is not a reconnection.

function selectLlmPath(provider) {
  fireEvent.change(screen.getByLabelText(/connection path/i), {
    target: { value: `llm:${provider}` },
  });
}

describe("LLM path in the chat", () => {
  it("offers the three lanes as paths alongside the MCP ones", async () => {
    mockFetchWithLanes(() => new Promise(() => {}));
    renderPage();

    const path = await screen.findByLabelText(/connection path/i);
    const values = Array.from(path.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(["direct", "privilege", "facade", "llm:anthropic", "llm:google", "llm:openai"]),
    );
  });

  it("sends the chat prompt to the chosen lane, not to /chat", async () => {
    mockFetchWithLanes(() => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ reply: "Paris", route: "/llm/openai/v1/chat/completions", latencyMs: 300 }),
    }));
    renderPage();
    await screen.findByLabelText(/connection path/i);

    selectLlmPath("openai");
    fireEvent.change(screen.getByPlaceholderText(/ask the agent/i), {
      target: { value: "capital of France?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await screen.findByText(/Paris/);
    const urls = global.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/llm/call"))).toBe(true);
    // The MCP agent loop must not run for an LLM path.
    expect(urls.some((u) => u.endsWith("/api/privilege-mcp/chat"))).toBe(false);
  });

  it("speaks a policy denial in the transcript instead of swallowing it", async () => {
    mockFetchWithLanes(() => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({ error: "blocked", code: "llm_policy_denied", reason: "no PII", provider: "google" }),
    }));
    renderPage();
    await screen.findByLabelText(/connection path/i);

    selectLlmPath("google");
    fireEvent.change(screen.getByPlaceholderText(/ask the agent/i), {
      target: { value: "here is an SSN" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(await screen.findByText(/Privilege denied this call/)).toBeInTheDocument();
    expect(screen.getByText(/no PII/)).toBeInTheDocument();
  });
});
