import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@forgerock/davinci-client", () => ({
  davinci: vi.fn(),
}));

const originalFetch = global.fetch;

describe("davinciWidgetClient.getDavinciClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    global.fetch = vi.fn();
    const { davinci } = await import("@forgerock/davinci-client");
    davinci.mockReset();
  });
  afterEach(() => { global.fetch = originalFetch; });

  test("fetches config and builds a davinci client", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        wellknown: "https://auth.pingone.com/env-1/as/.well-known/openid-configuration",
        clientId: "widget-client-id",
        redirectUri: "https://local.ping-devops.com:4000/davinci-login/callback",
        flowVersion: "v1",
      }),
    });
    const { davinci } = await import("@forgerock/davinci-client");
    davinci.mockReturnValue({ some: "client" });

    const { getDavinciClient } = await import("../davinciWidgetClient");
    const client = await getDavinciClient();

    expect(client).toEqual({ some: "client" });
    expect(davinci).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        clientId: "widget-client-id",
        redirectUri: "https://local.ping-devops.com:4000/davinci-login/callback",
      }),
    }));
  });

  test("throws when the config endpoint is not configured", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { getDavinciClient } = await import("../davinciWidgetClient");
    await expect(getDavinciClient()).rejects.toThrow(/not configured/i);
  });
});
