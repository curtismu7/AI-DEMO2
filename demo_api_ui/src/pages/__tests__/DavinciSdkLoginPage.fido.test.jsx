import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));
vi.mock("@forgerock/davinci-client", () => ({ fido: vi.fn() }));
vi.mock("../../lib/davinciSdkClient", () => ({
  fetchSdkConfig: vi.fn(),
  initClient: vi.fn(),
  postCallback: vi.fn(),
  takePkceVerifier: vi.fn(),
  signOutOfPingOne: vi.fn(),
}));
vi.mock("../../utils/passkeyCeremony", () => ({
  authenticateWebAuthn: vi.fn(),
}));

import { fido } from "@forgerock/davinci-client";
import * as sdk from "../../lib/davinciSdkClient";
import { authenticateWebAuthn } from "../../utils/passkeyCeremony";
import DavinciSdkLoginPage from "../DavinciSdkLoginPage";

const options = { challenge: [1, 2, 3], rpId: "ping-devops.com" };
const conditionalOptions = { challenge: [4, 5, 6], rpId: "ping-devops.com" };
const collector = {
  category: "ObjectValueAutoCollector",
  type: "FidoAuthenticationCollector",
  id: "passkey-0",
  name: "passkey",
  error: null,
  input: { key: "passkey", value: {}, type: "FIDO2", validation: null },
  output: { key: "passkey", type: "FIDO2", config: { action: "AUTHENTICATE", trigger: "button", publicKeyCredentialRequestOptions: options } },
};

describe("DavinciSdkLoginPage passkey authentication", () => {
  let client;
  let authenticate;
  let updater;

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate = vi.fn();
    updater = vi.fn(() => null);
    fido.mockReturnValue({ authenticate });
    authenticateWebAuthn.mockResolvedValue({ assertionValue: { id: "credential-conditional" } });
    client = {
      start: vi.fn().mockResolvedValue({ status: "continue" }),
      next: vi.fn().mockResolvedValue({ status: "continue" }),
      update: vi.fn(() => updater),
      getCollectors: vi.fn(() => [collector]),
      getError: vi.fn(() => null),
      getErrorCollectors: vi.fn(() => []),
      cache: { getLatestResponse: vi.fn(() => ({ data: { form: { name: "Passkey", components: { fields: [] } } } })) },
    };
    sdk.fetchSdkConfig.mockResolvedValue({ clientId: "client-1", nonce: "nonce-1" });
    sdk.initClient.mockResolvedValue(client);
  });

  it("updates the SDK with the assertion before advancing, without displaying credential data", async () => {
    const assertion = { assertionValue: { id: "SECRET-CREDENTIAL-ID", response: { signature: "SECRET-SIGNATURE" } } };
    authenticate.mockResolvedValue(assertion);
    const { container, findByRole } = render(<DavinciSdkLoginPage />);

    fireEvent.click(await findByRole("button", { name: "Use passkey" }));

    await waitFor(() => expect(client.next).toHaveBeenCalledTimes(1));
    expect(authenticate).toHaveBeenCalledWith(options);
    expect(client.update).toHaveBeenCalledWith(collector);
    expect(updater).toHaveBeenCalledWith(assertion);
    expect(updater.mock.invocationCallOrder[0]).toBeLessThan(client.next.mock.invocationCallOrder[0]);
    expect(container).not.toHaveTextContent(/SECRET-CREDENTIAL-ID|SECRET-SIGNATURE/);
  });

  it("shows a WebAuthn failure and does not advance the flow", async () => {
    authenticate.mockResolvedValue({ type: "fido_error", error: "authentication_error", message: "FIDO authentication failed" });
    const { findByRole, findByText } = render(<DavinciSdkLoginPage />);

    fireEvent.click(await findByRole("button", { name: "Use passkey" }));

    expect(await findByText("FIDO authentication failed")).toBeInTheDocument();
    expect(client.next).not.toHaveBeenCalled();
    expect(updater).not.toHaveBeenCalled();
    expect(await findByRole("button", { name: "Use passkey" })).not.toBeDisabled();
  });

  it("does not advance when the SDK rejects the assertion update", async () => {
    const assertion = { assertionValue: { id: "SECRET-CREDENTIAL-ID" } };
    authenticate.mockResolvedValue(assertion);
    updater.mockReturnValue({ error: { message: "Assertion rejected" }, type: "internal_error" });
    const { findByRole, findByText } = render(<DavinciSdkLoginPage />);

    fireEvent.click(await findByRole("button", { name: "Use passkey" }));

    expect(await findByText("Assertion rejected")).toBeInTheDocument();
    expect(updater).toHaveBeenCalledWith(assertion);
    expect(client.next).not.toHaveBeenCalled();
  });

  it("starts conditional WebAuthn from an opted-in username collector", async () => {
    const conditionalCollector = {
      ...collector,
      type: "TextCollector",
      category: "SingleValueCollector",
      id: "username-0",
      name: "username",
      input: { key: "username", value: "", type: "TEXT" },
      output: {
        key: "username",
        label: "Username",
        type: "TEXT",
        autocomplete: "username",
        enableConditionalWebAuthn: true,
        conditionalWebAuthn: { publicKeyCredentialRequestOptions: conditionalOptions },
      },
    };
    client.cache.getLatestResponse.mockReturnValue({
      data: {
        form: {
          components: {
            fields: [{
              key: "username",
              type: "TEXT",
              autocomplete: "username",
              enableConditionalWebAuthn: true,
              conditionalWebAuthn: { publicKeyCredentialRequestOptions: conditionalOptions },
            }],
          },
        },
      },
    });
    // The SDK reducer drops unknown Forms metadata; the page must enrich the
    // SDK collector from the raw response before rendering it.
    client.getCollectors.mockReturnValue([{
      ...conditionalCollector,
      output: { key: "username", label: "Username", type: "TEXT" },
    }]);
    render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(authenticateWebAuthn).toHaveBeenCalledWith(conditionalOptions, expect.objectContaining({ mediation: "conditional" })));
    expect(client.update).toHaveBeenCalledWith(conditionalCollector);
    expect(client.next).toHaveBeenCalled();
  });
});
