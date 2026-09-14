// The SDK trace feeds the on-page Step Inspector, which shows the body each flow
// step POSTs to DaVinci. That body carries what the user typed — a password on
// the sign-on form — so the promise pinned here is that no typed value survives
// into the trace, while the shape a developer needs to learn from does.
import { describe, it, expect, vi } from "vitest";

const captured = {};
vi.mock("@forgerock/davinci-client", () => ({
  davinci: vi.fn(async (opts) => {
    captured.opts = opts;
    return { subscribe: vi.fn(), getNode: vi.fn() };
  }),
}));

import { initClient, maskStepBody } from "../davinciSdkClient";

const SUBMIT_BODY = JSON.stringify({
  id: "node-id-123",
  eventName: "continue",
  interactionId: "interaction-456",
  parameters: {
    eventType: "submit",
    data: { actionKey: "SIGNON", formData: { username: "customer1", password: "Harbor-Secret-1" } },
  },
});

describe("maskStepBody", () => {
  it("keeps the shape and the formData keys, and hides every typed value", () => {
    const masked = maskStepBody(SUBMIT_BODY);
    expect(masked).toEqual({
      id: "…",
      eventName: "continue",
      interactionId: "…",
      parameters: {
        eventType: "submit",
        data: { actionKey: "SIGNON", formData: { username: "…", password: "…" } },
      },
    });
    const text = JSON.stringify(masked);
    expect(text).not.toContain("Harbor-Secret-1");
    expect(text).not.toContain("customer1");
    expect(text).not.toContain("interaction-456");
  });

  it("drops fields it does not know rather than showing them", () => {
    const masked = maskStepBody(
      JSON.stringify({ eventName: "continue", secretThing: "x", parameters: { eventType: "action", data: { actionKey: "TROUBLE", extra: "y" } } }),
    );
    expect(masked).toEqual({ eventName: "continue", parameters: { eventType: "action", data: { actionKey: "TROUBLE" } } });
  });

  it("returns null for a GET (no body) or a body that is not JSON", () => {
    expect(maskStepBody(undefined)).toBeNull();
    expect(maskStepBody("not json")).toBeNull();
  });
});

describe("initClient request middleware", () => {
  it("records method, URL and the MASKED body of the SDK's own request object", async () => {
    const entries = [];
    await initClient({ clientId: "c", redirectUri: "r", wellknown: "w" }, { onTrace: (e) => entries.push(e) });

    const [middleware] = captured.opts.requestMiddleware;
    const next = vi.fn();
    const url = new URL("https://auth.pingone.com/env/davinci/connections/abc/capabilities/customHTMLTemplate");
    middleware({ url, method: "POST", headers: new Headers(), body: SUBMIT_BODY }, { type: "DAVINCI_NEXT" }, next);

    expect(next).toHaveBeenCalled();
    const http = entries.find((e) => e.source === "http");
    expect(http).toMatchObject({ method: "POST", url: url.toString(), action: "DAVINCI_NEXT" });
    expect(http.body.parameters.data.formData).toEqual({ username: "…", password: "…" });
    expect(JSON.stringify(entries)).not.toContain("Harbor-Secret-1");
  });
});
