// After an SDK sign-in the page shows WHO signed in: username, PingOne user id
// and email. The DaVinci flow's success screen can display them in hosted and
// widget mode, but pi.flow hands the SDK only that screen's form fields, so the
// page reads them from the BFF's /callback response instead.
import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

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

const client = (startNode) => ({
  start: vi.fn().mockResolvedValue(startNode),
  next: vi.fn().mockResolvedValue({ status: "success" }),
  update: vi.fn(() => vi.fn(() => null)),
  getClient: () => ({ authorization: { code: "code-1" } }),
  getCollectors: () => [SUBMIT],
  getError: () => null,
  getErrorCollectors: () => [],
});

const profileText = (container) => container.querySelector(".dvsdk-profile")?.textContent || "";

describe("DavinciSdkLoginPage shows who signed in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.fetchSdkConfig.mockResolvedValue({ clientId: "client-1", nonce: "nonce-1" });
    sdk.takePkceVerifier.mockReturnValue("verifier-1");
  });

  it("lists username, PingOne user id and email after a form sign-in", async () => {
    sdk.initClient.mockResolvedValue(client({ status: "continue" }));
    sdk.postCallback.mockResolvedValue({
      ok: true,
      username: "customer1",
      userId: "p1-user-123",
      email: "customer1@example.com",
    });

    const { findByRole, container } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    await waitFor(() => expect(container.querySelector(".dvsdk-profile")).toBeTruthy());
    const text = profileText(container);
    expect(text).toContain("customer1");
    expect(text).toContain("p1-user-123");
    expect(text).toContain("customer1@example.com");
  });

  it("carries the same details through the existing-session path", async () => {
    sdk.initClient.mockResolvedValue(client({ status: "success" }));
    sdk.postCallback.mockResolvedValue({
      ok: true,
      username: "demoAdmin",
      userId: "p1-admin-9",
      email: "admin@example.com",
    });

    const { findByRole, container } = render(<DavinciSdkLoginPage />);
    // The reused panel names the user before they choose to continue.
    const continueBtn = await findByRole("button", { name: "Continue" });
    expect(container.querySelector(".dvsdk-notice strong")?.textContent).toBe("demoAdmin");
    fireEvent.click(continueBtn);

    await waitFor(() => expect(container.querySelector(".dvsdk-profile")).toBeTruthy());
    expect(profileText(container)).toContain("p1-admin-9");
    expect(profileText(container)).toContain("admin@example.com");
  });

  it("says an email is not set rather than leaving the row blank", async () => {
    sdk.initClient.mockResolvedValue(client({ status: "continue" }));
    sdk.postCallback.mockResolvedValue({ ok: true, username: "customer1", userId: "p1-user-123", email: null });

    const { findByRole, container } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    await waitFor(() => expect(profileText(container)).toContain("Not set"));
  });
});
