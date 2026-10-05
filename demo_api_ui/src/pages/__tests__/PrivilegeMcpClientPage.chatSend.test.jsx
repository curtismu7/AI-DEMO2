// Characterization of the Cursor page's sendChat output (LLM reply / denial /
// error, and the /chat reply). Pins what is rendered today so the message shapes
// can move to a shared module without changing a byte.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

const json = (status, body) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body) });

/** llmCall / chat: [status, body] for that route. */
function mockFetch({ llmCall, chat } = {}) {
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return json(200, {
        config: { mcpUrl: "https://mcpgw.example.com/agent-gateway/mcp", clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode: "privilege",
        gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
        oauth: { authenticated: true, scope: "openid profile email" },
        mainAppAuthenticated: true,
        user: { email: "cmuir+demo-user@pingone.com" },
        tools: [],
        presets: [],
      });
    }
    if (u.endsWith("/api/privilege-mcp/llm/config")) return json(200, { gatewayUrl: "https://llm.example" });
    if (u.endsWith("/api/privilege-mcp/config") && opts?.method === "POST") return json(200, {});
    if (u.endsWith("/api/privilege-mcp/chat") && opts?.method === "POST") return json(...chat);
    if (u.endsWith("/api/privilege-mcp/llm/call") && opts?.method === "POST") return json(...llmCall);
    return json(200, {});
  });
}

const callsTo = (suffix) => global.fetch.mock.calls.filter(([u]) => String(u).endsWith(suffix));

async function send(text, { llm } = {}) {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
  if (llm) {
    const sel = await screen.findByLabelText("Connection path");
    fireEvent.change(sel, { target: { value: `llm:${llm}` } });
  }
  const box = await screen.findByPlaceholderText("Ask the agent... (Cmd+Enter to send)");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByLabelText("Send message"));
}

const assistant = () => document.querySelector(".cur-msg--assistant");
const body = () => assistant().querySelector(".cur-msg-body").textContent;
// steps are rendered as JSON in the message's meta <pre>
const meta = () => assistant().querySelector(".cur-msg-meta").textContent;

beforeEach(() => localStorage.clear());

describe("PrivilegeMcpClientPage sendChat — LLM path", () => {
  test("success shows the reply and the provider · route · latency step", async () => {
    mockFetch({ llmCall: [200, { reply: "hi from claude", route: "/v1/x", latencyMs: 12 }] });
    await send("hello", { llm: "anthropic" });
    await waitFor(() => expect(assistant()).toBeTruthy());
    expect(body()).toBe("hi from claude");
    expect(meta()).toContain("anthropic · /v1/x · 12 ms");
    expect(callsTo("/api/privilege-mcp/chat")).toHaveLength(0);
    expect(callsTo("/api/privilege-mcp/config")).toHaveLength(0);
  });

  test("policy denial is spoken in the transcript", async () => {
    mockFetch({
      llmCall: [403, { error: "denied", code: "llm_policy_denied", reason: "blocked by policy", provider: "anthropic", route: "/v1/x" }],
    });
    await send("hello", { llm: "anthropic" });
    await waitFor(() => expect(assistant()).toBeTruthy());
    expect(body()).toBe("⚠️ Privilege denied this call. blocked by policy");
    expect(meta()).toContain("anthropic · /v1/x · denied by policy");
  });

  test("any other error reads ❌ <message> with a call failed step", async () => {
    mockFetch({ llmCall: [502, { error: "bad gateway" }] });
    await send("hello", { llm: "anthropic" });
    await waitFor(() => expect(assistant()).toBeTruthy());
    expect(body()).toBe("❌ bad gateway");
    expect(meta()).toContain("anthropic · call failed");
  });
});

describe("PrivilegeMcpClientPage sendChat — /chat path", () => {
  test("reply shows data.reply and posts only the prompt", async () => {
    mockFetch({
      chat: [200, {
        reply: "Found 2 tools",
        tools: [{ name: "a" }, { name: "b" }],
        steps: ["mcp_initialized"],
        decision: { tool: "a", outcome: "ALLOWED" },
        execution: { ok: true },
      }],
    });
    await send("hello");
    // Discovered tools make the page jump to the Tools tab (once), unmounting
    // the transcript; wait for that, then come back to Agent Chat.
    await waitFor(() => expect(screen.getByRole("tab", { name: /Tools/ })).toHaveClass("cur-tab--active"), { timeout: 5000 });
    fireEvent.click(screen.getByRole("tab", { name: "Agent Chat" }));
    await waitFor(() => expect(assistant()).toBeTruthy(), { timeout: 5000 });
    expect(body()).toBe("Found 2 tools");
    const [, opts] = callsTo("/api/privilege-mcp/chat")[0];
    expect(JSON.parse(opts.body)).toEqual({ prompt: "hello" });
    expect(JSON.parse(meta())).toEqual({
      available_tools: ["a", "b"],
      suggested_tools: [],
      policy: null,
      decision: { tool: "a", outcome: "ALLOWED" },
      execution: { ok: true },
      steps: ["mcp_initialized"],
    });
  });

  test("empty reply falls back to Done.", async () => {
    mockFetch({ chat: [200, {}] });
    await send("hello");
    await waitFor(() => expect(assistant()).toBeTruthy());
    expect(body()).toBe("Done.");
  });

  test("failure reads Error: <message>", async () => {
    mockFetch({ chat: [500, { error: "boom" }] });
    await send("hello");
    await waitFor(() => expect(assistant()).toBeTruthy());
    expect(body()).toBe("Error: boom");
  });
});
