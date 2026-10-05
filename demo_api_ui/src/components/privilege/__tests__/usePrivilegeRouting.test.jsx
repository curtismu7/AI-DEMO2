import { act, renderHook } from "@testing-library/react";
import { usePrivilegeRouting } from "../usePrivilegeRouting";

const PRIV_A = "https://gw.example/privilege-gateway/banking/mcp";
const PRIV_B = "https://gw.example/privilege-gateway/other/mcp";
const FAC_A = "https://api.ping.demo:3001/mcp-facade/banking/mcp";
const STATE = {
  gatewayMode: "privilege",
  config: { mcpUrl: PRIV_A, clientId: "c1" },
  presets: [
    { mode: "privilege", url: PRIV_A, clientId: "c1" },
    { mode: "privilege", url: PRIV_B, clientId: "c2" },
    { mode: "facade", url: FAC_A, clientId: "cf" },
  ],
  gatewayConfigs: { direct: {}, privilege: {}, facade: {} },
};

function setup(request) {
  const hook = renderHook(() => usePrivilegeRouting({ request }));
  act(() => hook.result.current.hydrate(STATE));
  return hook;
}

describe("usePrivilegeRouting", () => {
  it("hydrates mode, config, presets and marks loaded", () => {
    const { result } = setup(vi.fn());
    expect(result.current.gatewayMode).toBe("privilege");
    expect(result.current.config.mcpUrl).toBe(PRIV_A);
    expect(result.current.presets).toHaveLength(3);
    expect(result.current.loaded).toBe(true);
  });

  it("selectPath keeps the same door across modes and posts /config", async () => {
    const request = vi.fn().mockResolvedValue({ gatewayConfigs: { direct: {}, privilege: {}, facade: {} } });
    const { result } = setup(request);
    let out;
    await act(async () => { out = await result.current.selectPath("facade"); });
    expect(out.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("/config", {
      method: "POST",
      body: expect.objectContaining({ gatewayMode: "facade", mcpUrl: FAC_A, clientId: "cf" }),
    });
    expect(result.current.gatewayMode).toBe("facade");
    expect(result.current.config.mcpUrl).toBe(FAC_A);
  });

  it("rolls mode and config back when /config fails", async () => {
    const boom = new Error("nope");
    const { result } = setup(vi.fn().mockRejectedValue(boom));
    let out;
    await act(async () => { out = await result.current.selectPath("facade"); });
    expect(out).toEqual({ ok: false, error: boom });
    expect(result.current.gatewayMode).toBe("privilege");
    expect(result.current.config.mcpUrl).toBe(PRIV_A);
  });

  it("an LLM path sets llmPath only — no request", async () => {
    const request = vi.fn();
    const { result } = setup(request);
    let out;
    await act(async () => { out = await result.current.selectPath("llm:anthropic"); });
    expect(out).toEqual({ ok: true, llm: true });
    expect(result.current.llmPath).toBe("anthropic");
    expect(request).not.toHaveBeenCalled();
  });

  it("an MCP path clears an active LLM path", async () => {
    const { result } = setup(vi.fn().mockResolvedValue({}));
    await act(async () => { await result.current.selectPath("llm:openai"); });
    await act(async () => { await result.current.selectPath("privilege"); });
    expect(result.current.llmPath).toBe("");
  });

  it("selectDoor posts the preset's mcpUrl + clientId and updates config on success", async () => {
    const request = vi.fn().mockResolvedValue({ oauth: { destinationAuthenticated: true } });
    const { result } = setup(request);
    let out;
    await act(async () => { out = await result.current.selectDoor(PRIV_B); });
    expect(out.ok).toBe(true);
    expect(request).toHaveBeenCalledWith("/config", {
      method: "POST",
      body: expect.objectContaining({ mcpUrl: PRIV_B, clientId: "c2" }),
    });
    expect(result.current.config.mcpUrl).toBe(PRIV_B);
  });

  it("selectDoor leaves config untouched on failure", async () => {
    const boom = new Error("nope");
    const { result } = setup(vi.fn().mockRejectedValue(boom));
    let out;
    await act(async () => { out = await result.current.selectDoor(PRIV_B); });
    expect(out).toEqual({ ok: false, error: boom });
    expect(result.current.config.mcpUrl).toBe(PRIV_A);
  });
});

describe("usePrivilegeRouting gatewaySession and door probing", () => {
  it("hydrates gatewaySession and defaults it to null", () => {
    const { result } = setup(vi.fn());
    expect(result.current.gatewaySession).toBeNull();
    act(() => result.current.hydrate({ ...STATE, gatewaySession: { ready: false, reason: "expired" } }));
    expect(result.current.gatewaySession).toEqual({ ready: false, reason: "expired" });
  });

  it("probePresetDoors posts every preset url and stores the results", async () => {
    const request = vi.fn().mockResolvedValue({ results: [{ url: FAC_A, ok: true, tools: 3 }] });
    const { result } = setup(request);
    await act(async () => { await result.current.probePresetDoors(); });
    expect(request).toHaveBeenCalledWith("/doors/probe", { method: "POST", body: { urls: [PRIV_A, PRIV_B, FAC_A] } });
    expect(result.current.preflight).toEqual([{ url: FAC_A, ok: true, tools: 3 }]);
    expect(result.current.preflightBusy).toBe(false);
    expect(result.current.preflightError).toBe("");
  });

  it("stores [] when the response has no results array", async () => {
    const { result } = setup(vi.fn().mockResolvedValue({}));
    await act(async () => { await result.current.probePresetDoors(); });
    expect(result.current.preflight).toEqual([]);
  });

  it("surfaces a failed probe as an error and clears results", async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new Error("Not authenticated.")));
    await act(async () => { await result.current.probePresetDoors(); });
    expect(result.current.preflight).toBeNull();
    expect(result.current.preflightError).toBe("Not authenticated.");
  });

  it("prefers the server's error text from an axios-shaped failure", async () => {
    const { result } = setup(vi.fn().mockRejectedValue({ message: "Request failed", response: { data: { error: "Not authenticated." } } }));
    await act(async () => { await result.current.probePresetDoors(); });
    expect(result.current.preflightError).toBe("Not authenticated.");
  });

  it("falls back to 'Preflight failed'", async () => {
    const { result } = setup(vi.fn().mockRejectedValue({}));
    await act(async () => { await result.current.probePresetDoors(); });
    expect(result.current.preflightError).toBe("Preflight failed");
  });
});
