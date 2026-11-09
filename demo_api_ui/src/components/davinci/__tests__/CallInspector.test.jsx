import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CallInspector, { callKind, callTitle } from "../CallInspector";

const call = (path, extra = {}) => ({
  method: "POST", host: "auth.pingone.com", path, status: 200, capabilityName: null, connectorId: null, success: null, ...extra,
});

const RUN = [
  call("/api/davinci-login/sdk-token", { host: "local.ping-devops.com:4000" }),
  call("/env-1/davinci/policy/pol-1/start", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", { capabilityName: "customHTMLTemplate" }),
  call("/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate", {
    capabilityName: "returnSuccessResponseWidget", connectorId: "pingOneAuthenticationConnector", success: true,
  }),
  call("/api/davinci-login/widget-session", { host: "local.ping-devops.com:4000" }),
];

describe("callKind", () => {
  it("names each call the widget run makes", () => {
    expect(RUN.map(callKind)).toEqual(["sdk-token", "start", "screen", "final", "session"]);
    expect(callKind(call("/env-1/as/authorize"))).toBe("authorize");
  });
});

describe("callTitle", () => {
  it("is the method and full address", () => {
    expect(callTitle(RUN[1])).toBe("POST auth.pingone.com/env-1/davinci/policy/pol-1/start");
  });
});

describe("CallInspector", () => {
  it("renders one card per call, in order, with what each call did", () => {
    const { container } = render(<CallInspector calls={RUN} />);
    const cards = container.querySelectorAll(".dvl-call");
    expect(cards).toHaveLength(5);
    expect(cards[0].textContent).toContain("mints a DaVinci SDK token");
    expect(cards[1].textContent).toContain("Bearer");
    expect(cards[3].textContent).toContain("returnSuccessResponseWidget");
    // The card's first chip is its HTTP status; the tokens status comes after it.
    expect([...cards[3].querySelectorAll(".pu-chip--ok")].map((e) => e.textContent).join(" ")).toContain("tokens");
    expect(cards[4].textContent).toContain("verifies both");
  });

  it("shows a failed call as a danger chip with the status word", () => {
    const { container } = render(<CallInspector calls={[{ ...RUN[4], status: 401 }]} />);
    expect(container.querySelector(".pu-chip--danger").textContent).toContain("HTTP 401");
    expect(container.querySelector(".pu-chip--ok")).toBeNull();
  });

  it("lists the request and capability of a call as key-value rows", () => {
    const { container } = render(<CallInspector calls={[RUN[3]]} />);
    const kv = [...container.querySelectorAll(".dvl-call .pu-kv dt, .dvl-call .pu-kv dd")].map((e) => e.textContent);
    expect(kv).toEqual([
      "Call", "1 of this run",
      "Request", "POST auth.pingone.com/env-1/davinci/connections/c-1/capabilities/customHTMLTemplate",
      "Capability", "returnSuccessResponseWidget",
    ]);
  });

  it("says what to expect before the widget starts", () => {
    const { container } = render(<CallInspector calls={[]} />);
    expect(container.textContent).toContain("No calls yet");
  });
});
