import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWidgetConfig, loadWidget } from "../davinciWidgetClient";

// The widget config comes from the BFF, never from the bundle: the DaVinci API
// key that mints the SDK token is a secret, so POST /api/davinci-login/sdk-token
// is the only way to obtain one.

const originalFetch = global.fetch;

beforeEach(() => {
  delete window.davinci;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchWidgetConfig", () => {
  test("POSTs to the BFF sdk-token endpoint and returns its config", async () => {
    const cfg = { accessToken: "t", companyId: "c", policyId: "p", authorizeUrl: "https://x/authorize" };
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => cfg }));

    await expect(fetchWidgetConfig()).resolves.toEqual(cfg);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/davinci-login/sdk-token");
    expect(opts.method).toBe("POST");
  });

  test("surfaces the BFF's message when DaVinci is not configured", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: async () => ({ error: "davinci_not_configured", message: "Set PINGONE_DAVINCI_..." }),
      })
    );

    await expect(fetchWidgetConfig()).rejects.toThrow(/Set PINGONE_DAVINCI_/);
  });

  test("falls back to the status code when the error body is unreadable", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error("not json"); } })
    );

    await expect(fetchWidgetConfig()).rejects.toThrow(/HTTP 502/);
  });
});

describe("loadWidget", () => {
  test("resolves immediately when the widget global is already present", async () => {
    const stub = { skRenderScreen: () => {} };
    window.davinci = stub;
    const appendChild = vi.spyOn(document.head, "appendChild");

    await expect(loadWidget()).resolves.toBe(stub);
    expect(appendChild).not.toHaveBeenCalled();
  });
});
