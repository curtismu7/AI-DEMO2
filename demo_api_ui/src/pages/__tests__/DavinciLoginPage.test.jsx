import { render, waitFor, screen, fireEvent } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import DavinciLoginPage from "../DavinciLoginPage";

// Identifier-first: the flow declares `username` in its Input Schema, so the
// page collects one before the BFF can mint an SDK token. The page must then
// render the DaVinci flow with that config, and on success follow the BFF's
// authorize URL — that hop is what turns the widget's
// sessionToken into an OIDC code carrying the nonce /api/davinci-login/callback
// verifies. Dropping it leaves the user authenticated to DaVinci but never
// signed in to the demo, so these tests pin the wiring.

vi.mock("../../lib/davinciWidgetClient", () => ({
  loadWidget: vi.fn(),
  fetchWidgetConfig: vi.fn(),
}));

import { loadWidget, fetchWidgetConfig } from "../../lib/davinciWidgetClient";

const CONFIG = {
  accessToken: "sdk-tok-1",
  companyId: "co-1",
  policyId: "pol-v1",
  flowVersion: "v1",
  apiRoot: "https://auth.pingone.com/",
  authorizeUrl: "https://auth.pingone.com/env-1/as/authorize?nonce=abc123",
};

let assigned;
let cookieWrites;
const originalLocation = window.location;

beforeEach(() => {
  assigned = [];
  cookieWrites = [];
  delete window.location;
  window.location = { assign: (url) => assigned.push(url), search: "" };
  // jsdom serves the test page over http and silently drops a `secure` cookie,
  // so spy the setter rather than reading document.cookie back — that also lets
  // the assertion below pin the secure flag itself.
  vi.spyOn(document, "cookie", "set").mockImplementation((v) => cookieWrites.push(v));
  fetchWidgetConfig.mockResolvedValue(CONFIG);
});

afterEach(() => {
  window.location = originalLocation;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function submitUsername(name) {
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("DavinciLoginPage widget rendering", () => {
  test("does not start the flow until a username is supplied", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });

    render(<DavinciLoginPage />);

    // The BFF rejects a tokenless-username request with 400, so starting the
    // widget before the field is filled would just burn a round trip.
    expect(fetchWidgetConfig).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  test("renders the flow with the BFF-minted SDK token and policy", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });

    render(<DavinciLoginPage />);
    submitUsername("demouser");

    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));
    expect(fetchWidgetConfig).toHaveBeenCalledWith("demouser");
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

  test("successCallback stores the DaVinci session and follows the BFF authorize URL", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });

    render(<DavinciLoginPage />);
    submitUsername("demouser");
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    skRenderScreen.mock.calls[0][1].successCallback({ sessionToken: "dv-session-1" });

    expect(cookieWrites).toHaveLength(1);
    expect(cookieWrites[0]).toContain("DV-ST=dv-session-1");
    // A DaVinci session token must never ride an unencrypted request.
    expect(cookieWrites[0]).toContain("secure");
    // Without this hop there is no OIDC code and no session — the whole point.
    expect(assigned).toEqual([CONFIG.authorizeUrl]);
  });

  test("shows an error and does not render the flow when the BFF will not mint a token", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });
    fetchWidgetConfig.mockRejectedValue(new Error("DaVinci demo is not configured."));

    const { findByText } = render(<DavinciLoginPage />);
    submitUsername("demouser");

    await findByText(/not configured/i);
    expect(skRenderScreen).not.toHaveBeenCalled();
  });

  test("errorCallback surfaces the flow failure instead of redirecting", async () => {
    const skRenderScreen = vi.fn();
    loadWidget.mockResolvedValue({ skRenderScreen });

    const { findByText } = render(<DavinciLoginPage />);
    submitUsername("demouser");
    await waitFor(() => expect(skRenderScreen).toHaveBeenCalledTimes(1));

    skRenderScreen.mock.calls[0][1].errorCallback({ message: "Flow policy not found" });

    await findByText(/flow policy not found/i);
    expect(assigned).toEqual([]);
  });
});
