// The Step Inspector on /davinci-orchestration-sdk is fed by the page itself: after each
// SDK call it records the request the middleware saw, the SDK's cached response
// and the collectors. This drives the captured path, where the flow starts at
// "Sign On" and the "Having trouble signing on?" FlowCollector sends it back to
// DaVinci, which stops at "Enter Username", and checks that each step lands as
// its own card with the right request, answer and collectors.
import React from "react";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
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

const frameLabels = (container) =>
  [...container.querySelectorAll(".sdk-reel-frame strong")].map((frame) => frame.textContent);

describe("DavinciSdkLoginPage Step Inspector", () => {
  let current;
  let client;
  let startStatus;
  let flowStatus;
  let authorizationCode;

  beforeEach(() => {
    vi.clearAllMocks();
    current = SIGN_ON;
    startStatus = "continue";
    flowStatus = "continue";
    authorizationCode = null;
    sdk.fetchSdkConfig.mockResolvedValue({ clientId: "client-1", nonce: "nonce-1" });
    sdk.initClient.mockImplementation(async (_cfg, { onTrace }) => {
      client = {
        // Each call emits what the real requestMiddleware would, then resolves.
        start: vi.fn(async () => {
          onTrace({ source: "http", method: "GET", url: AUTHORIZE, body: null });
          return { status: startStatus };
        }),
        flow: vi.fn(({ action }) => async () => {
          onTrace({
            source: "http",
            method: "POST",
            url: NEXT,
            body: { eventName: "continue", parameters: { eventType: "action", data: { actionKey: action } } },
          });
          current = ENTER_USERNAME;
          return { status: flowStatus };
        }),
        next: vi.fn(),
        update: vi.fn(() => vi.fn(() => null)),
        getCollectors: () => collectorsFor(current),
        getError: () => null,
        getErrorCollectors: () => [],
        getClient: () => (authorizationCode ? { authorization: { code: authorizationCode } } : {}),
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

  it("streams display-safe start and flow evidence to the live reel without changing Step Inspector steps", async () => {
    const { container, findByRole } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    expect(await findByRole("status")).toHaveTextContent(/live execution/i);
    expect(frameLabels(container)).toEqual([
      "SDK starts the flow",
      "DaVinci request",
      "DaVinci returned continue",
      "SDK collector snapshot",
    ]);

    fireEvent.click(await findByRole("button", { name: "Having trouble signing on?" }));

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(2));
    expect(frameLabels(container)).toContain("SDK follows FlowCollector");
    expect(frameLabels(container)).toContain("DaVinci returned continue");
    expect(frameLabels(container)).not.toContain("SDK updates collector");
    expect(container.textContent).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE|INTERACTION-SECRET/);
  });

  it("keeps the collector updater result while masking its live event and records next completion", async () => {
    const updateFailure = { error: { message: "SDK rejected this value" } };
    const { container, findByRole, findByText } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    client.update.mockImplementation(() => vi.fn(() => updateFailure));
    fireEvent.change(await findByRole("textbox", { name: "Username" }), { target: { value: "unmasked-value" } });

    expect(await findByText("SDK rejected this value")).toBeInTheDocument();
    expect(frameLabels(container)).toContain("SDK updates collector");
    expect(container.textContent).not.toContain("unmasked-value");

    client.next.mockResolvedValue({ status: "success" });
    client.getClient = () => ({ authorization: { code: "AUTHORIZATION-CODE" } });
    sdk.postCallback.mockResolvedValue({ username: "demoUser" });
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    await waitFor(() => expect(frameLabels(container)).toContain("SDK completes the callback"));
    expect(frameLabels(container)).toContain("SDK updates and advances form");
    expect(await findByRole("button", { name: "What just happened?" })).toBeTruthy();
    expect(container.textContent).not.toContain("AUTHORIZATION-CODE");
  });

  it("attributes direct start completion to client.start() in the terminal reel evidence", async () => {
    startStatus = "success";
    authorizationCode = "START-AUTHORIZATION-CODE";
    sdk.postCallback.mockResolvedValue({ username: "demoUser" });
    const { container, findByRole } = render(<DavinciSdkLoginPage />);

    const terminal = await findByRole("button", { name: /SDK completes the callback/i });
    fireEvent.click(terminal);
    const detail = await findByRole("region", { name: /Selected frame: SDK completes the callback/i });
    fireEvent.click(within(detail).getByText("Code", { selector: "summary" }));

    expect(detail).toHaveTextContent("client.start");
    expect(detail).not.toHaveTextContent("client.next");
    expect(detail).not.toHaveTextContent("START-AUTHORIZATION-CODE");
  });

  it("attributes FlowCollector completion to client.flow() in the terminal reel evidence", async () => {
    flowStatus = "success";
    authorizationCode = "FLOW-AUTHORIZATION-CODE";
    sdk.postCallback.mockResolvedValue({ username: "demoUser" });
    const { container, findByRole } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    fireEvent.click(await findByRole("button", { name: "Having trouble signing on?" }));
    const terminal = await findByRole("button", { name: /SDK completes the callback/i });
    fireEvent.click(terminal);
    const detail = await findByRole("region", { name: /Selected frame: SDK completes the callback/i });
    fireEvent.click(within(detail).getByText("Code", { selector: "summary" }));

    expect(detail).toHaveTextContent("client.flow");
    expect(detail).not.toHaveTextContent("client.next");
    expect(detail).not.toHaveTextContent("FLOW-AUTHORIZATION-CODE");
  });

  it("adds a masked terminal failure event when the BFF callback rejects", async () => {
    const { container, findByRole, findByText } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    client.next.mockResolvedValue({ status: "success" });
    authorizationCode = "REJECTED-AUTHORIZATION-CODE";
    sdk.postCallback.mockRejectedValue(new Error("BFF callback rejected with secret detail"));
    fireEvent.click(await findByRole("button", { name: "Sign On" }));

    expect(await findByText("BFF callback rejected with secret detail")).toBeInTheDocument();
    const terminal = await findByRole("button", { name: /SDK callback failed/i });
    fireEvent.click(terminal);
    const detail = await findByRole("region", { name: /Selected frame: SDK callback failed/i });

    expect(detail).toHaveTextContent('"status": "failure"');
    expect(detail).not.toHaveTextContent("BFF callback rejected with secret detail");
    expect(detail).not.toHaveTextContent("REJECTED-AUTHORIZATION-CODE");
  });

  it("never puts nonce, state, PKCE or interaction values on the page", async () => {
    const { container } = render(<DavinciSdkLoginPage />);
    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    expect(container.textContent).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE|INTERACTION-SECRET/);
  });

  it("switches between live execution and collapsible lessons while keeping the form available", async () => {
    const { container, findByRole, getByRole, queryByRole } = render(<DavinciSdkLoginPage />);

    await waitFor(() => expect(container.querySelectorAll(".sdkl-step")).toHaveLength(1));
    expect(getByRole("tab", { name: "Execution reel" })).toHaveAttribute("aria-selected", "true");
    expect(getByRole("textbox", { name: "Username" })).toBeInTheDocument();

    fireEvent.click(await findByRole("tab", { name: "Lessons" }));

    expect(getByRole("tab", { name: "Lessons" })).toHaveAttribute("aria-selected", "true");
    expect(queryByRole("tabpanel", { name: "Execution evidence" })).not.toBeInTheDocument();
    expect(getByRole("tabpanel", { name: "Lessons" })).toBeInTheDocument();
    expect(getByRole("textbox", { name: "Username" })).toBeInTheDocument();
  });
});
