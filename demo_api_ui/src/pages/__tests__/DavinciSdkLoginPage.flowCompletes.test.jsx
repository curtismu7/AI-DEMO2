// A flow button can finish a DaVinci flow, not only branch it. A success screen
// built like Ping's own ("Continue" with data-skbuttontype="next-event") reaches
// the SDK as a FlowCollector, and clicking it can return the COMPLETED node.
// The page handled success only after next(), so a completed flow() call fell
// through to an empty form and the authorization code never reached the BFF.
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

const CONTINUE = {
  category: "ActionCollector",
  type: "FlowCollector",
  id: "NEXT-0",
  name: "NEXT",
  output: { key: "NEXT", label: "Continue" },
};

describe("DavinciSdkLoginPage when a flow button completes the flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.fetchSdkConfig.mockResolvedValue({ clientId: "client-1", nonce: "nonce-1" });
    sdk.takePkceVerifier.mockReturnValue("verifier-1");
    sdk.postCallback.mockResolvedValue({ ok: true, username: "customer1" });
  });

  it("finishes the sign-in: the code goes to the BFF and the page shows signed in", async () => {
    const client = {
      start: vi.fn().mockResolvedValue({ status: "continue" }),
      flow: vi.fn(() => vi.fn().mockResolvedValue({ status: "success" })),
      next: vi.fn(),
      update: vi.fn(() => vi.fn(() => null)),
      getClient: () => ({ authorization: { code: "code-9" } }),
      getCollectors: () => [CONTINUE],
      getError: () => null,
      getErrorCollectors: () => [],
    };
    sdk.initClient.mockResolvedValue(client);

    const { findByRole, container } = render(<DavinciSdkLoginPage />);
    fireEvent.click(await findByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(sdk.postCallback).toHaveBeenCalledWith({ code: "code-9", codeVerifier: "verifier-1" }),
    );
    expect(client.flow).toHaveBeenCalledWith({ action: "NEXT" });
    expect(client.next).not.toHaveBeenCalled();
    // Signed in: the run summary opens, and the empty form is gone. ("Signed in
    // as" would match both the page panel and the modal's lede.)
    expect(await findByRole("dialog", { name: "What just happened" })).toBeTruthy();
    expect(container.querySelector(".dvsdk-form")).toBeNull();
  });
});
