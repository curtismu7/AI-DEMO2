// SdkWalkthrough: the short "What just happened" summary shown after a sign-in.
//
// It reports what ACTUALLY happened on the run, from the page's SDK trace,
// including whether response_mode=pi.flow was really on the authorize request,
// and never leaks nonce, state, PKCE or code values while doing it. The teaching
// itself lives in the page's lesson sections, which this links into.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import SdkWalkthrough, { summarizeTrace } from "../SdkWalkthrough";

const AUTHORIZE =
  "https://auth.pingone.com/env-1/as/authorize?client_id=client-1&response_type=code" +
  "&scope=openid&redirect_uri=https%3A%2F%2Fapp%2Fdavinci-sdk-login&code_challenge=CHALLENGEVALUE" +
  "&code_challenge_method=S256&state=STATEVALUE&response_mode=pi.flow&nonce=SECRETNONCE";
const NEXT = "https://auth.pingone.com/env-1/davinci/connections/abc123/capabilities/customHTMLTemplate";

const FORM_TRACE = [
  { source: "http", method: "GET", url: AUTHORIZE },
  {
    source: "state",
    status: "continue",
    collectors: [
      { category: "SingleValueCollector", type: "TextCollector", name: "username", key: "username" },
      { category: "SingleValueCollector", type: "PasswordCollector", name: "password", key: "password" },
      { category: "ActionCollector", type: "SubmitCollector", name: "SIGNON", key: "SIGNON" },
    ],
  },
  { source: "state", status: "continue", collectors: [] },
  { source: "http", method: "POST", url: NEXT },
  { source: "state", status: "success", collectors: [] },
  { source: "logger", level: "debug", parts: ["Davinci API request"] },
];

describe("summarizeTrace", () => {
  it("finds the authorize request and confirms pi.flow was on the wire", () => {
    const run = summarizeTrace(FORM_TRACE);
    expect(run.authorize.path).toBe("/env-1/as/authorize");
    expect(run.piFlowOnWire).toBe(true);
    expect(run.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /env-1/as/authorize",
      "POST /env-1/davinci/connections/abc123/capabilities/customHTMLTemplate",
    ]);
  });

  it("keeps parameter NAMES only — never nonce, state or PKCE values", () => {
    const run = summarizeTrace(FORM_TRACE);
    expect(run.authorize.params).toEqual(
      expect.arrayContaining(["response_mode", "nonce", "state", "code_challenge"]),
    );
    const serialized = JSON.stringify({ ...run, authorize: { ...run.authorize, responseMode: null } });
    expect(serialized).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE/);
  });

  it("dedupes collectors across state updates and collapses repeated statuses", () => {
    const run = summarizeTrace(FORM_TRACE);
    expect(run.collectors.map((c) => c.type)).toEqual(["TextCollector", "PasswordCollector", "SubmitCollector"]);
    expect(run.statuses).toEqual(["continue", "success"]);
  });

  it("flags an authorize request that did NOT use pi.flow", () => {
    const run = summarizeTrace([
      { source: "http", method: "GET", url: AUTHORIZE.replace("response_mode=pi.flow", "response_mode=query") },
    ]);
    expect(run.piFlowOnWire).toBe(false);
    expect(run.authorize.responseMode).toBe("query");
  });

  it("is safe with no trace at all", () => {
    expect(summarizeTrace(undefined)).toEqual({
      calls: [],
      collectors: [],
      statuses: [],
      authorize: null,
      piFlowOnWire: false,
    });
  });
});

describe("SdkWalkthrough", () => {
  it("reports pi.flow as verified from the actual request on this run", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    const run = container.querySelector(".lesson-run");
    expect(run.querySelector(".lesson-ok").textContent).toMatch(/pi\.flow, read off the actual \/as\/authorize request/);
    expect(run.textContent).toMatch(/continue → success/);
  });

  it("warns, rather than claiming pi.flow, when the request used another response mode", () => {
    const trace = [{ source: "http", method: "GET", url: AUTHORIZE.replace("pi.flow", "query") }];
    const { container } = render(<SdkWalkthrough via="form" trace={trace} />);
    const run = container.querySelector(".lesson-run");
    expect(run.querySelector(".lesson-ok")).toBeNull();
    expect(run.querySelector(".lesson-warn").textContent).toBe("⚠️ query");
  });

  it("lists the steps the page recorded, in order", () => {
    const steps = [
      { kind: "start", nodeStatus: "continue", response: { formName: "Sign On", authorizeKeys: [] } },
      { kind: "next", trigger: { type: "SubmitCollector", label: "Sign On" }, nodeStatus: "success", response: { authorizeKeys: ["code"] } },
    ];
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} steps={steps} />);
    const items = [...container.querySelectorAll(".lesson-run ol li")].map((li) => li.textContent);
    expect(items).toEqual(['The flow starts → form "Sign On"', 'You clicked "Sign On" (SubmitCollector) → flow COMPLETED']);
  });

  it("never renders nonce, state or PKCE values from the captured URL", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    expect(container.textContent).not.toMatch(/SECRETNONCE|STATEVALUE|CHALLENGEVALUE/);
  });

  it("tells the form story on the form path, and the session story on the session path", () => {
    const form = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    expect(form.container.querySelector(".lesson-run").textContent).toMatch(/rendered its collectors/);
    expect(form.container.textContent).not.toMatch(/already had a session/i);
    form.unmount();

    const session = render(<SdkWalkthrough via="session" trace={[]} />);
    expect(session.container.querySelector(".lesson-run").textContent).toMatch(/already had a session/i);
  });

  it("links into the lesson sections through onNavigate", () => {
    const onNavigate = vi.fn();
    const { getByText } = render(<SdkWalkthrough via="form" trace={[]} onNavigate={onNavigate} />);
    fireEvent.click(getByText("API Calls"));
    expect(onNavigate).toHaveBeenCalledWith("api-calls");
  });

  it("links to the in-app guide and Ping's SDK documentation", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={[]} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/orchestration-sdk");
    expect(hrefs).toContain("https://developer.pingidentity.com/orchsdks/index.html");
  });
});
