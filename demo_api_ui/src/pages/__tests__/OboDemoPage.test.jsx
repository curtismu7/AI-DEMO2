import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OboDemoPage from "../OboDemoPage";

const post = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { post: (...a) => post(...a) } }));

beforeEach(() => post.mockReset());

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
});
