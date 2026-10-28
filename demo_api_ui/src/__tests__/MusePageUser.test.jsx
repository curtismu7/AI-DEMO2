import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const get = vi.fn();
const post = vi.fn();
vi.mock("../services/apiClient", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
vi.mock("../components/common/PageHeader", () => ({ default: ({ title }) => <h1>{title}</h1> }));

import MusePage from "../pages/MusePage";

const base = { configured: true, lane: "privilege", laneAvailable: true, origin: "https://gw.example", liveAuth: { registered: false, signedIn: false, claims: null, error: null, ask: null, answer: null, steps: [], stopped: null } };

describe("MusePage: just a user, no agent", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it("shows nothing when the user-only sign-in is not configured", async () => {
    get.mockResolvedValue({ data: { ...base, userLogin: false, user: null } });
    render(<MusePage />);
    await screen.findByTestId("muse-page");
    expect(screen.queryByTestId("muse-user-panel")).toBeNull();
  });

  it("starts the sign-in against the user-only route and goes to PingOne", async () => {
    get.mockResolvedValue({ data: { ...base, userLogin: true, user: null } });
    post.mockResolvedValue({ data: { url: "https://auth.example/authorize?x=1" } });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    render(<MusePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Sign in as Sam \(no agent\)/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/muse/user-signin", expect.objectContaining({ mfa: "on" })));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.example/authorize?x=1"));
  });

  it("shows Sam's own token without an agent claim and says the gateway denied it", async () => {
    get.mockResolvedValue({ data: { ...base, userLogin: true, user: { claims: { sub: "sam", aud: ["https://api.pingone.com"], scope: "openid" }, denied: true, error: null, steps: [{ n: 6, title: "Swap the code", note: "n", response: { status: 200 } }, { n: 7, title: "Call Agent Privilege with the token", note: "n", response: { status: 401 } }] } } });
    render(<MusePage />);
    const res = await screen.findByTestId("muse-user-result");
    expect(res.textContent).toContain('"act":"none"');
    expect(await screen.findByTestId("muse-user-denied")).toBeTruthy();
    expect(screen.queryByTestId("muse-user-allowed")).toBeNull();
  });
});
