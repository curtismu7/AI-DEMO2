import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { usePrivilegeShellSession } from "../usePrivilegeShellSession";
import apiClient from "../../../services/apiClient";

vi.mock("../../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const wrapper = ({ children }) => (
  <MemoryRouter initialEntries={["/demo/coding-agent"]}>{children}</MemoryRouter>
);

async function ready() {
  apiClient.get.mockResolvedValue({
    data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "list_safes" }] },
  });
  const hook = renderHook(() => usePrivilegeShellSession(), { wrapper });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
  return hook;
}

describe("usePrivilegeShellSession.send", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores a blank prompt", async () => {
    const { result } = await ready();
    await act(() => result.current.send("   "));
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("posts the prompt and records user + assistant messages", async () => {
    const { result } = await ready();
    apiClient.post.mockResolvedValue({
      data: { reply: "Found 1 tool", steps: ["mcp_initialized"], decision: { tool: "list_safes" }, execution: { ok: true } },
    });
    await act(() => result.current.send("list safes"));
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/chat", { prompt: "list safes" });
    expect(result.current.messages).toMatchObject([
      { role: "user", content: "list safes" },
      { role: "assistant", content: "Found 1 tool", steps: ["mcp_initialized"], decision: { tool: "list_safes" }, execution: { ok: true } },
    ]);
    expect(result.current.thinking).toBe(false);
  });

  it("tolerates a reply with no steps, decision or execution", async () => {
    const { result } = await ready();
    apiClient.post.mockResolvedValue({ data: {} });
    await act(() => result.current.send("hi"));
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", content: "Done.", steps: [], decision: null, execution: null });
  });

  it("shows a 400 as an assistant error line and keeps the phase", async () => {
    const { result } = await ready();
    apiClient.post.mockRejectedValue({ response: { status: 400, data: { error: "Set MCP URL first." } } });
    await act(() => result.current.send("hi"));
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", content: "Error: Set MCP URL first." });
    expect(result.current.phase).toBe("ready");
  });

  it("returns to signed-out on a 401", async () => {
    const { result } = await ready();
    apiClient.post.mockRejectedValue({ response: { status: 401, data: { error: "Not authenticated." } } });
    await act(() => result.current.send("hi"));
    expect(result.current.phase).toBe("signed-out");
    expect(result.current.messages[1]).toMatchObject({ role: "system", content: "Sign in is required to access the gateway." });
  });

  it("routes a chat authUrl through /auth/start so sign-in returns to the skin", async () => {
    const { result } = await ready();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      apiClient.post
        .mockResolvedValueOnce({ data: { reply: "Please complete OAuth login first.", authUrl: "https://auth.example/a", steps: ["oauth_required"] } })
        .mockResolvedValueOnce({ data: { authUrl: "https://auth.example/start" } });
      await act(() => result.current.send("hi"));
      expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/auth/start", { returnTo: "/demo/coding-agent" });
      expect(assign).toHaveBeenCalledWith("https://auth.example/start");
      expect(result.current.messages[1]).toMatchObject({ role: "system", content: "Opening sign-in…" });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});

const PRIV_A = "https://gw.example/privilege-gateway/banking/mcp";
const PRIV_B = "https://gw.example/privilege-gateway/other/mcp";

async function readyRouted() {
  apiClient.get.mockImplementation((url) =>
    url.endsWith("/llm/config")
      ? Promise.resolve({ data: { gatewayUrl: "https://llm.example" } })
      : Promise.resolve({
          data: {
            oauth: { authenticated: true, scope: "openid" },
            tools: [{ name: "list_safes" }],
            gatewayMode: "privilege",
            config: { mcpUrl: PRIV_A, clientId: "c1" },
            presets: [
              { mode: "privilege", url: PRIV_A, clientId: "c1" },
              { mode: "privilege", url: PRIV_B, clientId: "c2" },
            ],
            gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
          },
        }),
  );
  const hook = renderHook(() => usePrivilegeShellSession(), { wrapper });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
  return hook;
}

describe("usePrivilegeShellSession routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads routing state from /state", async () => {
    const { result } = await readyRouted();
    expect(result.current.routing.gatewayMode).toBe("privilege");
    expect(result.current.routing.presets).toHaveLength(2);
  });

  it("pickDoor posts /config and clears tools without auto-listing when authenticated", async () => {
    const { result } = await readyRouted();
    apiClient.post.mockImplementation((url) =>
      url.endsWith("/config")
        ? Promise.resolve({ data: { oauth: { destinationAuthenticated: true } } })
        : Promise.resolve({ data: { tools: [{ name: "other_tool" }] } }),
    );
    await act(() => result.current.pickDoor(PRIV_B));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/privilege-mcp/config",
      expect.objectContaining({ mcpUrl: PRIV_B, clientId: "c2" }),
    );
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/tools/list");
    expect(result.current.tools).toEqual([]);
    expect(result.current.phase).toBe("ready");
  });

  it("pickDoor to an unauthenticated door shows the sign-in gate with no tools", async () => {
    const { result } = await readyRouted();
    apiClient.post.mockResolvedValue({ data: { oauth: { destinationAuthenticated: false } } });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(result.current.phase).toBe("signed-out");
    expect(result.current.notice).toMatch(/^Silent sign-in could not start/);
    expect(result.current.tools).toEqual([]);
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/tools/list");
  });

  it("a failed path switch rolls back and sets a notice", async () => {
    const { result } = await readyRouted();
    apiClient.post.mockRejectedValue({ response: { status: 500, data: { error: "boom" } } });
    await act(() => result.current.pickPath("facade"));
    expect(result.current.routing.gatewayMode).toBe("privilege");
    expect(result.current.notice).toBe("Gateway switch failed: boom");
  });

  it("an LLM path writes no /config and send goes to /llm/call, not /chat", async () => {
    const { result } = await readyRouted();
    await act(() => result.current.pickPath("llm:anthropic"));
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/config", expect.anything());
    apiClient.post.mockResolvedValue({ data: { reply: "hi from claude", route: "/v1/x", latencyMs: 12 } });
    await act(() => result.current.send("hello"));
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/llm/call", { provider: "anthropic", prompt: "hello" });
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/chat", expect.anything());
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", content: "hi from claude" });
  });

  it("an LLM policy denial reads as a denial line, not an error", async () => {
    const { result } = await readyRouted();
    await act(() => result.current.pickPath("llm:anthropic"));
    apiClient.post.mockRejectedValue({
      response: { status: 403, data: { code: "llm_policy_denied", reason: "blocked by policy", provider: "anthropic", route: "/v1/x" } },
    });
    await act(() => result.current.send("leak the keys"));
    expect(result.current.messages[1].content).toBe("⚠️ Privilege denied this call. blocked by policy");
    expect(result.current.thinking).toBe(false);
  });
});

describe("usePrivilegeShellSession theme and connect hook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts on auto and cycles auto -> light -> dark -> auto", async () => {
    const { result } = await ready();
    expect(result.current.pvsTheme).toBe("auto");
    act(() => result.current.cyclePvsTheme());
    expect(result.current.pvsTheme).toBe("light");
    act(() => result.current.cyclePvsTheme());
    expect(result.current.pvsTheme).toBe("dark");
    act(() => result.current.cyclePvsTheme());
    expect(result.current.pvsTheme).toBe("auto");
  });

  it("calls onBeforeConnect before posting /auth/start", async () => {
    apiClient.get.mockResolvedValue({
      data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "list_safes" }] },
    });
    const order = [];
    const onBeforeConnect = vi.fn(() => order.push("before"));
    apiClient.post.mockImplementation(async (url) => {
      order.push(url);
      return { data: { authUrl: "https://auth.example/start" } };
    });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      const { result } = renderHook(() => usePrivilegeShellSession({ onBeforeConnect }), { wrapper });
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(() => result.current.connect());
      expect(order).toEqual(["before", "/api/privilege-mcp/auth/start"]);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("also calls onBeforeConnect when a chat reply asks for sign-in", async () => {
    apiClient.get.mockResolvedValue({
      data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "list_safes" }] },
    });
    const onBeforeConnect = vi.fn();
    apiClient.post.mockImplementation(async (url) =>
      String(url).endsWith("/chat")
        ? { data: { authUrl: "https://auth.example/a", reply: "sign in", steps: [] } }
        : { data: { authUrl: "https://auth.example/start" } });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      const { result } = renderHook(() => usePrivilegeShellSession({ onBeforeConnect }), { wrapper });
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(() => result.current.send("hi"));
      expect(onBeforeConnect).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});

describe("usePrivilegeShellSession silent sign-in", () => {
  const SILENT = "https://auth.example/authorize?prompt=none&client_id=x";
  let assign;
  const original = window.location;

  const mount = async (state, search = "") => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false }, ...state } });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign, search, pathname: "/demo/vscode-copilot" },
    });
    const hook = renderHook(() => usePrivilegeShellSession(), { wrapper });
    await waitFor(() => expect(hook.result.current.phase).toBe("signed-out"));
    return hook;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    assign = vi.fn();
  });
  afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: original }));

  it("starts a prompt=none handshake once when the main app is signed in", async () => {
    apiClient.post.mockResolvedValue({ data: { authUrl: SILENT } });
    await mount({ mainAppAuthenticated: true });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(SILENT));
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/auth/start", { returnTo: "/demo/vscode-copilot" });
  });

  it("stays on the button when the gateway cannot do it silently", async () => {
    apiClient.post.mockResolvedValue({ data: { authUrl: "https://auth.example/authorize?client_id=x" } });
    await mount({ mainAppAuthenticated: true });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
  });

  it("does nothing when the main app is signed out", async () => {
    await mount({ mainAppAuthenticated: false });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("does not retry after an ?auth= return", async () => {
    await mount({ mainAppAuthenticated: true }, "?auth=silent_failed");
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("does not retry once already tried in this tab", async () => {
    sessionStorage.setItem("pvs_silent_signin_tried", "1");
    await mount({ mainAppAuthenticated: true });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("remembers the costume before the silent redirect", async () => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false }, mainAppAuthenticated: true } });
    apiClient.post.mockResolvedValue({ data: { authUrl: SILENT } });
    const order = [];
    const onBeforeConnect = vi.fn(() => order.push("before"));
    assign.mockImplementation(() => order.push("assign"));
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign, search: "", pathname: "/demo/vscode-copilot" },
    });
    renderHook(() => usePrivilegeShellSession({ onBeforeConnect }), { wrapper });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(SILENT));
    expect(order).toEqual(["before", "assign"]);
  });
});

describe("connect parity (startSignIn)", () => {
  let assign;
  const original = window.location;

  const mountReady = async (opts) => {
    apiClient.get.mockResolvedValue({
      data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "list_safes" }] },
    });
    const hook = renderHook(() => usePrivilegeShellSession(opts), { wrapper });
    await waitFor(() => expect(hook.result.current.phase).toBe("ready"), { timeout: 5000 });
    return hook;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
  });
  afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: original }));

  it("connect() posts returnTo, runs onBeforeConnect first, and navigates to the authUrl", async () => {
    const order = [];
    const onBeforeConnect = vi.fn(() => order.push("before"));
    apiClient.post.mockImplementation(async (url) => {
      order.push(url);
      return { data: { authUrl: "https://auth.example/start" } };
    });
    const { result } = await mountReady({ onBeforeConnect });
    await act(() => result.current.connect());
    expect(order).toEqual(["before", "/api/privilege-mcp/auth/start"]);
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/auth/start", { returnTo: "/demo/coding-agent" });
    expect(assign).toHaveBeenCalledWith("https://auth.example/start");
  });

  it("a start with no authUrl does not navigate and sets a notice", async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    const { result } = await mountReady();
    await act(() => result.current.connect());
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.notice).toBe("sign-in did not return an authorization URL");
    expect(result.current.busy).toBe(false);
  });

  it("a door that needs no sign-in loads tools instead of navigating", async () => {
    apiClient.post.mockImplementation(async (url) =>
      url.endsWith("/auth/start") ? { data: { noAuthRequired: true } } : { data: { tools: [{ name: "t" }] } });
    const { result } = await mountReady();
    await act(() => result.current.connect());
    expect(assign).not.toHaveBeenCalled();
    expect(apiClient.post.mock.calls.filter(([u]) => u === "/api/privilege-mcp/tools/list")).toHaveLength(1);
    expect(result.current.messages).toMatchObject([
      { role: "system", content: "This door needs no sign-in — its upstream owns identity. Loading tools." },
    ]);
    expect(result.current.phase).toBe("ready");
    expect(result.current.busy).toBe(false);
  });

  it("a chat authUrl reply still routes through /auth/start with returnTo", async () => {
    apiClient.post.mockImplementation(async (url) =>
      String(url).endsWith("/chat")
        ? { data: { authUrl: "https://auth.example/a", reply: "sign in", steps: [] } }
        : { data: { authUrl: "https://auth.example/start" } });
    const { result } = await mountReady();
    await act(() => result.current.send("hi"));
    expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/auth/start", { returnTo: "/demo/coding-agent" });
    expect(assign).toHaveBeenCalledWith("https://auth.example/start");
  });
});

describe("switch outcomes", () => {
  const SILENT = "https://auth.example/authorize?prompt=none&client_id=x";
  const DIRECT_A = "https://gw.example/banking/mcp";
  const DIRECT_B = "https://gw.example/opensearch/mcp";
  const START = "/api/privilege-mcp/auth/start";
  let assign;
  const original = window.location;

  const mount = async ({ clientAuth, mainApp = false, mode = "privilege", a = PRIV_A, b = PRIV_B }) => {
    apiClient.get.mockImplementation((url) =>
      url.endsWith("/llm/config")
        ? Promise.resolve({ data: { gatewayUrl: "https://llm.example" } })
        : Promise.resolve({
            data: {
              oauth: { authenticated: clientAuth, scope: "openid" },
              mainAppAuthenticated: mainApp,
              tools: clientAuth ? [{ name: "list_safes" }] : [],
              gatewayMode: mode,
              config: { mcpUrl: a, clientId: "c1" },
              presets: [
                { mode, url: a, clientId: "c1" },
                { mode, url: b, clientId: "c2" },
              ],
              gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            },
          }),
    );
    const onBeforeConnect = vi.fn();
    const hook = renderHook(() => usePrivilegeShellSession({ onBeforeConnect }), { wrapper });
    await waitFor(() => expect(hook.result.current.phase).toBe(clientAuth ? "ready" : "signed-out"), { timeout: 5000 });
    return { ...hook, onBeforeConnect };
  };

  const answer = (destinationAuthenticated, start) =>
    apiClient.post.mockImplementation((url) => {
      if (url.endsWith("/config")) return Promise.resolve({ data: { oauth: { destinationAuthenticated } } });
      if (url.endsWith("/auth/start")) return start instanceof Error ? Promise.reject(start) : Promise.resolve({ data: start });
      return Promise.resolve({ data: { tools: [{ name: "t" }] } });
    });
  const startCalls = () => apiClient.post.mock.calls.filter(([u]) => u === START);

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem("pvs_silent_signin_tried", "1");
    assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
  });
  afterEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("an authenticated destination clears tools, stays ready and does not auto-list", async () => {
    const { result } = await mount({ clientAuth: true });
    answer(true, {});
    await act(() => result.current.pickDoor(PRIV_B));
    expect(result.current.tools).toEqual([]);
    expect(result.current.phase).toBe("ready");
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/privilege-mcp/tools/list");
  });

  it("signed in nowhere: the gate shows and no sign-in is started", async () => {
    const { result } = await mount({ clientAuth: false });
    answer(false, { authUrl: SILENT });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(result.current.phase).toBe("signed-out");
    expect(startCalls()).toHaveLength(0);
  });

  it("a signed-in client switching door in Privilege mode starts a silent handshake and follows prompt=none", async () => {
    const { result, onBeforeConnect } = await mount({ clientAuth: true });
    answer(false, { authUrl: SILENT });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(apiClient.post).toHaveBeenCalledWith(START, { returnTo: "/demo/coding-agent" });
    expect(assign).toHaveBeenCalledWith(SILENT);
    expect(onBeforeConnect).toHaveBeenCalled();
    expect(result.current.phase).toBe("signed-out");
  });

  it("a non-prompt=none authUrl is not followed and the gate stays", async () => {
    const { result } = await mount({ clientAuth: true });
    answer(false, { authUrl: "https://auth.example/authorize?client_id=x" });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(startCalls()).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("signed-out");
  });

  it("a non-prompt=none authUrl tells the user why nothing happened", async () => {
    const { result } = await mount({ clientAuth: true });
    answer(false, { authUrl: "https://auth.example/authorize?client_id=x" });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("signed-out");
    expect(result.current.notice).toBe(
      "The gateway cannot silently authorize this door from the current session. Press Get MCP tools to sign in.",
    );
  });

  it("main-app sign-in alone is enough to attempt the silent handshake", async () => {
    const { result, onBeforeConnect } = await mount({ clientAuth: false, mainApp: true });
    answer(false, { authUrl: SILENT });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(assign).toHaveBeenCalledWith(SILENT);
    expect(onBeforeConnect).toHaveBeenCalled();
    expect(result.current.phase).toBe("signed-out");
  });

  it("a door switch outside Privilege mode never starts a silent handshake", async () => {
    const { result } = await mount({ clientAuth: true, mode: "direct", a: DIRECT_A, b: DIRECT_B });
    answer(false, { authUrl: SILENT });
    await act(() => result.current.pickDoor(DIRECT_B));
    expect(startCalls()).toHaveLength(0);
    expect(result.current.phase).toBe("signed-out");
  });

  it("a path switch starts a silent handshake in any mode", async () => {
    const { result } = await mount({ clientAuth: true });
    answer(false, { authUrl: SILENT });
    await act(() => result.current.pickPath("direct"));
    expect(startCalls()).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith(SILENT);
  });

  it("a destination that needs no auth loads its tools", async () => {
    const { result } = await mount({ clientAuth: true });
    answer(false, { noAuthRequired: true });
    await act(() => result.current.pickDoor(PRIV_B));
    expect(apiClient.post.mock.calls.filter(([u]) => u === "/api/privilege-mcp/tools/list")).toHaveLength(1);
    expect(result.current.phase).toBe("ready");
  });

  it("a failed silent start reports a notice and leaves the gate", async () => {
    const { result } = await mount({ clientAuth: true });
    apiClient.post.mockImplementation((url) =>
      url.endsWith("/config")
        ? Promise.resolve({ data: { oauth: { destinationAuthenticated: false } } })
        : Promise.reject({ response: { status: 500, data: { error: "boom" } } }),
    );
    await act(() => result.current.pickDoor(PRIV_B));
    expect(result.current.notice).toBe("Silent sign-in could not start. Press Get MCP tools to sign in manually. (boom)");
    expect(result.current.phase).toBe("signed-out");
  });
});

describe("re-arm and door probing", () => {
  const START = "/api/privilege-mcp/auth/start";
  const PROBE = "/api/privilege-mcp/doors/probe";
  let assign;
  const original = window.location;

  const mount = async ({ mode = "facade", gatewaySession, clientAuth = true } = {}) => {
    apiClient.get.mockImplementation((url) =>
      url.endsWith("/llm/config")
        ? Promise.resolve({ data: { gatewayUrl: "https://llm.example" } })
        : Promise.resolve({
            data: {
              oauth: { authenticated: clientAuth, scope: "openid" },
              mainAppAuthenticated: true,
              tools: clientAuth ? [{ name: "list_safes" }] : [],
              gatewayMode: mode,
              gatewaySession,
              config: { mcpUrl: PRIV_A, clientId: "c1" },
              presets: [
                { mode, url: PRIV_A, clientId: "c1" },
                { mode, url: PRIV_B, clientId: "c2" },
              ],
              gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
            },
          }),
    );
    const hook = renderHook(() => usePrivilegeShellSession(), { wrapper });
    await waitFor(() => expect(hook.result.current.phase).toBe(clientAuth ? "ready" : "signed-out"), { timeout: 5000 });
    return hook;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem("pvs_silent_signin_tried", "1");
    assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
  });
  afterEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("derives needsRearm and rearmReason from the gateway session", async () => {
    const session = { ready: false, reason: "expired" };
    const a = await mount({ gatewaySession: session });
    expect(a.result.current.needsRearm).toBe(true);
    expect(a.result.current.rearmReason).toBe("expired");
    expect(a.result.current.routing.gatewaySession).toEqual(session);
    a.unmount();

    const b = await mount({ gatewaySession: { ready: false } });
    expect(b.result.current.rearmReason).toBe("not established");
    b.unmount();

    const c = await mount({ gatewaySession: { ready: true } });
    expect(c.result.current.needsRearm).toBe(false);
    expect(c.result.current.rearmReason).toBeNull();
    c.unmount();

    const d = await mount({ mode: "privilege", gatewaySession: { ready: false, reason: "expired" } });
    expect(d.result.current.needsRearm).toBe(false);
    expect(d.result.current.rearmReason).toBeNull();
  });

  it("rearm() switches to Privilege then signs in for real, even if /config says authenticated", async () => {
    const { result } = await mount({ gatewaySession: { ready: false, reason: "expired" } });
    apiClient.post.mockImplementation((url) =>
      url.endsWith("/config")
        ? Promise.resolve({ data: { oauth: { destinationAuthenticated: true } } })
        : Promise.resolve({ data: { authUrl: "https://auth.example/authorize?client_id=x" } }),
    );
    await act(() => result.current.rearm());
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/privilege-mcp/config",
      expect.objectContaining({ gatewayMode: "privilege" }),
    );
    expect(apiClient.post).toHaveBeenCalledWith(START, { returnTo: "/demo/coding-agent" });
    expect(assign).toHaveBeenCalledWith("https://auth.example/authorize?client_id=x");
  });

  it("rearm() clears busy and reports the error when /auth/start fails", async () => {
    const { result } = await mount({ gatewaySession: { ready: false, reason: "expired" } });
    apiClient.post.mockImplementation((url) =>
      url.endsWith("/config")
        ? Promise.resolve({ data: { oauth: { destinationAuthenticated: true } } })
        : Promise.reject({ response: { status: 500, data: { error: "boom" } } }),
    );
    await act(() => result.current.rearm());
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.notice).toContain("boom");
  });

  it("probeDoors() posts every preset url and exposes the results", async () => {
    const { result } = await mount({ mode: "privilege" });
    const results = [{ url: PRIV_A, ok: true }, { url: PRIV_B, ok: false }];
    apiClient.post.mockResolvedValue({ data: { results } });
    await act(() => result.current.probeDoors());
    expect(apiClient.post).toHaveBeenCalledWith(PROBE, { urls: [PRIV_A, PRIV_B] });
    expect(result.current.routing.preflight).toEqual(results);
  });

  it("a rejected probe sets preflightError to the server's text", async () => {
    const { result } = await mount({ mode: "privilege" });
    apiClient.post.mockRejectedValue({ response: { status: 500, data: { error: "probe down" } } });
    await act(() => result.current.probeDoors());
    expect(result.current.routing.preflightError).toBe("probe down");
  });
});

describe("usePrivilegeShellSession return notices", () => {
  beforeEach(() => vi.clearAllMocks());
  const at = (search) => ({ children }) => (
    <MemoryRouter initialEntries={[`/demo/coding-agent${search}`]}>{children}</MemoryRouter>
  );

  it("explains a failed silent sign-in on ?auth=silent_failed", async () => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false } } });
    const { result } = renderHook(() => usePrivilegeShellSession(), { wrapper: at("?auth=silent_failed") });
    await waitFor(() => expect(result.current.phase).toBe("signed-out"), { timeout: 5000 });
    expect(result.current.notice).toBe("Silent sign-in was not possible. Press Get MCP tools to sign in.");
  });

  it("keeps the ?auth=error notice", async () => {
    apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: false } } });
    const { result } = renderHook(() => usePrivilegeShellSession(), { wrapper: at("?auth=error&reason=denied") });
    await waitFor(() => expect(result.current.phase).toBe("signed-out"), { timeout: 5000 });
    expect(result.current.notice).toBe("OAuth failed: denied");
  });
});
