import { afterEach, describe, expect, it, vi } from "vitest";
import { completeProtectAuthentication, evaluateProtectAuthentication } from "../protectAuthenticationService";

afterEach(() => vi.unstubAllGlobals());

describe("Protect browser authentication API", () => {
  it("posts user identity and Signals to the BFF with same-origin CSRF protection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ flowId: "opaque-flow", level: "MEDIUM", recommendedAction: "MFA" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateProtectAuthentication({ userId: "alice@example.com", signalsData: "signals" })).resolves.toEqual({
      flowId: "opaque-flow", level: "MEDIUM", recommendedAction: "MFA",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/protect-auth/evaluations", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-protect-auth-csrf": "1", Accept: "application/json" },
      body: JSON.stringify({ userId: "alice@example.com", signalsData: "signals" }),
    }));
  });

  it("surfaces BFF completion errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "protect_completion_failed" }) }));

    await expect(completeProtectAuthentication({ flowId: "flow", completionStatus: "SUCCESS" }))
      .rejects.toThrow("Protect authentication update failed (502)");
  });
});
