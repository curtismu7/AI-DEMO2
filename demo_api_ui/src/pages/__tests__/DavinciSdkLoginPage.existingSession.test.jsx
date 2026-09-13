// A browser that already holds a PingOne session gets a COMPLETED flow back from
// the very first authorize call: status "success", an authorization code, no
// screens and no collectors.
//
// History, because each step fixed a real report:
//   1. "success" used to fall through to an EMPTY FORM (heading, nothing else).
//   2. prompt=login was added so the form always showed — but signed in to
//      PingOne as demoAdmin, signing in there as a different user failed with
//      "userSessionMismatch".
//   3. The existing session is REUSED, the page says who it signed in as, and
//      offers Continue or "Sign out of PingOne and use a different account".
//   4. Continue (and a normal form sign-in) no longer leave for the app: a
//      "What just happened" modal explains the steps, and closing it stays on
//      this page. The old destination's "Continue to the app" went home.
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
const MODAL = { name: "What just happened" };

const SUBMIT = {
  category: "ActionCollector",
  type: "SubmitCollector",
  id: "submit-0",
  name: "SIGNON",
  output: { key: "SIGNON", label: "Sign On" },
};

const clientReturning = (node, authorization, errorMessage = null) => ({
  start: vi.fn().mockResolvedValue(node),
  next: vi.fn(),
  update: vi.fn(() => vi.fn(() => null)),
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
    expect(navigateMock).not.toHaveBeenCalled();
    expect(container.querySelector(".dvsdk-form")).toBeNull();
  });

  it("Continue explains what happened in a modal and stays on this page", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, { code: "code-1" }));

    const { findByRole, getByTitle, queryByRole, findByText } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Continue" }));

    const dialog = await findByRole("dialog", MODAL);
    // The reused path's own story: no form, because PingOne already had a session.
    expect(dialog.textContent).toMatch(/already had a session/i);

    fireEvent.click(getByTitle("Close"));
    await waitFor(() => expect(queryByRole("dialog", MODAL)).toBeNull());

    // Still here, signed in — never sent out to the app or home.
    expect(await findByText(/Signed in as/i)).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("a normal form sign-in also explains itself in the modal and stays here", async () => {
    const client = clientReturning({ status: "continue" }, { code: "code-2" });
    client.getCollectors = () => [SUBMIT];
    client.next.mockResolvedValue({ status: "success" });
    sdk.initClient.mockResolvedValue(client);

    const { findByRole } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    await waitFor(() => expect(sdk.postCallback).toHaveBeenCalledWith({
      code: "code-2",
      codeVerifier: "verifier-1",
    }));
    const dialog = await findByRole("dialog", MODAL);
    // The form path's own story: the page rendered the flow's collectors.
    expect(dialog.textContent).toMatch(/collectors/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("the explanation can be reopened after closing it", async () => {
    sdk.initClient.mockResolvedValue(clientReturning({ status: "success" }, { code: "code-1" }));

    const { findByRole, getByTitle, queryByRole } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Continue" }));
    await findByRole("dialog", MODAL);
    fireEvent.click(getByTitle("Close"));
    await waitFor(() => expect(queryByRole("dialog", MODAL)).toBeNull());

    fireEvent.click(await findByRole("button", { name: "What just happened?" }));
    expect(await findByRole("dialog", MODAL)).toBeTruthy();
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
