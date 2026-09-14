import { describe, it, expect, vi } from "vitest";
import { installWidgetTrace, summarizeWidgetTrace } from "../davinciWidgetTrace";

const json = (body, status = 200) => ({
  status,
  headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
  clone() { return { json: async () => body }; },
});

function fakeWindow(responses) {
  const calls = [];
  const target = {
    location: { origin: "https://local.ping-devops.com:4000" },
    fetch: vi.fn(async (input, init) => { calls.push([input, init]); return responses.shift(); }),
  };
  return { target, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("installWidgetTrace", () => {
  it("records method, host, path, status and only the allowed response fields", async () => {
    const { target } = fakeWindow([
      json({ interactionId: "INTERACTION-SECRET", capabilityName: "customHTMLTemplate", screen: {} }),
    ]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    await target.fetch("https://auth.pingone.com/env-1/davinci/policy/pol-1/start", {
      method: "POST",
      headers: { Authorization: "Bearer SDK-TOKEN-SECRET" },
    });
    await tick();

    expect(onCall).toHaveBeenCalledWith({
      method: "POST",
      host: "auth.pingone.com",
      path: "/env-1/davinci/policy/pol-1/start",
      status: 200,
      capabilityName: "customHTMLTemplate",
      connectorId: null,
      success: null,
    });
    expect(JSON.stringify(onCall.mock.calls)).not.toMatch(/SECRET/);
  });

  it("keeps success and connectorId from the final node, never the tokens", async () => {
    const { target } = fakeWindow([
      json({
        success: true,
        access_token: "AT-SECRET",
        id_token: "ID-SECRET",
        sessionToken: "ST-SECRET",
        capabilityName: "returnSuccessResponseWidget",
        connectorId: "pingOneAuthenticationConnector",
      }),
    ]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    await target.fetch("https://auth.pingone.com/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", { method: "POST" });
    await tick();

    expect(onCall.mock.calls[0][0]).toMatchObject({
      success: true,
      capabilityName: "returnSuccessResponseWidget",
      connectorId: "pingOneAuthenticationConnector",
    });
    expect(JSON.stringify(onCall.mock.calls)).not.toMatch(/SECRET/);
  });

  it("returns the original response untouched and ignores unrelated calls", async () => {
    const other = json({ ok: true });
    const { target } = fakeWindow([other]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    const res = await target.fetch("/api/verticals/list");
    await tick();

    expect(res).toBe(other);
    expect(onCall).not.toHaveBeenCalled();
  });

  it("records a call made with a URL object input, not just a string", async () => {
    const { target } = fakeWindow([json({ ok: true })]);
    const onCall = vi.fn();
    installWidgetTrace(onCall, target);

    await target.fetch(new URL("https://auth.pingone.com/env-1/davinci/policy/pol-1/start"));
    await tick();

    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ host: "auth.pingone.com", path: "/env-1/davinci/policy/pol-1/start" }),
    );
  });

  it("records the page's own BFF calls, and restores fetch on uninstall", async () => {
    const { target } = fakeWindow([json({ ok: true })]);
    const original = target.fetch;
    const onCall = vi.fn();
    const uninstall = installWidgetTrace(onCall, target);

    await target.fetch("/api/davinci-login/widget-session", { method: "POST" });
    await tick();
    uninstall();

    expect(onCall.mock.calls[0][0]).toMatchObject({ host: "local.ping-devops.com:4000", path: "/api/davinci-login/widget-session", status: 200 });
    expect(target.fetch).toBe(original);
  });

  // Live 2026-09-13: the widget stops recording as soon as postWidgetSession's own
  // res.json() resolves, which beat the trace's clone().json() — so the
  // /widget-session record was dropped. shouldRecord is asked when a call STARTS.
  it("asks shouldRecord when a call starts, so a slow body read cannot drop a call already in flight", async () => {
    let release;
    const bodyRead = new Promise((r) => { release = r; });
    const slow = { ...json({}), clone() { return { json: async () => { await bodyRead; return {}; } }; } };
    const { target } = fakeWindow([slow, json({ ok: true })]);
    const onCall = vi.fn();
    let recording = true;
    installWidgetTrace(onCall, target, () => recording);

    await target.fetch("/api/davinci-login/widget-session", { method: "POST" });
    recording = false;
    release();
    await tick();
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0][0]).toMatchObject({ path: "/api/davinci-login/widget-session" });

    await target.fetch("https://auth.pingone.com/env-1/davinci/policy/pol-1/start", { method: "POST" });
    await tick();
    expect(onCall).toHaveBeenCalledTimes(1);
  });
});

describe("summarizeWidgetTrace", () => {
  const CALLS = [
    { method: "POST", host: "local", path: "/api/davinci-login/sdk-token", status: 200, capabilityName: null, connectorId: null, success: null },
    { method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/policy/pol-1/start", status: 200, capabilityName: "customHTMLTemplate", connectorId: null, success: null },
    { method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", status: 200, capabilityName: "customHTMLTemplate", connectorId: null, success: null },
    { method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", status: 200, capabilityName: "returnSuccessResponseWidget", connectorId: "pingOneAuthenticationConnector", success: true },
    { method: "POST", host: "local", path: "/api/davinci-login/widget-session", status: 200, capabilityName: null, connectorId: null, success: null },
  ];

  it("reports the run a developer just watched", () => {
    expect(summarizeWidgetTrace(CALLS)).toMatchObject({
      started: true,
      capabilityPosts: 2,
      finalCapability: "returnSuccessResponseWidget",
      tokensReturned: true,
      session: { status: 200 },
      authorizeCalls: 0,
    });
  });

  it("claims nothing for an empty run", () => {
    expect(summarizeWidgetTrace([])).toMatchObject({
      started: false, capabilityPosts: 0, finalCapability: null, tokensReturned: false, session: null, authorizeCalls: 0,
    });
  });
});
