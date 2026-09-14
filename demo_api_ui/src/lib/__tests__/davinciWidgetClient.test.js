import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchWidgetConfig,
  fetchWidgetSessionStatus,
  loadWidget,
  postWidgetSession,
  refreshWidgetSessionIfNeeded,
} from "../davinciWidgetClient";

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
    const cfg = { accessToken: "t", companyId: "c", policyId: "p", apiRoot: "https://auth.pingone.com/" };
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

describe("postWidgetSession", () => {
  test("POSTs both tokens as JSON to the BFF widget-session endpoint", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }));

    await expect(postWidgetSession({ idToken: "id-1", accessToken: "at-1" })).resolves.toEqual({ ok: true });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/davinci-login/widget-session");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ idToken: "id-1", accessToken: "at-1" });
  });

  test("surfaces the BFF's rejection message", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ error: "nonce_mismatch", message: "ID token failed replay verification. Restart the sign-in." }),
      })
    );

    await expect(postWidgetSession({ idToken: "id-1", accessToken: "at-1" })).rejects.toThrow(/replay verification/);
  });

  test("falls back to the status code when the error body is unreadable", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error("not json"); } })
    );

    await expect(postWidgetSession({ idToken: "id-1", accessToken: "at-1" })).rejects.toThrow(/HTTP 500/);
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

// 2026-09-13 tech debt: the widget's tokens carry no refresh token, so a
// near-expiry session must be silently re-run rather than left to expire.
describe("fetchWidgetSessionStatus", () => {
  test("GETs the BFF session-status endpoint and returns its body", async () => {
    const body = { davinciWidgetLogin: true, needsRefresh: true };
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => body }));

    await expect(fetchWidgetSessionStatus()).resolves.toEqual(body);
    expect(global.fetch.mock.calls[0][0]).toBe("/api/davinci-login/session-status");
  });

  test("fails closed (no refresh) when the endpoint errors", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    await expect(fetchWidgetSessionStatus()).resolves.toEqual({ davinciWidgetLogin: false, needsRefresh: false });
  });

  test("fails closed when the fetch itself throws", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    await expect(fetchWidgetSessionStatus()).resolves.toEqual({ davinciWidgetLogin: false, needsRefresh: false });
  });
});

describe("refreshWidgetSessionIfNeeded", () => {
  test("does nothing when the session does not need a refresh", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ davinciWidgetLogin: true, needsRefresh: false }) })
    );

    await expect(refreshWidgetSessionIfNeeded()).resolves.toBe(false);
    // Only the status check ran — no widget config was fetched.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("re-runs the flow in a detached container and posts the result, reusing the same session", async () => {
    const statusBody = { davinciWidgetLogin: true, needsRefresh: true };
    const cfg = { accessToken: "sdk-tok-refresh", companyId: "co-1", policyId: "pol-v1", apiRoot: "https://auth.pingone.com/" };
    global.fetch = vi.fn((url) => {
      if (url === "/api/davinci-login/session-status") return Promise.resolve({ ok: true, json: async () => statusBody });
      if (url === "/api/davinci-login/sdk-token") return Promise.resolve({ ok: true, json: async () => cfg });
      if (url === "/api/davinci-login/widget-session") return Promise.resolve({ ok: true, json: async () => ({ ok: true, username: "demouser" }) });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const skRenderScreen = vi.fn((node, props) => {
      // A detached, invisible container — never shown to the user.
      expect(document.body.contains(node)).toBe(true);
      expect(node.style.left).toBe("-9999px");
      props.successCallback({ id_token: "id-refresh", access_token: "at-refresh" });
    });
    window.davinci = { skRenderScreen };

    await expect(refreshWidgetSessionIfNeeded()).resolves.toBe(true);

    const [node] = skRenderScreen.mock.calls[0];
    // Cleaned up after completing — nothing left behind in the DOM.
    expect(document.body.contains(node)).toBe(false);
    const widgetSessionCall = global.fetch.mock.calls.find((c) => c[0] === "/api/davinci-login/widget-session");
    expect(JSON.parse(widgetSessionCall[1].body)).toEqual({ idToken: "id-refresh", accessToken: "at-refresh" });
  });

  test("resolves false, non-fatally, when the flow's errorCallback fires", async () => {
    global.fetch = vi.fn((url) => {
      if (url === "/api/davinci-login/session-status") return Promise.resolve({ ok: true, json: async () => ({ davinciWidgetLogin: true, needsRefresh: true }) });
      if (url === "/api/davinci-login/sdk-token") return Promise.resolve({ ok: true, json: async () => ({ accessToken: "t", companyId: "c", policyId: "p", apiRoot: "https://auth.pingone.com/" }) });
      throw new Error(`unexpected fetch: ${url}`);
    });
    window.davinci = { skRenderScreen: (_node, props) => props.errorCallback({ message: "boom" }) };

    await expect(refreshWidgetSessionIfNeeded()).resolves.toBe(false);
  });
});
