import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, act, within } from "@testing-library/react";
import OboDemoPage from "../OboDemoPage";
import { VerticalContext } from "../../vertical/VerticalProvider";

const post = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { post: (...a) => post(...a) } }));

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; FakeEventSource.instances.push(this); }
  close() {}
}

beforeEach(() => {
  post.mockReset();
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
});
afterEach(() => { delete globalThis.EventSource; });

describe("OboDemoPage", () => {
  it("renders the checks returned by the BFF as PASS/FAIL, with no token text", async () => {
    post.mockResolvedValue({ data: { checks: [
      { id: "sub", label: "sub is preserved", pass: true },
      { id: "act", label: "act names the agent", pass: false },
    ] } });
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));

    const list = await screen.findByRole("list", { name: /delegation checks/i });
    expect(list).toHaveTextContent("PASSsub is preserved");
    expect(list).toHaveTextContent("FAILact names the agent");
    expect(post).toHaveBeenCalledWith("/api/obo/run");
    expect(document.body.textContent).not.toMatch(/eyJ/);
  });

  it("shows the BFF's error message when the demo is not configured", async () => {
    const failure = Object.assign(new Error("Request failed with status code 503"), {
      response: { status: 503, data: { error: "OBO demo is not configured on this environment." } },
    });
    post.mockRejectedValueOnce(failure);
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not configured on this environment/i);
    expect(screen.queryByRole("list", { name: /delegation checks/i })).toBeNull();
  });

  it("marks the button aria-disabled (not disabled, so focus stays) while the run is in flight", async () => {
    let resolve;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<OboDemoPage />);
    const button = screen.getByRole("button", { name: /run the delegation/i });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByText("Running the exchange…")).toBeInTheDocument();
    // The name is stable (the status region announces the change) and the button keeps focus.
    expect(screen.getByRole("button", { name: /run the delegation/i })).toBe(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    // A second press while running is ignored.
    fireEvent.click(button);
    expect(post).toHaveBeenCalledTimes(1);
    resolve({ data: { checks: [] } });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    expect(button).toHaveFocus();
  });

  const okSteps = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, status: "pass", ms: 10, facts:
    id === 1 ? { sub: "user-1", client_id: "web", aud: ["a"], scope: { count: 1, sample: ["openid"] }, expiresInMin: 5, sha: "abcdef0123" }
    : id === 3 ? { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", audience: "obo-demo.ping.demo", scope: "obo:invoke", exchanger: "exch", subjectSha: "1", actorSha: "2" }
    : id === 4 ? { subSame: true, inbound: { aud: ["a"], scope: { count: 1, sample: [] }, sha: "1" }, delegated: { aud: ["obo"], scope: "obo:invoke", sub: "user-1", act: { client_id: "agent" }, sha: "2" } }
    : id === 7 ? { leak: false } : id === 2 ? { client_id: "agent", scope: "x" } : { status: 200 } }));

  it("opens a step's details on the left when its trace line is clicked", async () => {
    post.mockResolvedValue({ data: { steps: okSteps, checks: [{ id: "a", label: "ok", pass: true }] } });
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 of 1 checks passed");
    fireEvent.click(screen.getByRole("button", { name: /Token exchange \(RFC 8693\)/ }));
    expect(screen.getByRole("heading", { name: /3\. Token exchange/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/eyJ/);
  });

  it("on a failed hop shows the PingOne reason and marks later steps skipped", async () => {
    const steps = [
      { id: 1, status: "pass", ms: 1, facts: { sub: "u" } },
      { id: 2, status: "pass", ms: 1, facts: { client_id: "agent" } },
      { id: 3, status: "fail", ms: 1, facts: { error: "invalid_request", description: "Not a valid access token for subject_token", httpStatus: 400 } },
      ...[4, 5, 6, 7].map((id) => ({ id, status: "skip", ms: 0, facts: {} })),
    ];
    post.mockRejectedValueOnce(Object.assign(new Error("502"), { response: { status: 502, data: { error: "OBO exchange failed.", failedStep: 3, steps } } }));
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("failed at step 3");
    expect(screen.getByText("invalid_request")).toBeInTheDocument();
    expect(screen.getAllByText("skipped")).toHaveLength(4);
  });

  it("links the flow diagram and opens it in a new tab", () => {
    render(<OboDemoPage />);
    const link = screen.getByRole("link", { name: /flow diagram/i });
    expect(link).toHaveAttribute("href", "/architecture/obo-flow.html");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the Claude Code steps with this origin's endpoint and the tool to allow", () => {
    render(<OboDemoPage />);
    expect(screen.getByText(/claude mcp add --transport http obo-demo/)).toHaveTextContent(`${window.location.origin}/api/obo/mcp`);
    expect(screen.getByText(/mcp__obo-demo__act_on_my_behalf/)).toBeInTheDocument();
  });

  it("renders a live event from Claude when one arrives on the stream", async () => {
    render(<OboDemoPage />);
    expect(screen.getByText(/waiting for claude/i)).toBeInTheDocument();
    const evidence = { source: "claude", ts: "2026-10-14T20:00:00Z", checks: [{ id: "x", label: "live check", pass: true }] };
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify(evidence) }); });
    const live = await screen.findByRole("region", { name: /live from claude/i });
    expect(within(live).getByRole("list", { name: "Live delegation checks" })).toHaveTextContent("PASS live check");
    expect(screen.queryByText(/waiting for claude/i)).toBeNull();
  });

  it("shows when the latest live call happened, only if ts is valid", async () => {
    render(<OboDemoPage />);
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify({ source: "claude", checks: [] }) }); });
    const live = await screen.findByRole("region", { name: /live from claude/i });
    expect(within(live).queryByText(/last call at/i)).toBeNull();
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify({ source: "claude", ts: "2026-10-14T20:00:00Z", checks: [] }) }); });
    expect(await within(live).findByText(/last call at/i)).toBeInTheDocument();
  });
});

describe("OboDemoPage step wire detail", () => {
  const baseSteps = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, status: "pass", ms: 10, facts:
    id === 1 ? { sub: "user-1", client_id: "web", aud: ["a"], scope: { count: 1, sample: ["openid"] }, expiresInMin: 5, sha: "abcdef0123" }
    : id === 3 ? { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", audience: "obo-demo.ping.demo", scope: "obo:invoke", exchanger: "exch", subjectSha: "1", actorSha: "2" }
    : id === 4 ? { subSame: true, inbound: { aud: ["a"], scope: { count: 1, sample: [] }, sha: "1" }, delegated: { aud: ["obo"], scope: "obo:invoke", sub: "user-1", act: { client_id: "agent" }, sha: "2" } }
    : id === 7 ? { leak: false } : id === 2 ? { client_id: "agent", scope: "x" } : { status: 200 } }));
  const withWire = (steps) => steps.map((s) => (s.id === 3 ? {
    ...s,
    wire: { request: { method: "POST", url: "https://auth.pingone.com/env/as/token", headers: {}, body: { client_id: "exch", client_secret: "***" } }, response: { status: 200, body: { expires_in: 900 } } },
    tokens: [{ role: "delegated", label: "Delegated token", raw: "H.P.S", decoded: { header: { alg: "RS256" }, payload: { sub: "user-1" } } }],
  } : s));

  it("shows the request, response and tokens when a step with wire is opened", async () => {
    post.mockResolvedValue({ data: { steps: withWire(baseSteps), checks: [{ id: "a", label: "ok", pass: true }] } });
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /Token exchange \(RFC 8693\)/ }));
    expect(screen.getByRole("region", { name: "Request" })).toHaveTextContent("POST https://auth.pingone.com/env/as/token");
    expect(screen.getByRole("region", { name: "Delegated token" })).toHaveTextContent("H.P.S");
  });

  it("shows nothing extra for a step without wire", async () => {
    post.mockResolvedValue({ data: { steps: baseSteps, checks: [{ id: "a", label: "ok", pass: true }] } });
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: /Token exchange \(RFC 8693\)/ }));
    expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
  });

  it("no longer claims that tokens never reach the page", () => {
    render(<OboDemoPage />);
    expect(document.body.textContent).not.toMatch(/Tokens appear only as short hashes/i);
    expect(document.body.textContent).not.toMatch(/never sent to the browser/i);
  });
});

describe("OboDemoPage reset", () => {
  const steps = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, status: "pass", ms: 5, facts: id === 4
    ? { subSame: true, inbound: { aud: ["a"], scope: { count: 1, sample: [] }, sha: "1" }, delegated: { aud: ["b"], scope: "s", sub: "u", act: { client_id: "x" }, sha: "2" } }
    : {} }));
  const okRun = { data: { steps, checks: [{ id: "a", label: "ok", pass: true }] } };
  const clickRun = () => fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
  const clickReset = () => fireEvent.click(screen.getByRole("button", { name: /^reset$/i }));
  const liveEvent = (ts) => ({ source: "claude", ts, delegated: { sha: ts }, checks: [{ id: "x", label: `live ${ts}`, pass: true }] });

  it("Reset clears the run, the verdict and the selected step", async () => {
    post.mockResolvedValue(okRun);
    render(<OboDemoPage />);
    clickRun();
    await screen.findByRole("status");
    expect(screen.getByRole("heading", { name: /4\. Delegated token/ })).toBeInTheDocument();
    clickReset();
    expect(screen.getByRole("status")).not.toHaveTextContent(/verified|checks passed/);
    expect(screen.queryByRole("heading", { name: /4\. Delegated token/ })).toBeNull();
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });

  it("Reset is aria-disabled (with a reason) when there is nothing to clear, and active after a run", async () => {
    post.mockResolvedValue(okRun);
    render(<OboDemoPage />);
    const reset = screen.getByRole("button", { name: /^reset$/i });
    expect(reset).toHaveAttribute("aria-disabled", "true");
    expect(reset).not.toBeDisabled();
    expect(reset).toHaveAccessibleDescription(/available after a run/i);
    clickReset(); // ignored: nothing happens
    clickRun();
    await screen.findByText(/checks passed/);
    expect(screen.getByRole("button", { name: /^reset$/i })).not.toHaveAttribute("aria-disabled");
  });

  it("Reset keeps keyboard focus when it becomes inactive after clearing", async () => {
    post.mockResolvedValue(okRun);
    render(<OboDemoPage />);
    clickRun();
    await screen.findByText(/checks passed/);
    const reset = screen.getByRole("button", { name: /^reset$/i });
    reset.focus();
    fireEvent.click(reset);
    expect(reset).toHaveAttribute("aria-disabled", "true");
    expect(reset).toHaveFocus();
  });

  it("a response that arrives after Reset is discarded and the page stays usable", async () => {
    let resolve;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<OboDemoPage />);
    clickRun();
    await screen.findByText("Running the exchange…");
    clickReset();
    await act(async () => { resolve(okRun); });
    expect(screen.getByRole("status")).not.toHaveTextContent(/verified|checks passed/);
    expect(screen.getByRole("status")).toHaveTextContent("Not run yet");
    expect(screen.getByRole("button", { name: /run the delegation/i })).not.toHaveAttribute("aria-disabled");
  });

  it("Reset hides the live calls already shown, and a newer call still appears", async () => {
    render(<OboDemoPage />);
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify(liveEvent("2026-10-15T10:00:00Z")) }); });
    const region = screen.getByRole("region", { name: /live from claude/i });
    expect(within(region).getByRole("list", { name: /live delegation checks/i })).toHaveTextContent("live 2026-10-15T10:00:00Z");
    clickReset();
    expect(within(region).queryByRole("list", { name: /live delegation checks/i })).toBeNull();
    expect(within(region).getByText(/waiting for claude/i)).toBeInTheDocument();
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify(liveEvent("2026-10-15T10:05:00Z")) }); });
    expect(within(region).getByRole("list", { name: /live delegation checks/i })).toHaveTextContent("live 2026-10-15T10:05:00Z");
  });

  it("changing the vertical resets the page; re-rendering with the same vertical does not", async () => {
    post.mockResolvedValue(okRun);
    const tree = (id) => (<VerticalContext.Provider value={{ activeId: id }}><OboDemoPage /></VerticalContext.Provider>);
    const { rerender } = render(tree("healthcare"));
    clickRun();
    await screen.findByRole("status");
    rerender(tree("healthcare"));
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(tree("retail"));
    expect(screen.getByRole("status")).not.toHaveTextContent(/verified|checks passed/);
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });
});

describe("OboDemoPage title", () => {
  it("is titled Personal Agent User delegation (OBO)", () => {
    render(<OboDemoPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Personal Agent User delegation (OBO)" })).toBeInTheDocument();
  });
});

describe("OboDemoPage Ping UI Standard", () => {
  const steps = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, status: "pass", ms: 5, facts: {} }));
  const run = () => fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
  const primaries = () => document.querySelectorAll(".pu-btn--primary");

  it("opens with the banner (role=note) ahead of the title, and says nothing here is simulated", () => {
    render(<OboDemoPage />);
    const banner = screen.getByTestId("obo-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner).toHaveTextContent(/nothing on this page is simulated/i);
    expect(banner).toHaveTextContent(/no mock mode/i);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(banner.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has exactly one primary button in every state, and it is Run the delegation", async () => {
    let resolve;
    post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<OboDemoPage />);
    const check = () => {
      expect(primaries()).toHaveLength(1);
      expect(primaries()[0]).toHaveTextContent("Run the delegation");
    };
    check(); // idle
    run();
    await screen.findByText("Running the exchange…");
    check(); // running
    await act(async () => { resolve({ data: { steps, checks: [{ id: "a", label: "ok", pass: true }] } }); });
    await screen.findByText(/checks passed/);
    check(); // verified
    post.mockRejectedValueOnce(Object.assign(new Error("x"), { response: { status: 503, data: { error: "not configured" } } }));
    run();
    await screen.findByRole("alert");
    check(); // error
    fireEvent.click(screen.getByRole("button", { name: /^reset$/i }));
    check(); // after Reset
  });

  it("keeps the status region mounted while idle, so the first change is announced", () => {
    render(<OboDemoPage />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Not run");
    expect(status.querySelector(".pu-chip--neutral")).not.toBeNull();
  });

  it("is green (Verified) only when every check passed; a failed check is danger; no checks is neutral", async () => {
    post.mockResolvedValueOnce({ data: { steps, checks: [{ id: "a", label: "a", pass: true }, { id: "b", label: "b", pass: true }] } });
    const { unmount } = render(<OboDemoPage />);
    run();
    await screen.findByText(/2 of 2 checks passed/);
    expect(screen.getByRole("status").querySelector(".pu-chip--ok")).toHaveTextContent("Verified");
    unmount();

    post.mockResolvedValueOnce({ data: { steps, checks: [{ id: "a", label: "a", pass: true }, { id: "b", label: "b", pass: false }] } });
    const second = render(<OboDemoPage />);
    run();
    await screen.findByText(/1 of 2 checks passed/);
    expect(screen.getByRole("status").querySelector(".pu-chip--danger")).toHaveTextContent("Not verified");
    expect(screen.getByRole("status")).not.toHaveTextContent(/delegation verified/i);
    second.unmount();

    post.mockResolvedValueOnce({ data: { steps, checks: [] } });
    render(<OboDemoPage />);
    run();
    await screen.findByText(/no checks to count/i);
    expect(screen.getByRole("status").querySelector(".pu-chip--neutral")).toHaveTextContent("No checks");
  });

  it("shows a failed run and an errored run as Failed (danger), never as a pass", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("502"), { response: { status: 502, data: { failedStep: 3, steps: [
      { id: 1, status: "pass", facts: {} }, { id: 2, status: "pass", facts: {} },
      { id: 3, status: "fail", facts: { error: "invalid_request" } }, ...[4, 5, 6, 7].map((id) => ({ id, status: "skip", facts: {} })),
    ] } } }));
    const { unmount } = render(<OboDemoPage />);
    run();
    await screen.findByText(/failed at step 3/);
    expect(screen.getByRole("status").querySelector(".pu-chip--danger")).toHaveTextContent("Failed");
    unmount();

    post.mockRejectedValueOnce(Object.assign(new Error("503"), { response: { status: 503, data: { error: "OBO demo is not configured on this environment." } } }));
    render(<OboDemoPage />);
    run();
    await screen.findByRole("alert");
    expect(screen.getByRole("status")).toHaveTextContent("The run did not complete.");
    expect(screen.getByRole("status").querySelector(".pu-chip--danger")).toHaveTextContent("Failed");
  });

  it("gives every trace line a word chip, and shows 'running' on each line while the run is in flight", async () => {
    let resolve;
    post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<OboDemoPage />);
    const trace = screen.getByRole("list", { name: "Delegation trace" });
    expect(within(trace).getAllByText("not run")).toHaveLength(7);
    run();
    await screen.findByText("Running the exchange…");
    expect(within(trace).getAllByText("running")).toHaveLength(7);
    await act(async () => { resolve({ data: { steps, checks: [] } }); });
    expect(within(trace).getAllByText("ok")).toHaveLength(7);
  });

  it("marks the selected trace line with aria-current and moves details without moving focus", async () => {
    post.mockResolvedValueOnce({ data: { steps, checks: [{ id: "a", label: "a", pass: true }] } });
    render(<OboDemoPage />);
    run();
    await screen.findByText(/checks passed/);
    const line = screen.getByRole("button", { name: /Downstream refuses your own token/ });
    line.focus();
    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-current", "true");
    expect(line).toHaveFocus();
    expect(screen.getByRole("heading", { name: /6\. Downstream refuses/ })).toBeInTheDocument();
  });

  it("the Live from Claude card is a live region that is mounted before the first event, and says Waiting until one arrives", () => {
    render(<OboDemoPage />);
    const card = screen.getByTestId("obo-live");
    expect(card).toHaveAttribute("aria-live", "polite");
    expect(card).toHaveTextContent("Waiting");
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify({ source: "claude", ts: "2026-10-14T20:00:00Z", checks: [] }) }); });
    expect(screen.getByTestId("obo-live")).toBe(card);
    expect(card).toHaveTextContent("Received");
    expect(card).toHaveClass("pu-card--live");
  });

  it("embedded in the Personal Agent Studio tab it drops the title band (no second h1) and the 100vh floor class hook, and keeps the banner and the one primary", () => {
    const { container } = render(<OboDemoPage embedded />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByTestId("obo-banner")).toHaveAttribute("role", "note");
    expect(container.querySelector(".pu-page")).toHaveClass("obo-demo--embedded");
    expect(document.querySelectorAll(".pu-btn--primary")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /run the delegation/i })).toBeInTheDocument();
  });
});
