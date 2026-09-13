import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import DavinciLoginWidget from "../DavinciLoginWidget";

// The page must render the DaVinci flow with the config the BFF minted, and on
// success hand the flow's OIDC tokens to POST /api/davinci-login/widget-session
// before loading the confirmation page. Dropping that post leaves the user
// authenticated to PingOne but never signed in to the demo, so these tests pin
// the wiring.
//
// username is optional in the flow's Input Schema (the flow's own Sign On
// screen collects it), so the page starts the flow immediately with no
// identifier field of its own.

vi.mock("../../lib/davinciWidgetClient", () => ({
  loadWidget: vi.fn(),
  fetchWidgetConfig: vi.fn(),
  postWidgetSession: vi.fn(),
}));

import { loadWidget, fetchWidgetConfig, postWidgetSession } from "../../lib/davinciWidgetClient";

vi.mock("../../lib/davinciWidgetTrace", () => ({ installWidgetTrace: vi.fn() }));

import { installWidgetTrace } from "../../lib/davinciWidgetTrace";

const CONFIG = {
  accessToken: "sdk-tok-1",
  companyId: "co-1",
  policyId: "pol-v1",
  flowVersion: "v1",
  apiRoot: "https://auth.pingone.com/",
};

let assigned;
let cookieWrites;
const originalLocation = window.location;

beforeEach(() => {
  assigned = [];
  cookieWrites = [];
  delete window.location;
  window.location = { assign: (url) => assigned.push(url), search: "" };
  // Spy the setter: the page used to write a DV-ST cookie PingOne never read,
  // and must not again.
  vi.spyOn(document, "cookie", "set").mockImplementation((v) => cookieWrites.push(v));
  fetchWidgetConfig.mockResolvedValue(CONFIG);
});

afterEach(() => {
  window.location = originalLocation;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("DavinciLoginWidget rendering", () => {
  test("starts the flow immediately, with no username field of its own", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });

    render(<DavinciLoginWidget />);

    await waitFor(() => expect(fetchWidgetConfig).toHaveBeenCalledTimes(1));
    expect(fetchWidgetConfig).toHaveBeenCalledWith();
  });

  test("renders the flow with the BFF-minted SDK token and policy", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });

    render(<DavinciLoginWidget />);

    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));
    const [node, props] = skRenderScreen.mock.calls[0];
    expect(node).toBeInstanceOf(HTMLElement);
    expect(props.config).toMatchObject({
      method: "runFlow",
      apiRoot: CONFIG.apiRoot,
      accessToken: CONFIG.accessToken,
      companyId: CONFIG.companyId,
      policyId: CONFIG.policyId,
      includeHttpCredentials: true,
    });
  });

  test("successCallback posts the tokens, stays on the page and reports who signed in", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    postWidgetSession.mockResolvedValue({ ok: true, username: "demouser" });
    const uninstall = vi.fn();
    installWidgetTrace.mockReturnValue(uninstall);
    const onSignedIn = vi.fn();
    const onCall = vi.fn();

    render(<DavinciLoginWidget onCall={onCall} onSignedIn={onSignedIn} />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    await skRenderScreen.mock.calls[0][1].successCallback({ id_token: "id-1", access_token: "at-1" });

    expect(postWidgetSession).toHaveBeenCalledWith({ idToken: "id-1", accessToken: "at-1" });
    expect(onSignedIn).toHaveBeenCalledWith({ username: "demouser" });
    // The trace stays installed after success — only unmount uninstalls it —
    // but a call that starts after sign-in is not recorded.
    expect(uninstall).not.toHaveBeenCalled();
    const shouldRecord = installWidgetTrace.mock.calls[0][2];
    expect(shouldRecord()).toBe(false);
    expect(assigned).toEqual([]);
    expect(cookieWrites).toEqual([]);
  });

  test("installs the call trace before it fetches config, so /sdk-token and /start are recorded", async () => {
    const order = [];
    installWidgetTrace.mockImplementation(() => { order.push("trace"); return vi.fn(); });
    fetchWidgetConfig.mockImplementation(async () => { order.push("config"); return CONFIG; });
    loadWidget.mockResolvedValue({ skRenderScreen: vi.fn() });
    const onCall = vi.fn();
    const onStart = vi.fn();

    render(<DavinciLoginWidget onCall={onCall} onStart={onStart} />);

    await waitFor(() => expect(order).toEqual(["trace", "config"]));
    expect(installWidgetTrace).toHaveBeenCalledWith(onCall, window, expect.any(Function));
    // Recording is on while the run is in flight.
    expect(installWidgetTrace.mock.calls[0][2]()).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  test("removes the call trace when it unmounts", async () => {
    const uninstall = vi.fn();
    installWidgetTrace.mockReturnValue(uninstall);
    loadWidget.mockResolvedValue({ skRenderScreen: vi.fn() });

    const { unmount } = render(<DavinciLoginWidget onCall={vi.fn()} />);
    await waitFor(() => expect(installWidgetTrace).toHaveBeenCalled());
    unmount();

    expect(uninstall).toHaveBeenCalled();
  });

  test("a sign-in the BFF rejects shows its reason and does not leave the page", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    postWidgetSession.mockRejectedValue(new Error("Sign-in tokens failed verification. Restart the sign-in."));

    const { findByText } = render(<DavinciLoginWidget />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    await skRenderScreen.mock.calls[0][1].successCallback({ id_token: "id-1", access_token: "at-1" });

    await findByText(/failed verification/i);
    expect(assigned).toEqual([]);
  });

  test("shows an error and does not render the flow when the BFF will not mint a token", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    fetchWidgetConfig.mockRejectedValue(new Error("DaVinci demo is not configured."));

    const { findByText } = render(<DavinciLoginWidget />);

    await findByText(/not configured/i);
    expect(skRenderScreen).not.toHaveBeenCalled();
  });

  test("errorCallback surfaces the flow failure instead of redirecting", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    const onCall = vi.fn();

    const { findByText } = render(<DavinciLoginWidget onCall={onCall} />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    skRenderScreen.mock.calls[0][1].errorCallback({ message: "Flow policy not found" });

    await findByText(/flow policy not found/i);
    expect(assigned).toEqual([]);
    expect(postWidgetSession).not.toHaveBeenCalled();
    // A call that starts after the error is not recorded (recording stopped).
    expect(installWidgetTrace.mock.calls[0][2]()).toBe(false);
  });

  // C1: StrictMode mounts, simulates an unmount, then remounts before the
  // config fetch resolves. The trace must survive that so calls the widget
  // makes after skRenderScreen (start, screen submits, widget-session) still
  // reach onCall — not just the /sdk-token call made before the first await.
  test("under StrictMode, a call made after skRenderScreen still reaches onCall", async () => {
    const actual = await vi.importActual("../../lib/davinciWidgetTrace");
    installWidgetTrace.mockImplementation(actual.installWidgetTrace);
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async () => ({ status: 200, headers: { get: () => null } }));
    const onCall = vi.fn();

    render(
      <StrictMode>
        <DavinciLoginWidget onCall={onCall} />
      </StrictMode>,
    );
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    await window.fetch("https://auth.pingone.com/env-1/davinci/policy/pol-1/start", { method: "POST" });
    await waitFor(() =>
      expect(onCall).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/env-1/davinci/policy/pol-1/start" }),
      ),
    );

    window.fetch = originalFetch;
  });

  // Live 2026-09-13: postWidgetSession reads the /widget-session body and the
  // widget stops recording before the trace's own clone read finishes. The
  // decision must be taken when the call starts, or that call never shows.
  test("records /widget-session even when its body is read after the sign-in finished", async () => {
    const actual = await vi.importActual("../../lib/davinciWidgetTrace");
    installWidgetTrace.mockImplementation(actual.installWidgetTrace);
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    let releaseCloneRead;
    const cloneRead = new Promise((r) => { releaseCloneRead = r; });
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async () => ({
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => ({ ok: true, username: "demouser" }),
      clone: () => ({ json: async () => { await cloneRead; return { ok: true }; } }),
    }));
    postWidgetSession.mockImplementation(async () => {
      const res = await window.fetch("https://local.ping-devops.com:4000/api/davinci-login/widget-session", { method: "POST" });
      return res.json();
    });
    const onCall = vi.fn();

    try {
      render(<DavinciLoginWidget onCall={onCall} />);
      await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));
      await skRenderScreen.mock.calls[0][1].successCallback({ id_token: "id-1", access_token: "at-1" });
      releaseCloneRead();

      await waitFor(() =>
        expect(onCall).toHaveBeenCalledWith(
          expect.objectContaining({ path: "/api/davinci-login/widget-session", status: 200 }),
        ),
      );
    } finally {
      window.fetch = originalFetch;
    }
  });

  // I3: the app shell (useAuth.js) listens for this one-shot event to flip
  // TopNav and route guards to signed-in.
  test("dispatches userAuthenticated exactly once after a successful sign-in", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    postWidgetSession.mockResolvedValue({ ok: true, username: "demouser" });
    const listener = vi.fn();
    window.addEventListener("userAuthenticated", listener);

    render(<DavinciLoginWidget />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));
    await skRenderScreen.mock.calls[0][1].successCallback({ id_token: "id-1", access_token: "at-1" });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("userAuthenticated", listener);
  });

  test("does not dispatch userAuthenticated when the BFF rejects the sign-in", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    postWidgetSession.mockRejectedValue(new Error("Sign-in tokens failed verification. Restart the sign-in."));
    const listener = vi.fn();
    window.addEventListener("userAuthenticated", listener);

    const { findByText } = render(<DavinciLoginWidget />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));
    await skRenderScreen.mock.calls[0][1].successCallback({ id_token: "id-1", access_token: "at-1" });
    await findByText(/failed verification/i);

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("userAuthenticated", listener);
  });
});
