// The lesson below Try It Live on /davinci-orchestration-sdk.
//
// Pinned: the sections match the nav (the section ids are shared with the
// widget lesson), the diagram is valid Mermaid checked with the REAL parser, the
// collector code a developer copies uses the SDK's real calls, and the "on this
// run" line reports pi.flow only when the actual request carried it.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg></svg>" })),
  },
}));

import SdkLessonSections, { FLOW_SOURCE, SDK_LESSON_SECTIONS } from "../SdkLessonSections";

const START_STEP = {
  kind: "start",
  request: {
    method: "GET",
    url: "https://auth.pingone.com/env-1/as/authorize?client_id=c&state=STATEVALUE&response_mode=pi.flow&nonce=SECRETNONCE",
  },
};

describe("SdkLessonSections", () => {
  it("renders a section for every nav entry after Try It Live, in nav order", () => {
    const { container } = render(<SdkLessonSections />);
    const ids = [...container.querySelectorAll("section")].map((s) => s.id);
    expect(ids).toEqual(SDK_LESSON_SECTIONS.slice(1).map((s) => s.id));
  });

  it("gives copyable collector code built on the SDK's real calls", () => {
    const { container } = render(<SdkLessonSections />);
    const code = [...container.querySelectorAll("#collectors pre code")].map((c) => c.textContent).join("\n");
    expect(code).toContain("client.update(collector)");
    expect(code).toContain("client.flow({ action: collector.output.key })()");
    expect(code).toContain("client.next()");
    expect(code).toContain("client.getCollectors()");
    expect(code).toContain("generic ActionCollector");
    expect(container.querySelectorAll("#collectors .lesson-code-copy").length).toBeGreaterThanOrEqual(6);
  });

  it("wraps every static lesson code sample in a closed disclosure without changing its source", () => {
    const { container } = render(<SdkLessonSections />);
    const disclosures = [...container.querySelectorAll(".sdk-lesson-code")];
    const codeBlocks = [...container.querySelectorAll(".lesson-code")];

    expect(disclosures).toHaveLength(codeBlocks.length);
    expect(disclosures.length).toBeGreaterThan(0);
    expect(disclosures.every((disclosure) => !disclosure.hasAttribute("open"))).toBe(true);
    expect(container.querySelector("#pi-flow pre code").textContent).toContain('import { davinci } from "@forgerock/davinci-client"');
  });

  it("shows the captured branch: the FlowCollector's POST and the form DaVinci stopped at", () => {
    const { container } = render(<SdkLessonSections />);
    const api = container.querySelector("#api-calls").textContent;
    expect(api).toContain('"actionKey": "TROUBLE"');
    expect(api).toContain('"eventType": "action"');
    expect(api).toContain('"name": "Enter Username"');
    expect(api).toContain("response_mode=pi.flow");
    expect(api).toContain("acr_values=<flowPolicyId>");
  });

  it("explains acr_values when an application has multiple DaVinci policies", () => {
    const { container } = render(<SdkLessonSections />);
    const wiring = container.querySelector("#how-its-wired").textContent;
    expect(wiring).toContain("two policies selected");
    expect(wiring).toContain("acr_values");
  });

  it("documents the P1 Forms display-only and automatic collectors", () => {
    const { container } = render(<SdkLessonSections />);
    const collectors = container.querySelector("#collectors").textContent;

    expect(collectors).toContain("RichTextCollector");
    expect(collectors).toContain("text-only");
    expect(collectors).toContain("ERROR_DISPLAY");
    expect(collectors).toContain("informational, non-input");
    expect(collectors).toContain("ProtectCollector");
    expect(collectors).toContain("Security check active");
    expect(collectors).toContain("flow status");
  });

  it("distinguishes preview patterns from this browser's live evidence and documents the routing rules", () => {
    const { container } = render(<SdkLessonSections />);
    const text = container.textContent;

    expect(text).toContain("copyable pattern");
    expect(text).toContain("evidence from this browser run");
    expect(text).toContain("response_mode=pi.flow");
    expect(text).toContain("two policies selected");
    expect(text).toContain("client.update(collector)(value)");
    expect(text).toContain("client.next()");
    expect(text).toContain("client.flow({ action })()");
    expect(text).toContain("BFF makes the session");
  });

  it("reports pi.flow from the real authorize request, and never its values", () => {
    const { container } = render(<SdkLessonSections steps={[START_STEP]} />);
    const run = container.querySelector("#pi-flow .lesson-run");
    expect(run.querySelector(".lesson-ok").textContent).toBe("✓ response_mode=pi.flow");
    expect(container.textContent).not.toMatch(/SECRETNONCE|STATEVALUE/);
  });

  it("claims nothing about this run before the flow has started", () => {
    const { container } = render(<SdkLessonSections steps={[]} />);
    expect(container.querySelector("#pi-flow .lesson-run")).toBeNull();
  });

  it("shows the public config the page received, when it has some", () => {
    const { container } = render(
      <SdkLessonSections config={{ clientId: "client-1", redirectUri: "https://app/davinci-orchestration-sdk", scope: "openid" }} />,
    );
    expect(container.querySelector("#how-its-wired").textContent).toContain("client-1");
    // The demo's own client_id must not reach the customer PDF.
    const received = [...container.querySelectorAll("#how-its-wired p")].find((p) => p.textContent.includes("client-1"));
    expect(received.classList.contains("lesson-no-print")).toBe(true);
  });
});

describe("FLOW_SOURCE is valid Mermaid", () => {
  // The REAL parser, bypassing the module mock above: a syntax error here is a
  // "Diagram failed to render" box on the live page.
  it("parses", async () => {
    const { default: realMermaid } = await vi.importActual("mermaid");
    await expect(realMermaid.parse(FLOW_SOURCE)).resolves.toBeTruthy();
  });
});
