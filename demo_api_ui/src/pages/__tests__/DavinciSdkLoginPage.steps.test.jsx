// The Step Inspector on /davinci-sdk-login is fed by the page itself: after each
// SDK call it records the request the middleware saw, the SDK's cached response
// and the collectors. This drives the captured path, where the flow starts at
// "Sign On" and the "Having trouble signing on?" FlowCollector sends it back to
// DaVinci, which stops at "Enter Username", and checks that each step lands as
// its own card with the right request, answer and collectors.
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
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

const AUTHORIZE =
  "https://auth.pingone.com/env-1/as/authorize?client_id=client-1&state=STATEVALUE&code_challenge=CHALLENGEVALUE&response_mode=pi.flow&nonce=SECRETNONCE";
const NEXT = "https://auth.pingone.com/env-1/davinci/connections/conn-1/capabilities/customHTMLTemplate";

const form = (name, fields) => ({
  interactionId: "INTERACTION-SECRET",
  eventName: "continue",
  capabilityName: "customHTMLTemplate",
  form: { name, components: { fields } },
  _links: { next: { href: NEXT } },
});

const SIGN_ON = form("Sign On", [
  { type: "TEXT", key: "username", label: "Username" },
  { type: "SUBMIT_BUTTON", key: "SIGNON", label: "Sign On" },
  { type: "FLOW_BUTTON", key: "TROUBLE", label: "Having trouble signing on?" },
]);
const ENTER_USERNAME = form("Enter Username", [
  { type: "TEXT", key: "username", label: "Username" },
  { type: "SUBMIT_BUTTON", key: "CONTINUE", label: "Continue" },
  { type: "FLOW_BUTTON", key: "CANCEL", label: "Back" },
]);

const TYPES = {
  TEXT: ["TextCollector", "SingleValueCollector"],
  SUBMIT_BUTTON: ["SubmitCollector", "ActionCollector"],
  FLOW_BUTTON: ["FlowCollector", "ActionCollector"],
};
const collectorsFor = (data) =>
  data.form.components.fields.map((f, i) => ({
    type: TYPES[f.type][0],
    category: TYPES[f.type][1],
    id: `${f.key}-${i}`,
    name: f.key,
    input: { key: f.key, value: "" },
    output: { key: f.key, label: f.label },
  }));

describe("DavinciSdkLoginPage Step Inspector", () => {
  let current;
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    current = SIGN_ON;
    sdk.fetchSdkConfig.mockResolvedValue({ clientId: "client-1", nonce: "nonce-1" });
    sdk.initClient.mockImplementation(async (_cfg, { onTrace }) => {
      client = {
        // Each call emits what the real requestMiddleware would, then resolves.
        start: vi.fn(async () => {
          onTrace({ source: "http", method: "GET", url: AUTHORIZE, body: null });
          return { status: "continue" };
        }),
        flow: vi.fn(({ action }) => async () => {
          onTrace({
            source: "http",
            method: "POST",
            url: NEXT,
            body: { eventName: "continue", parameters: { eventType: "action", data: { actionKey: action } } },
          });
          current = ENTER_USERNAME;
          return { status: "continue" };
        }),
        next: vi.fn(),
        update: vi.fn(() => vi.fn(() => null)),
        getCollectors: () => collectorsFor(current),
        getError: () => null,
        getErrorCollectors: () => [],
        getClient: () => ({}),
        cache: { getLatestResponse: () => ({ data: current }) },
      };
      return client;
    });
  });

  it("adds one card per SDK call: the start, then the branch to the next form", async () => {
    const { container, findByRole } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    const first = container.querySelectorAll(".sdkl-step")[0];
    expect(first.querySelector(".sdkl-step-title").textContent).toBe('Step 1: The flow starts → form "Sign On"');
    expect(first.textContent).toContain("✓ response_mode=pi.flow");

    fireEvent.click(await findByRole("button", { name: "Having trouble signing on?" }));

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(2));
    expect(client.flow).toHaveBeenCalledWith({ action: "TROUBLE" });
    const second = container.querySelectorAll(".sdkl-step")[1];
    expect(second.querySelector(".sdkl-step-title").textContent).toBe(
      'Step 2: You clicked "Having trouble signing on?" (FlowCollector) → form "Enter Username"',
    );
    expect(second.textContent).toContain('"actionKey": "TROUBLE"');
    expect(second.textContent).toContain("FlowCollector");

    // The page itself now shows the form DaVinci stopped at.
    expect(await findByRole("button", { name: "Back" })).toBeTruthy();
  });

  it("never puts nonce, state, PKCE or interaction values on the page", async () => {
    const { container } = render(<DavinciSdkLoginPage />);
    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    expect(container.textContent).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE|INTERACTION-SECRET/);
  });
});
