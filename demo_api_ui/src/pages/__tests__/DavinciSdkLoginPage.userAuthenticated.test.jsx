// A sign-in on /davinci-sdk-login stays on the page, so nothing reloads the app
// shell. useAuth (and through it TopNav and the route guards) re-checks the BFF
// session only when "userAuthenticated" fires. Without it the page said "You're
// signed in" while the TopNav still offered Sign In until a manual reload.
// Found in review of the widget lesson, which had the same gap.
import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));

vi.mock("../../lib/davinciSdkClient", () => ({
  fetchSdkConfig: vi.fn(),
  initClient: vi.fn(),
  postCallback: vi.fn(),
  takePkceVerifier: vi.fn(),
  signOutOfPingOne: vi.fn(),
}));

import * as sdk from "../../lib/davinciSdkClient";
import DavinciSdkLoginPage from "../DavinciSdkLoginPage";

const SUBMIT = {
  category: "ActionCollector",
  type: "SubmitCollector",
  id: "SIGNON-2",
  name: "SIGNON",
  output: { key: "SIGNON", label: "Sign On" },
};

const formClient = () => ({
  start: vi.fn().mockResolvedValue({ status: "continue" }),
  next: vi.fn().mockResolvedValue({ status: "success" }),
  update: vi.fn(() => vi.fn(() => null)),
  getClient: () => ({ authorization: { code: "code-1" } }),
  getCollectors: () => [SUBMIT],
  getError: () => null,
  getErrorCollectors: () => [],
});

describe("DavinciSdkLoginPage tells the app shell about a new session", () => {
  const onAuthenticated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.addEventListener("userAuthenticated", onAuthenticated);
    sdk.fetchSdkConfig.mockResolvedValue({ clientId: "client-1", nonce: "nonce-1" });
    sdk.takePkceVerifier.mockReturnValue("verifier-1");
  });

  afterEach(() => {
    window.removeEventListener("userAuthenticated", onAuthenticated);
  });

  it("dispatches userAuthenticated once, after the BFF accepts the code", async () => {
    sdk.initClient.mockResolvedValue(formClient());
    sdk.postCallback.mockResolvedValue({ ok: true, username: "customer1" });

    const { findByRole } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(sdk.postCallback).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch it when the BFF rejects the sign-in", async () => {
    sdk.initClient.mockResolvedValue(formClient());
    sdk.postCallback.mockRejectedValue(new Error("No demo user found."));

    const { findByRole, findByText } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    expect(await findByText("No demo user found.")).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
