import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import WidgetRunSummary from "../WidgetRunSummary";

const call = (path, extra = {}) => ({
  method: "POST", host: "auth.pingone.com", path, status: 200, capabilityName: null, connectorId: null, success: null, ...extra,
});
const RUN = [
  call("/api/davinci-login/sdk-token"),
  call("/env-1/davinci/policy/p/start", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c/capabilities/customHTMLTemplate", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c/capabilities/customHTMLTemplate", { capabilityName: "returnSuccessResponseWidget", success: true }),
  call("/api/davinci-login/widget-session"),
];

describe("WidgetRunSummary", () => {
  it("says who signed in and that the page never left", () => {
    const { container } = render(<WidgetRunSummary username="demouser" calls={RUN} />);
    expect(container.querySelector(".lesson-lede").textContent).toContain("demouser");
    expect(container.textContent).toContain("without an /authorize redirect");
  });

  it("reports the run from the recorded calls", () => {
    const { container } = render(<WidgetRunSummary calls={RUN} />);
    const run = container.querySelector(".lesson-run").textContent;
    expect(run).toContain("2 screen submits");
    expect(run).toContain("returnSuccessResponseWidget");
    expect(container.querySelectorAll(".lesson-run ol li")).toHaveLength(5);
  });

  it("warns when the final node returned no tokens", () => {
    const noTokens = RUN.map((c) => (c.capabilityName === "returnSuccessResponseWidget" ? { ...c, success: null } : c));
    const { container } = render(<WidgetRunSummary calls={noTokens} />);
    expect(container.querySelector(".lesson-warn").textContent).toContain("no tokens");
  });

  it("warns when the run included an /as/authorize call", () => {
    const withAuthorize = [...RUN, call("/as/authorize")];
    const { container } = render(<WidgetRunSummary calls={withAuthorize} />);
    const authorizeStatus = [...container.querySelectorAll(".lesson-warn")].find((el) =>
      el.textContent.includes("without an /authorize redirect"),
    );
    expect(authorizeStatus).toBeTruthy();
  });

  it("links into the lesson sections through onNavigate", () => {
    const onNavigate = vi.fn();
    const { getByText } = render(<WidgetRunSummary calls={RUN} onNavigate={onNavigate} />);
    fireEvent.click(getByText("API Calls"));
    expect(onNavigate).toHaveBeenCalledWith("api-calls");
  });
});
