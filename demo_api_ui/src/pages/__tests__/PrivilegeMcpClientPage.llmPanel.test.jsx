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
