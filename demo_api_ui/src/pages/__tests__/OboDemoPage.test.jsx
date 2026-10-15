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

  it("disables the button while the run is in flight", async () => {
    let resolve;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<OboDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /run the delegation/i }));
    expect(await screen.findByRole("button", { name: /running/i })).toBeDisabled();
    resolve({ data: { checks: [] } });
    await waitFor(() => expect(screen.getByRole("button", { name: /run the delegation/i })).toBeEnabled());
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
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("heading", { name: /4\. Delegated token/ })).toBeNull();
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });

  it("Reset is disabled when there is nothing to clear and enabled after a run", async () => {
    post.mockResolvedValue(okRun);
    render(<OboDemoPage />);
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeDisabled();
    clickRun();
    await screen.findByRole("status");
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeEnabled();
  });

  it("a response that arrives after Reset is discarded and the page stays usable", async () => {
    let resolve;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<OboDemoPage />);
    clickRun();
    await screen.findByRole("button", { name: /running/i });
    clickReset();
    await act(async () => { resolve(okRun); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /run the delegation/i })).toBeEnabled();
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
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });
});

describe("OboDemoPage title", () => {
  it("is titled Personal Agent User delegation (OBO)", () => {
    render(<OboDemoPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Personal Agent User delegation (OBO)" })).toBeInTheDocument();
  });
});
