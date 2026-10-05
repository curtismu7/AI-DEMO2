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
