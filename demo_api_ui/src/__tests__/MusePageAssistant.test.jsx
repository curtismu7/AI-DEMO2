import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const get = vi.fn();
const post = vi.fn();
vi.mock("../services/apiClient", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
vi.mock("../components/common/PageHeader", () => ({ default: ({ title }) => <h1>{title}</h1> }));

import MusePage from "../pages/MusePage";

const base = { configured: true, lane: "gateway", laneAvailable: true, origin: "https://gw.example", userLogin: false, user: null, liveAuth: { registered: false, signedIn: false, claims: null, error: null, ask: null, answer: null, steps: [], stopped: null } };
const assistants = [{ key: "chatgpt", name: "ChatGPT" }, { key: "meta-ai", name: "Meta AI" }];

describe("MusePage: connect from your assistant", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it("shows no server address or client id, only the assistant tabs and a Connect card", async () => {
    get.mockResolvedValue({ data: { ...base, assistants, assistant: null } });
    render(<MusePage />);
    const panel = await screen.findByTestId("muse-assistant-panel");
    expect(panel.textContent).toContain("ChatGPT");
    expect(panel.textContent).toContain("Meta AI");
    expect(panel.textContent).not.toMatch(/client id|\/mcp|server url/i);
  });

  it("Connect starts the sign-in for the picked assistant and goes to PingOne", async () => {
    get.mockResolvedValue({ data: { ...base, assistants, assistant: null } });
    post.mockResolvedValue({ data: { url: "https://auth.example/authorize?y=1" } });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    render(<MusePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Meta AI" }));
    fireEvent.click(screen.getByTestId("muse-assistant-connect"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/muse/assistant-signin", expect.objectContaining({ assistant: "meta-ai" })));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://auth.example/authorize?y=1"));
  });

  it("after the sign-in it opens on the assistant that connected and shows the points", async () => {
    get.mockResolvedValue({ data: { ...base, assistants, assistant: { key: "meta-ai", name: "Meta AI", answer: { points: 52000, tier: "Premier Gold" }, claims: { sub: "sam", act: { sub: "muse" } }, error: null } } });
    render(<MusePage />);
    const res = await screen.findByTestId("muse-assistant-result");
    expect(res.textContent).toContain("Connected in Meta AI");
    expect(res.textContent).toContain("52,000");
  });

  it("is hidden when the BFF lists no assistants", async () => {
    get.mockResolvedValue({ data: { ...base, assistants: [], assistant: null } });
    render(<MusePage />);
    await screen.findByTestId("muse-page");
    expect(screen.queryByTestId("muse-assistant-panel")).toBeNull();
  });
});
