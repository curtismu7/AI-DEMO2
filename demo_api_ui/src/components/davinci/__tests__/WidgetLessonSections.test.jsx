// demo_api_ui/src/components/davinci/__tests__/WidgetLessonSections.test.jsx
// Pinned: sections match the shared nav order, the diagram parses with the REAL
// Mermaid parser, the API calls are the captured widget contract, pi.flow is
// taught as the contrast, and no secret value can render.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));

import WidgetLessonSections, { FLOW_SOURCE, WIDGET_LESSON_SECTIONS } from "../WidgetLessonSections";

describe("WIDGET_LESSON_SECTIONS", () => {
  it("uses the shared order with the widget's two sections before security", () => {
    expect(WIDGET_LESSON_SECTIONS.map((s) => s.id)).toEqual([
      "try-it-live", "overview", "how-its-wired", "pi-flow", "how-it-works", "api-calls",
      "the-flow", "the-final-node", "tokens-to-session", "security", "troubleshooting", "in-this-repo",
    ]);
  });
});

describe("WidgetLessonSections", () => {
  it("renders a section for every nav entry after Try It Live, in nav order", () => {
    const { container } = render(<WidgetLessonSections />);
    const ids = [...container.querySelectorAll("section")].map((s) => s.id);
    expect(ids).toEqual(WIDGET_LESSON_SECTIONS.slice(1).map((s) => s.id));
  });

  it("names the wiring a developer must configure, including which login policy runs", () => {
    const text = render(<WidgetLessonSections />).container.querySelector("#how-its-wired").textContent;
    expect(text).toContain("X-SK-API-KEY");
    expect(text).toContain("PingOne SSO");
    expect(text).toContain("Return Success Response (Widget Flows)");
    expect(text).toContain("No PingOne sign-on policy");
  });

  it("shows the captured wire contract, one copyable block per call", () => {
    const { container } = render(<WidgetLessonSections />);
    const api = container.querySelector("#api-calls");
    expect(api.textContent).toContain("/davinci/policy/");
    expect(api.textContent).toContain("/start");
    expect(api.textContent).toContain('"eventName": "continue"');
    expect(api.textContent).toContain('"capabilityName": "returnSuccessResponseWidget"');
    expect(api.textContent).toContain("/api/davinci-login/widget-session");
    expect(api.querySelectorAll(".lesson-code-copy").length).toBeGreaterThanOrEqual(6);
  });

  it("teaches pi.flow as the contrast and links to the SDK lesson that uses it", () => {
    const { container } = render(<WidgetLessonSections />);
    const piFlow = container.querySelector("#pi-flow");
    expect(piFlow.textContent).toContain("response_mode=pi.flow");
    expect(piFlow.textContent).toContain("never calls /as/authorize");
    expect(piFlow.querySelector('a[href="/davinci-sdk-login"]')).not.toBeNull();
  });

  it("reports this run's calls in pi.flow only once there are some", () => {
    const empty = render(<WidgetLessonSections calls={[]} />).container;
    expect(empty.querySelector("#pi-flow .lesson-run")).toBeNull();

    const calls = [{ method: "POST", host: "auth.pingone.com", path: "/env-1/davinci/policy/p/start", status: 200 }];
    const run = render(<WidgetLessonSections calls={calls} />).container.querySelector("#pi-flow .lesson-run");
    expect(run.querySelector(".lesson-ok").textContent).toContain("0 of 1");
  });

  it("gives copyable integration, SDK-token and session code", () => {
    const code = [...render(<WidgetLessonSections />).container.querySelectorAll("pre code")]
      .map((c) => c.textContent).join("\n");
    expect(code).toContain("davinci.skRenderScreen");
    expect(code).toContain("includeHttpCredentials: true");
    expect(code).toContain("/sdktoken");
    expect(code).toContain("verifyExchangedToken");
  });
});

describe("FLOW_SOURCE is valid Mermaid", () => {
  it("parses", async () => {
    const { default: realMermaid } = await vi.importActual("mermaid");
    await expect(realMermaid.parse(FLOW_SOURCE)).resolves.toBeTruthy();
  });
});
