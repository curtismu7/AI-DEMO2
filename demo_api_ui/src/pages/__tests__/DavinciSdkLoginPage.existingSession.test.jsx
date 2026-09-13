// A browser that already holds a PingOne session gets a COMPLETED flow back
// from the very first authorize call: status "success", an authorization code,
// no screens and no collectors. The page used to handle only "failure" there,
// so "success" fell through to "collecting" with zero collectors and rendered
// an empty form — heading and subtitle, nothing else. Reported from a
// screenshot while signed in as Demo Admin.
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));

vi.mock("../../lib/davinciSdkClient", () => ({
  fetchSdkConfig: vi.fn(),
  initClient: vi.fn(),
  postCallback: vi.fn(),
  takePkceVerifier: vi.fn(),
}));

import * as sdk from "../../lib/davinciSdkClient";
import DavinciSdkLoginPage from "../DavinciSdkLoginPage";

const CFG = { clientId: "client-1", nonce: "nonce-1" };

const clientReturning = (node, authorization) => ({
  start: vi.fn().mockResolvedValue(node),
  getClient: () => ({ authorization }),
  getCollectors: () => [],
  getError: () => null,
  getErrorCollectors: () => [],
});

describe("DavinciSdkLoginPage when PingOne already has a session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.fetchSdkConfig.mockResolvedValue(CFG);
    sdk.takePkceVerifier.mockReturnValue("verifier-1");
    sdk.postCallback.mockResolvedValue({ ok: true });
  });

  it("asks PingOne to run the flow's screens even when a session already exists", async () => {
    // Measured against the live environment in one signed-in browser:
    //   no prompt      -> status COMPLETED + authorization code, no screens
    //   prompt=login   -> a real DaVinci screen (customHTMLTemplate), no code
    // This page exists to SHOW the collectors, so a presenter who is already
    // signed in must still get the form rather than be waved straight through.
    const client = clientReturning({ status: "continue" }, undefined);
    sdk.initClient.mockResolvedValue(client);

    render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(client.start).toHaveBeenCalled());
    expect(client.start).toHaveBeenCalledWith({ query: { nonce: "nonce-1", prompt: "login" } });
  });

  it("finishes sign-in on an instant success instead of rendering an empty form", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, { code: "code-1" }));

    const { container } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(sdk.postCallback).toHaveBeenCalledWith({
      code: "code-1",
      codeVerifier: "verifier-1",
    }));
    expect(navigateMock).toHaveBeenCalledWith("/davinci-login/confirmed", { replace: true });
    // The reported defect, asserted directly: no collector form with nothing in it.
    expect(container.querySelector(".dvsdk-form")).toBeNull();
  });

  it("shows an error, not a blank page, if that success carries no code", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, undefined));

    const { container, findByText } = render(<DavinciSdkLoginPage />);

    expect(await findByText("The flow succeeded but returned no authorization code.")).toBeTruthy();
    expect(sdk.postCallback).not.toHaveBeenCalled();
    expect(container.querySelector(".dvsdk-form")).toBeNull();
  });
});
