import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateProtectBrowserRisk } from "../protectAuthenticationService";

afterEach(() => vi.unstubAllGlobals());

describe("Protect browser evaluation API", () => {
  it("posts user identity and Signals to the BFF with same-origin CSRF protection", async () => {
    const result = { level: "MEDIUM", recommendedAction: "MFA", botDetection: { level: "LOW", status: "COMPLETE" } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateProtectBrowserRisk({ userId: "alice@example.com", signalsData: "signals" })).resolves.toEqual({
      level: "MEDIUM", recommendedAction: "MFA", botDetection: { level: "LOW", status: "COMPLETE" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/protect-auth/evaluations", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-protect-auth-csrf": "1", Accept: "application/json" },
      body: JSON.stringify({ userId: "alice@example.com", signalsData: "signals" }),
    }));
  });

  it("does not require an authentication completion handle for an evaluation response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ level: "HIGH", recommendedAction: "DENY" }) }));
    await expect(evaluateProtectBrowserRisk({ userId: "alice", signalsData: "signals" }))
      .resolves.toEqual({ level: "HIGH", recommendedAction: "DENY" });
  });
});
