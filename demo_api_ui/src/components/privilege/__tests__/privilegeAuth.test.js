import { requestAuthStart, isSilentAuthUrl } from "../privilegeAuth";

describe("requestAuthStart", () => {
  it("POSTs /auth/start and returns the redirect", async () => {
    const request = vi.fn().mockResolvedValue({ authUrl: "https://auth.example/a?x=1" });
    await expect(requestAuthStart(request)).resolves.toEqual({ kind: "redirect", authUrl: "https://auth.example/a?x=1" });
    expect(request).toHaveBeenCalledWith("/auth/start", { method: "POST" });
  });
  it("reports a door that needs no sign-in, before checking for an authUrl", async () => {
    const request = vi.fn().mockResolvedValue({ noAuthRequired: true });
    await expect(requestAuthStart(request)).resolves.toEqual({ kind: "no-auth-required" });
  });
  it("never parses the URL: an unparseable authUrl still resolves as a redirect", async () => {
    const request = vi.fn().mockResolvedValue({ authUrl: "not a url" });
    await expect(requestAuthStart(request)).resolves.toEqual({ kind: "redirect", authUrl: "not a url" });
  });
  it("throws when sign-in returns no authorization URL", async () => {
    await expect(requestAuthStart(vi.fn().mockResolvedValue({}))).rejects.toThrow("sign-in did not return an authorization URL");
    await expect(requestAuthStart(vi.fn().mockResolvedValue(null))).rejects.toThrow("sign-in did not return an authorization URL");
  });
  it("lets a request failure propagate", async () => {
    const boom = new Error("nope");
    await expect(requestAuthStart(vi.fn().mockRejectedValue(boom))).rejects.toBe(boom);
  });
});

describe("isSilentAuthUrl", () => {
  it("is true only for prompt=none", () => {
    expect(isSilentAuthUrl("https://auth.example/a?prompt=none&x=1")).toBe(true);
    expect(isSilentAuthUrl("https://auth.example/a?prompt=login")).toBe(false);
    expect(isSilentAuthUrl("https://auth.example/a")).toBe(false);
  });
  it("throws on an invalid URL, like new URL", () => {
    expect(() => isSilentAuthUrl("not a url")).toThrow();
  });
});
