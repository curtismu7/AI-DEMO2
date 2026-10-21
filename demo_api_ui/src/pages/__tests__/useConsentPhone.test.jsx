import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import useConsentPhone from "../useConsentPhone";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../components/DraggableModal", () => ({ default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null) }));
vi.mock("../../utils/signInService", () => ({ openSignIn: vi.fn() }));

import apiClient from "../../services/apiClient";
import { openSignIn } from "../../utils/signInService";

const SNAPSHOT = { amount: 600, type: "transfer", description: "pay $600 tuition" };
const pending = { state: "pending", loginHint: "tarun", amount: 600, type: "transfer", description: "pay $600 tuition", trace: [] };

// Drives ask() the way the page does and records what it resolves with.
function Harness({ results }) {
  const { ask, host } = useConsentPhone();
  return (
    <>
      <button type="button" onClick={async () => results.push(await ask(SNAPSHOT, "UC38: pay $600 tuition"))}>ask</button>
      {host}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.post.mockReset(); // clearAllMocks leaves unconsumed mockResolvedValueOnce replies queued for the next test
  apiClient.post.mockResolvedValueOnce({ data: pending });
});

describe("useConsentPhone", () => {
  it("renders nothing until someone asks", () => {
    render(<Harness results={[]} />);
    expect(screen.queryByTestId("consent-mock-phone")).toBeNull();
  });

  it("shows the phone for the snapshot and resolves approved when it is tapped", async () => {
    const results = [];
    render(<Harness results={results} />);
    fireEvent.click(screen.getByText("ask"));
    await screen.findByTestId("consent-mock-phone");
    expect(apiClient.post).toHaveBeenCalledWith("/api/consent-mock-phone/start", SNAPSHOT);

    apiClient.post.mockResolvedValueOnce({ data: { ...pending, state: "approved" } });
    fireEvent.click(screen.getByText("Approve on mock phone"));
    await waitFor(() => expect(results).toEqual(["approved"]));
  });

  it("resolves denied", async () => {
    const results = [];
    render(<Harness results={results} />);
    fireEvent.click(screen.getByText("ask"));
    await screen.findByTestId("consent-mock-phone");
    apiClient.post.mockResolvedValueOnce({ data: { ...pending, state: "denied" } });
    fireEvent.click(screen.getByText("Deny on mock phone"));
    await waitFor(() => expect(results).toEqual(["denied"]));
  });

  it("asks a signed-out visitor to sign in (the mock needs a session) instead of showing a dead phone", async () => {
    apiClient.post.mockReset();
    apiClient.post.mockRejectedValueOnce(Object.assign(new Error("Sign in first"), { response: { status: 401, data: { message: "Sign in first" } } }));
    const results = [];
    render(<Harness results={results} />);
    fireEvent.click(screen.getByText("ask"));

    expect(await screen.findByText("Sign in to approve on the mock phone.")).toBeTruthy();
    await waitFor(() => expect(results).toEqual(["signin"]));
    expect(screen.queryByTestId("consent-mock-phone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(openSignIn).toHaveBeenCalledWith({ returnTo: "/digital-worker" });
  });

  it("answers busy to a second ask while the first is still waiting, without starting another request", async () => {
    const results = [];
    render(<Harness results={results} />);
    fireEvent.click(screen.getByText("ask"));
    await screen.findByTestId("consent-mock-phone");
    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => expect(results).toEqual(["busy"]));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("resolves cancelled when the request is cancelled before anyone answers", async () => {
    const results = [];
    render(<Harness results={results} />);
    fireEvent.click(screen.getByText("ask"));
    await screen.findByTestId("consent-mock-phone");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(results).toEqual(["cancelled"]));
    expect(screen.queryByTestId("consent-mock-phone")).toBeNull();
  });

  it("keeps the outcome on screen after the answer and lets the next ask start a fresh request", async () => {
    const results = [];
    render(<Harness results={results} />);
    fireEvent.click(screen.getByText("ask"));
    await screen.findByTestId("consent-mock-phone");
    apiClient.post.mockResolvedValueOnce({ data: { ...pending, state: "approved" } });
    fireEvent.click(screen.getByText("Approve on mock phone"));
    expect(await screen.findByTestId("consent-outcome")).toBeTruthy(); // stays readable until closed

    apiClient.post.mockResolvedValueOnce({ data: pending });
    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3)); // start, decision, start
    await screen.findByTestId("consent-mock-phone");
  });
});
