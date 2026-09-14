// Step Inspector: the live, per-step lesson on /davinci-sdk-login.
//
// Fixtures follow the shapes captured from the live flow on 2026-09-13: the
// "Sign On" form, the "Having trouble signing on?" FlowCollector branch, and the
// "Enter Username" form DaVinci stopped at next. Promises pinned here:
//   - every step shows the code, the request, the answer and the collectors
//   - nonce, state, PKCE, interaction ids and codes never reach the page
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StepInspector, {
  requestShape,
  responseShape,
  stepCode,
  stepTitle,
  summarizeResponse,
} from "../StepInspector";

const AUTHORIZE =
  "https://auth.pingone.com/env-1/as/authorize?client_id=client-1&response_type=code" +
  "&code_challenge=CHALLENGEVALUE&code_challenge_method=S256&state=STATEVALUE" +
  "&response_mode=pi.flow&nonce=SECRETNONCE";
const NEXT = "https://auth.pingone.com/env-1/davinci/connections/conn-1/capabilities/customHTMLTemplate";

const SIGN_ON = {
  id: "ID-SECRET",
  interactionId: "INTERACTION-SECRET",
  eventName: "continue",
  capabilityName: "customHTMLTemplate",
  form: {
    name: "Sign On",
    components: {
      fields: [
        { type: "TEXT", key: "username", label: "Username" },
        { type: "PASSWORD", key: "password", label: "Password" },
        { type: "SUBMIT_BUTTON", key: "SIGNON", label: "Sign On" },
        { type: "FLOW_BUTTON", key: "TROUBLE", label: "Having trouble signing on?" },
      ],
    },
  },
  _links: { next: { href: `${NEXT}?x=LINKSECRET` }, self: { href: NEXT } },
};

const ENTER_USERNAME = {
  ...SIGN_ON,
  form: {
    name: "Enter Username",
    components: {
      fields: [
        { type: "TEXT", key: "username", label: "Username" },
        { type: "SUBMIT_BUTTON", key: "CONTINUE", label: "Continue" },
        { type: "FLOW_BUTTON", key: "CANCEL", label: "Back" },
      ],
    },
  },
};

const collectorsOf = (form) =>
  form.form.components.fields.map((f) => ({
    key: f.key,
    label: f.label,
    ...{
      TEXT: { type: "TextCollector", category: "SingleValueCollector" },
      PASSWORD: { type: "PasswordCollector", category: "SingleValueCollector" },
      SUBMIT_BUTTON: { type: "SubmitCollector", category: "ActionCollector" },
      FLOW_BUTTON: { type: "FlowCollector", category: "ActionCollector" },
    }[f.type],
  }));

const STEPS = [
  {
    kind: "start",
    request: { source: "http", method: "GET", url: AUTHORIZE, body: null },
    response: summarizeResponse(SIGN_ON),
    nodeStatus: "continue",
    collectors: collectorsOf(SIGN_ON),
  },
  {
    kind: "flow",
    trigger: { type: "FlowCollector", key: "TROUBLE", label: "Having trouble signing on?" },
    request: {
      source: "http",
      method: "POST",
      url: NEXT,
      body: { id: "…", eventName: "continue", interactionId: "…", parameters: { eventType: "action", data: { actionKey: "TROUBLE" } } },
    },
    response: summarizeResponse(ENTER_USERNAME),
    nodeStatus: "continue",
    collectors: collectorsOf(ENTER_USERNAME),
  },
];

describe("shaping what the inspector shows", () => {
  it("summarizes a form response and keeps its fields in order", () => {
    const s = summarizeResponse(SIGN_ON);
    expect(s.formName).toBe("Sign On");
    expect(s.fields.map((f) => `${f.type} ${f.key}`)).toEqual([
      "TEXT username",
      "PASSWORD password",
      "SUBMIT_BUTTON SIGNON",
      "FLOW_BUTTON TROUBLE",
    ]);
    expect(s.links).toEqual(["next", "self"]);
  });

  it("hides ids, link targets and authorization values in the shape it prints", () => {
    const form = JSON.stringify(responseShape(summarizeResponse(SIGN_ON)));
    expect(form).not.toMatch(/ID-SECRET|INTERACTION-SECRET|LINKSECRET/);
    expect(form).toContain('"interactionId":"…"');

    const done = responseShape(
      summarizeResponse({ status: "COMPLETED", capabilityName: "returnSuccessResponseRedirect", authorizeResponse: { code: "CODE-SECRET", state: "S" } }),
    );
    expect(done).toEqual({
      status: "COMPLETED",
      capabilityName: "returnSuccessResponseRedirect",
      authorizeResponse: { code: "…", state: "…" },
    });
  });

  it("keeps only parameter names from the authorize URL", () => {
    const r = requestShape(STEPS[0].request);
    expect(r.responseMode).toBe("pi.flow");
    expect(r.paramNames).toEqual(expect.arrayContaining(["nonce", "state", "code_challenge"]));
    expect(JSON.stringify({ ...r, responseMode: null })).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE/);
  });

  it("names each step by what the user did and where the flow stopped", () => {
    expect(stepTitle(STEPS[0])).toBe('The flow starts → form "Sign On"');
    expect(stepTitle(STEPS[1])).toBe('You clicked "Having trouble signing on?" (FlowCollector) → form "Enter Username"');
  });

  it("writes copyable code for a branch and for a submit", () => {
    expect(stepCode(STEPS[1])).toContain('const node = await client.flow({ action: "TROUBLE" })();');

    const submit = stepCode({
      kind: "next",
      trigger: { type: "SubmitCollector", key: "SIGNON", label: "Sign On" },
      request: { body: { parameters: { eventType: "submit", data: { actionKey: "SIGNON", formData: { username: "…", password: "…" } } } } },
    });
    expect(submit).toContain('client.update(collectorFor("username"))(value);');
    expect(submit).toContain('client.update(collectorFor("password"))(value);');
    expect(submit).toContain("const node = await client.next();");
  });
});

describe("StepInspector", () => {
  it("shows the start, the branch back to DaVinci, and the form it stopped at", () => {
    const { container } = render(<StepInspector steps={STEPS} />);
    const cards = container.querySelectorAll(".sdkl-step");
    expect(cards).toHaveLength(2);

    // Step 1: pi.flow verified off the real request, and the first form's collectors.
    expect(cards[0].querySelector(".lesson-ok").textContent).toBe("✓ response_mode=pi.flow");
    expect(cards[0].textContent).toContain("PasswordCollector");

    // Step 2: what the FlowCollector sent, and the next form's fields → collectors.
    expect(cards[1].textContent).toContain('"actionKey": "TROUBLE"');
    expect(cards[1].textContent).toContain('"eventType": "action"');
    expect(cards[1].textContent).toContain("Enter Username");
    expect(cards[1].textContent).toMatch(/stopped and returned that form/);
  });

  it("never renders nonce, state, PKCE or interaction values", () => {
    const { container } = render(<StepInspector steps={STEPS} />);
    expect(container.textContent).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE|INTERACTION-SECRET|ID-SECRET|LINKSECRET/);
  });

  it("says what to expect before the first step", () => {
    const { container } = render(<StepInspector steps={[]} />);
    expect(container.textContent).toMatch(/No steps yet/);
  });
});
