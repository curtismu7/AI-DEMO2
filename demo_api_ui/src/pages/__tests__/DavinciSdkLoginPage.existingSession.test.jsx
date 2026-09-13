// A browser that already holds a PingOne session gets a COMPLETED flow back from
// the very first authorize call: status "success", an authorization code, no
// screens and no collectors.
//
// History, because each step fixed a real report:
//   1. "success" used to fall through to an EMPTY FORM (heading, nothing else).
//   2. prompt=login was added so the form always showed — but signed in to
//      PingOne as demoAdmin, signing in there as a different user failed with
//      "userSessionMismatch".
//   3. Now: the existing session is REUSED, the page says who it signed in as,
//      and offers Continue or "Sign out of PingOne and use a different account".
import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));

vi.mock("../../lib/davinciSdkClient", () => ({
  fetchSdkConfig: vi.fn(),
  initClient: vi.fn(),
  postCallback: vi.fn(),
  takePkceVerifier: vi.fn(),
  signOutOfPingOne: vi.fn(),
}));

import * as sdk from "../../lib/davinciSdkClient";
import DavinciSdkLoginPage from "../DavinciSdkLoginPage";

const CFG = { clientId: "client-1", nonce: "nonce-1" };
const SIGN_OUT = "Sign out of PingOne and use a different account";

const clientReturning = (node, authorization, errorMessage = null) => ({
  start: vi.fn().mockResolvedValue(node),
  getClient: () => ({ authorization }),
  getCollectors: () => [],
  getError: () => (errorMessage ? { message: errorMessage } : null),
  getErrorCollectors: () => [],
});

describe("DavinciSdkLoginPage when PingOne already has a session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.fetchSdkConfig.mockResolvedValue(CFG);
    sdk.takePkceVerifier.mockReturnValue("verifier-1");
    sdk.postCallback.mockResolvedValue({ ok: true, username: "demoAdmin" });
    sdk.signOutOfPingOne.mockResolvedValue("https://auth.example/as/signoff");
  });

  it("does NOT force prompt=login, so an existing PingOne session is reused", async () => {
    const client = clientReturning({ status: "continue" }, undefined);
    sdk.initClient.mockResolvedValue(client);

    render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(client.start).toHaveBeenCalled());
    expect(client.start).toHaveBeenCalledWith({ query: { nonce: "nonce-1" } });
    expect(client.start.mock.calls[0][0].query).not.toHaveProperty("prompt");
  });

  it("reuses the session and says who it signed in as, instead of an empty form", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, { code: "code-1" }));

    const { container, findByText } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(sdk.postCallback).toHaveBeenCalledWith({
      code: "code-1",
      codeVerifier: "verifier-1",
    }));
    expect(await findByText("demoAdmin")).toBeTruthy();
    // Stays on the page to offer the choice — does not jump into the app.
    expect(navigateMock).not.toHaveBeenCalled();
    expect(container.querySelector(".dvsdk-form")).toBeNull();
  });

  it("Continue goes into the app as the reused user", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, { code: "code-1" }));

    const { findByRole } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Continue" }));

    expect(navigateMock).toHaveBeenCalledWith("/davinci-login/confirmed", { replace: true });
  });

  it("offers to sign out of PingOne to switch to a different account", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, { code: "code-1" }));

    const { findByRole } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: SIGN_OUT }));

    await waitFor(() => expect(sdk.signOutOfPingOne).toHaveBeenCalledWith(CFG));
  });

  it("offers the same sign-out, not a bare error code, on userSessionMismatch", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "failure" }, undefined, "userSessionMismatch"));

    const { findByRole } = render(<DavinciSdkLoginPage />);

    expect(await findByRole("button", { name: SIGN_OUT })).toBeTruthy();
  });

  it("shows an error, not a blank page, if a success carries no code", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, undefined));

    const { container, findByText } = render(<DavinciSdkLoginPage />);

    expect(await findByText("The flow succeeded but returned no authorization code.")).toBeTruthy();
    expect(sdk.postCallback).not.toHaveBeenCalled();
    expect(container.querySelector(".dvsdk-form")).toBeNull();
  });
});
