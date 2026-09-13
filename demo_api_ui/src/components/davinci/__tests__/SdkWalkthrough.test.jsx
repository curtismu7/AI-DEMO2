// SdkWalkthrough — the developer walkthrough in the "What just happened" modal.
//
// Two kinds of promise to hold:
//   1. It reports what ACTUALLY happened on the run, from the page's SDK trace —
//      including whether response_mode=pi.flow was really on the authorize
//      request — and never leaks nonce/state/PKCE/code values while doing it.
//   2. Its diagram is valid Mermaid. mermaid.render needs real layout, so it is
//      mocked for rendering; the source itself is checked with the REAL parser,
//      because a mocked parse would pass a diagram that fails on the live page.
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg data-testid='sdkw-svg'></svg>" })),
    parse: vi.fn(async () => true),
  },
}));

import mermaid from "mermaid";
import SdkWalkthrough, { summarizeTrace, sequenceSource } from "../SdkWalkthrough";

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
    expect(run.authorize).toBeTruthy();
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
    expect(serialized).not.toContain("SECRETNONCE");
    expect(serialized).not.toContain("STATEVALUE");
    expect(serialized).not.toContain("CHALLENGEVALUE");
  });

  it("dedupes collectors across state updates and collapses repeated statuses", () => {
    const run = summarizeTrace(FORM_TRACE);
    expect(run.collectors.map((c) => c.type)).toEqual([
      "TextCollector",
      "PasswordCollector",
      "SubmitCollector",
    ]);
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

describe("sequenceSource is valid Mermaid", () => {
  // The REAL parser, bypassing the module mock above: a syntax error here is a
  // "Diagram failed to render" box on the live page.
  it.each([
    ["the form path", false],
    ["the existing-session path", true],
  ])("parses for %s", async (_label, viaSession) => {
    const { default: realMermaid } = await vi.importActual("mermaid");
    await expect(realMermaid.parse(sequenceSource(viaSession))).resolves.toBeTruthy();
  });
});

describe("SdkWalkthrough", () => {
  it("covers every topic a developer needs, in order", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    const headings = [...container.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual([
      "1. How this app is connected to PingOne",
      "2. pi.flow — the flow comes back as JSON, not a redirect",
      "3. Collectors — each form field as a typed object",
      "4. How DaVinci answers — there is no callback",
      "5. Turning the code into a session — the BFF",
      "6. When PingOne already has a session",
      "7. The whole sequence",
    ]);
  });

  it("reports pi.flow as verified from the actual request on this run", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    const run = container.querySelector(".sdkw-run");
    expect(run.textContent).toMatch(/pi\.flow — read off the actual \/as\/authorize request/);
    expect(run.querySelector(".sdkw-ok")).toBeTruthy();
    expect(run.textContent).toMatch(/continue → success/);
  });

  it("warns, rather than claiming pi.flow, when the request used another response mode", () => {
    const trace = [{ source: "http", method: "GET", url: AUTHORIZE.replace("pi.flow", "query") }];
    const { container } = render(<SdkWalkthrough via="form" trace={trace} />);
    const run = container.querySelector(".sdkw-run");
    expect(run.querySelector(".sdkw-ok")).toBeNull();
    expect(run.querySelector(".sdkw-warn").textContent).toBe("query");
  });

  it("lists the collectors this run actually received", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    const text = container.textContent;
    expect(text).toContain("PasswordCollector");
    expect(text).toContain("SubmitCollector");
  });

  it("never renders nonce, state or PKCE values from the captured URL", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    expect(container.textContent).not.toContain("SECRETNONCE");
    expect(container.textContent).not.toContain("STATEVALUE");
    expect(container.textContent).not.toContain("CHALLENGEVALUE");
  });

  it("tells the form story on the form path, without claiming a reused session", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={FORM_TRACE} />);
    expect(container.querySelector(".sdkw-run").textContent).toMatch(/rendered its collectors/);
    expect(container.textContent).not.toMatch(/already had a session/i);
  });

  it("tells the session story, and draws that diagram, on the existing-session path", async () => {
    const { container } = render(<SdkWalkthrough via="session" trace={[]} />);
    expect(container.querySelector(".sdkw-run").textContent).toMatch(/already had a session/i);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    const drawn = mermaid.render.mock.calls.at(-1)[1];
    expect(drawn).toBe(sequenceSource(true));
    expect(drawn).toMatch(/already had a session/);
  });

  it("shows the public config the page received, and nothing when there is none", () => {
    const cfg = {
      clientId: "client-1",
      redirectUri: "https://app/davinci-sdk-login",
      scope: "openid profile email",
      wellknown: "https://auth.pingone.com/env-1/as/.well-known/openid-configuration",
    };
    const withCfg = render(<SdkWalkthrough via="form" trace={[]} config={cfg} />);
    expect(withCfg.container.textContent).toContain("client-1");
    expect(withCfg.container.textContent).toContain("auth.pingone.com");
    withCfg.unmount();

    const without = render(<SdkWalkthrough via="form" trace={[]} />);
    expect(without.container.textContent).not.toMatch(/This page received: client_id/);
  });

  it("links to the in-app guide and Ping's SDK documentation", () => {
    const { container } = render(<SdkWalkthrough via="form" trace={[]} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/orchestration-sdk");
    expect(hrefs).toContain("https://developer.pingidentity.com/orchsdks/index.html");
  });
});
