import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DelegationChainValuePage from "../DelegationChainValuePage";
import apiClient from "../../services/apiClient";
import { sendAgentMessage } from "../../services/demoAgentService";

vi.mock("../../services/apiClient", () => ({ default: { post: vi.fn(), patch: vi.fn() } }));
vi.mock("../../services/demoAgentService", () => ({ sendAgentMessage: vi.fn() }));
vi.mock("../../components/TokenChainTraceRail", () => ({ default: () => <div data-testid="dcv-rail" /> }));

// jsdom measures nothing, so React Flow draws no edges unless the observer reports each node.
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; }
  observe(target) { this.cb([{ target, contentRect: { width: 250, height: 40 } }]); }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 250 });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 40 });
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

const primaries = () => [...document.querySelectorAll(".dcv-page .pu-btn--primary")].map((b) => b.getAttribute("data-testid"));
const runButton = (key) => screen.getByTestId(`dcv-run-button-${key}`);
const card = (key) => screen.getByTestId(`dcv-run-${key}`);

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function runAndSettle(key, reply = "ok", tools = ["delegate_to_specialist"]) {
  sendAgentMessage.mockResolvedValueOnce({ reply, toolsCalled: tools });
  await act(async () => { fireEvent.click(runButton(key)); });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.patch.mockResolvedValue({});
});

describe("DelegationChainValuePage on the Ping UI standard", () => {
  it("opens with a role=note banner that says what is real and what is drawn, before the title", () => {
    render(<DelegationChainValuePage />);
    const page = document.querySelector(".dcv-page");
    expect(page.firstElementChild.classList.contains("pu-banner-wrap")).toBe(true);
    const banner = screen.getByTestId("dcv-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toMatch(/Real:/);
    expect(banner.textContent).toMatch(/Not real:/);
    expect(banner.textContent).toMatch(/MOCK/);
    expect(banner.textContent).not.toMatch(/Gateway/);
  });

  it("has exactly one primary button per state: first unfinished scenario, then back to the first", async () => {
    render(<DelegationChainValuePage />);
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
    await runAndSettle("accountability");
    expect(primaries()).toEqual(["dcv-run-button-authorization"]);
    await runAndSettle("authorization");
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
    expect(runButton("accountability").textContent).toBe("Run again");
    expect(screen.getByTestId("dcv-theme-toggle").className).toBe("pu-btn");
    expect(screen.getByTestId("dcv-clear").className).toBe("pu-btn");
  });

  it("shows a word in every status chip, and a reply is never coloured as success", async () => {
    render(<DelegationChainValuePage />);
    const words = () => [...document.querySelectorAll(".dcv-page .pu-chip")].map((c) => c.textContent);
    expect(words()).toEqual(["Not run", "Not run"]);
    await runAndSettle("accountability", "Delegation complete - the specialist retrieved the holdings.");
    const chip = within(card("accountability")).getByText("Reply received").closest(".pu-chip");
    expect(chip.classList.contains("pu-chip--ok")).toBe(false);
    expect(chip.classList.contains("pu-chip--info")).toBe(true);
    expect(card("accountability").classList.contains("pu-card--ok")).toBe(false);
    for (const c of document.querySelectorAll(".dcv-page .pu-chip")) expect((c.textContent || "").trim().length).toBeGreaterThan(0);
  });

  it("treats an error reply as a failed run: Run failed chip, danger card, and the primary stays on that run", async () => {
    render(<DelegationChainValuePage />);
    await runAndSettle("accountability", "❌ a2a_unauthorized");
    const chip = within(card("accountability")).getByText("Run failed").closest(".pu-chip");
    expect(chip.classList.contains("pu-chip--danger")).toBe(true);
    expect(within(card("accountability")).queryByText("Reply received")).toBeNull();
    expect(card("accountability").classList.contains("pu-card--live")).toBe(false);
    expect(card("accountability").classList.contains("pu-card--danger")).toBe(true);
    expect(card("accountability").getAttribute("data-state")).toBe("failed");
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
    expect(runButton("accountability").textContent).toBe("Run again");
    expect(card("accountability").textContent).toContain("a2a_unauthorized");
    // a good retry hands the primary on to Authorization
    await runAndSettle("accountability", "Delegation complete.");
    expect(primaries()).toEqual(["dcv-run-button-authorization"]);
  });

  it("treats a probe that was not denied (a cross inside the reply) as a failed run too", async () => {
    render(<DelegationChainValuePage />);
    await runAndSettle("accountability");
    await runAndSettle("authorization", "Delegation complete. ❌ The unregistered-agent probe was NOT denied (PERMIT).");
    expect(within(card("authorization")).getByText("Run failed")).toBeTruthy();
    expect(primaries()).toEqual(["dcv-run-button-authorization"]);
  });

  it("keeps a No reply run (empty reply, e.g. a 502) as the primary, never as done", async () => {
    render(<DelegationChainValuePage />);
    await runAndSettle("accountability", "");
    expect(within(card("accountability")).getByText("No reply")).toBeTruthy();
    expect(card("accountability").getAttribute("data-state")).toBe("empty");
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
    expect(runButton("accountability").textContent).toBe("Run again");
    await runAndSettle("accountability", "ok");
    expect(primaries()).toEqual(["dcv-run-button-authorization"]);
  });

  it("does not claim a token is or is not minted for the unregistered agent beyond what the server code shows", () => {
    render(<DelegationChainValuePage />);
    const text = screen.getByTestId("dcv-banner").textContent;
    expect(text).not.toMatch(/no token is minted/i);
    expect(text).toMatch(/expected to refuse/i);
  });

  it("shows the tools the run called as a key-value row", async () => {
    render(<DelegationChainValuePage />);
    expect(within(card("accountability")).queryByText("Tools called")).toBeNull();
    await runAndSettle("accountability", "reply", ["delegate_to_specialist"]);
    const dt = within(card("accountability")).getByText("Tools called");
    expect(dt.nextElementSibling.textContent).toBe("delegate_to_specialist");
  });

  it("keeps focus on a busy Run (aria-disabled, never disabled), ignores a second press, then announces the reply", async () => {
    const d = deferred();
    sendAgentMessage.mockReturnValueOnce(d.promise);
    render(<DelegationChainValuePage />);
    const btn = runButton("accountability");
    btn.focus();
    await act(async () => { fireEvent.click(btn); });
    expect(document.activeElement).toBe(btn);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.textContent).toBe("Running...");
    expect(within(card("accountability")).getByText("Running")).toBeTruthy();
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
    await act(async () => { fireEvent.click(btn); });
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve({ reply: "the reply", toolsCalled: [] }); });
    expect(document.activeElement).toBe(btn);
    const live = card("accountability").querySelector('[role="status"]');
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("the reply");
    expect(within(card("accountability")).getByText("none")).toBeTruthy();
  });

  it("reports a failed run with a Failed chip and an alert, and keeps that run as the primary so it can be retried", async () => {
    sendAgentMessage.mockRejectedValueOnce(new Error("boom"));
    render(<DelegationChainValuePage />);
    await act(async () => { fireEvent.click(runButton("accountability")); });
    expect(within(card("accountability")).getByText("Failed")).toBeTruthy();
    expect(within(card("accountability")).getByRole("alert").textContent).toBe("boom");
    expect(card("accountability").classList.contains("pu-card--danger")).toBe(true);
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
    expect(runButton("accountability").textContent).toBe("Run");
  });

  it("shows the evidence rail only after a run, with an empty state before", async () => {
    render(<DelegationChainValuePage />);
    expect(screen.queryByTestId("dcv-rail")).toBeNull();
    expect(screen.getByTestId("dcv-chain").textContent).toMatch(/Nothing to show yet/);
    await runAndSettle("accountability");
    expect(screen.getByTestId("dcv-rail")).toBeTruthy();
    expect(screen.getByRole("region", { name: "The chain from that run" })).toBeTruthy();
  });

  it("keeps Clear in place (aria-disabled until there is something to clear) so focus never drops", async () => {
    render(<DelegationChainValuePage />);
    const clear = screen.getByTestId("dcv-clear");
    expect(clear.getAttribute("aria-disabled")).toBe("true");
    await runAndSettle("accountability");
    expect(clear.getAttribute("aria-disabled")).toBeNull();
    clear.focus();
    await act(async () => { fireEvent.click(clear); });
    expect(document.activeElement).toBe(clear);
    expect(clear.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByTestId("dcv-rail")).toBeNull();
    expect(primaries()).toEqual(["dcv-run-button-accountability"]);
  });

  it("sends each scenario's own prompt through the same path as before", async () => {
    render(<DelegationChainValuePage />);
    await runAndSettle("accountability");
    await runAndSettle("authorization");
    expect(sendAgentMessage.mock.calls.map((c) => c[0])).toEqual(["hand off to a specialist", "simulate an agent identity mismatch"]);
    expect(sendAgentMessage.mock.calls[0][2]).toEqual({ forceHeuristic: true, vertical: "sporting-goods" });
  });
});
