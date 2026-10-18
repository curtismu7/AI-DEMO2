import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../signInService", () => ({ openSignIn: vi.fn() }));
import { openSignIn } from "../signInService";
import { startRoleSwitch } from "../roleSwitch";

describe("startRoleSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ redirectUrl: "/api/auth/oauth/login" }) });
  });

  it("clears the session via /switch, then opens the shared admin sign-in (default /admin)", async () => {
    await startRoleSwitch("admin");
    expect(global.fetch).toHaveBeenCalledWith("/api/auth/switch", expect.objectContaining({ method: "POST", body: JSON.stringify({ targetRole: "admin" }) }));
    expect(openSignIn).toHaveBeenCalledWith({ role: "admin", returnTo: "/admin", force: true });
  });

  it("keeps an explicit return path, and maps customer", async () => {
    await startRoleSwitch("customer", "/delegated-commerce");
    expect(openSignIn).toHaveBeenCalledWith({ role: "customer", returnTo: "/delegated-commerce", force: true });
  });

  it("throws and does not open sign-in when /switch fails", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(startRoleSwitch("admin")).rejects.toThrow("Switch failed: 500");
    expect(openSignIn).not.toHaveBeenCalled();
  });
});
