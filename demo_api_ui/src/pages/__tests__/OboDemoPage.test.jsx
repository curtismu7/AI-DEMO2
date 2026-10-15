import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, act, within } from "@testing-library/react";
import OboDemoPage from "../OboDemoPage";

const post = vi.fn();
const get = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { post: (...a) => post(...a), get: (...a) => get(...a) } }));

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; FakeEventSource.instances.push(this); }
  close() {}
}

const INFO = { mcpUrl: "https://demo.example/api/obo/mcp", clientId: "client-1", callbackPort: 7465 };

beforeEach(() => {
  post.mockReset();
  get.mockReset().mockResolvedValue({ data: INFO });
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

  it("shows the exact claude mcp add command for this origin", async () => {
    render(<OboDemoPage />);
    const cmd = await screen.findByTestId("obo-setup-command");
    expect(cmd).toHaveTextContent("claude mcp add --transport http obo-demo https://demo.example/api/obo/mcp");
    expect(cmd).toHaveTextContent("--client-id client-1");
    expect(cmd).toHaveTextContent("--callback-port 7465");
  });

  it("still renders when /api/obo/info fails, with a plain note instead of the command", async () => {
    get.mockRejectedValueOnce(new Error("503"));
    render(<OboDemoPage />);
    expect(await screen.findByText(/setup command is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run the delegation/i })).toBeEnabled();
  });

  it("renders a live event from Claude when one arrives on the stream", async () => {
    render(<OboDemoPage />);
    expect(screen.getByText(/waiting for claude/i)).toBeInTheDocument();
    const evidence = { source: "claude", ts: "2026-10-14T20:00:00Z", checks: [{ id: "x", label: "live check", pass: true }] };
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify(evidence) }); });
    const live = await screen.findByRole("region", { name: /live from claude/i });
    expect(within(live).getByRole("list", { name: /delegation checks/i })).toHaveTextContent("PASS live check");
    expect(screen.queryByText(/waiting for claude/i)).toBeNull();
  });

  it("includes the token swap diagram", async () => {
    render(<OboDemoPage />);
    expect(await screen.findByLabelText(/token swap diagram/i)).toBeInTheDocument();
  });
});
