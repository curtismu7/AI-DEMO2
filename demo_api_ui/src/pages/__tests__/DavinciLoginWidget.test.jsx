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

  test("successCallback hands the flow's tokens to the BFF, then loads the confirmation page", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    postWidgetSession.mockResolvedValue({ ok: true });

    render(<DavinciLoginWidget />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    await skRenderScreen.mock.calls[0][1].successCallback({
      id_token: "id-1",
      access_token: "at-1",
      sessionToken: "dv-session-1",
    });

    expect(postWidgetSession).toHaveBeenCalledWith({ idToken: "id-1", accessToken: "at-1" });
    expect(assigned).toEqual(["/davinci-login/confirmed"]);
    expect(cookieWrites).toEqual([]);
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

    const { findByText } = render(<DavinciLoginWidget />);
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    skRenderScreen.mock.calls[0][1].errorCallback({ message: "Flow policy not found" });

    await findByText(/flow policy not found/i);
    expect(assigned).toEqual([]);
    expect(postWidgetSession).not.toHaveBeenCalled();
  });
});
