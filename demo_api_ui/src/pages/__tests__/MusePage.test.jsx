import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MusePage from "../MusePage";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));

const base = { configured: true, lane: "gateway", laneAvailable: true, origin: "https://gw", liveAuth: { registered: false, signedIn: false, claims: null, error: null, ask: null, answer: null, steps: [], stopped: null } };
const asked = { ...base, liveAuth: { ...base.liveAuth, ask: { prompt: "Show my airline points" }, steps: [{ n: 1, title: "Call Agent Gateway with no token", request: { method: "POST", url: "https://gw/mcp" }, response: { status: 401, headers: {}, body: {} }, note: "The 401 is the question." }] } };
const wrap = () => render(<MemoryRouter><MusePage /></MemoryRouter>);

beforeEach(() => { get.mockReset(); post.mockReset(); window.localStorage.clear(); });

describe("MusePage", () => {
  it("shows a clear not-configured state and no composer", async () => {
    get.mockResolvedValue({ data: { ...base, configured: false } });
    wrap();
    expect(await screen.findByTestId("muse-not-configured")).toHaveTextContent(/Muse is not configured/);
    expect(screen.queryByLabelText("Ask Muse")).toBeNull();
  });

  it("ask shows the 401 step and a Continue button", async () => {
    get.mockResolvedValueOnce({ data: base }).mockResolvedValue({ data: asked });
    post.mockResolvedValue({ data: { state: "auth_required" } });
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: "Show my airline points" }));
    expect(await screen.findByRole("button", { name: /continue to pingone/i })).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/muse/ask", { prompt: "Show my airline points", lane: "gateway" });
    expect(screen.getByText(/Call Agent Gateway with no token/)).toBeInTheDocument();
  });

  it("run-all-the-way-through removes the Continue button", async () => {
    window.localStorage.setItem("muse.autoPingOne", "1");
    get.mockResolvedValue({ data: asked });
    wrap();
    await screen.findByTestId("muse-page");
    expect(screen.queryByRole("button", { name: /continue to pingone/i })).toBeNull();
  });

  it("renders the answer and names the privilege lane", async () => {
    get.mockResolvedValue({ data: { ...asked, liveAuth: { ...asked.liveAuth, signedIn: true, answer: { points: 12345, tier: "Gold" } } } });
    wrap();
    await waitFor(() => expect(screen.getByTestId("answer")).toHaveTextContent("12,345 points (Gold)"));
    expect(screen.getByRole("button", { name: /Agent Privilege, then Agent Gateway/ })).toBeInTheDocument();
    expect(screen.queryByText(/not working yet/i)).not.toBeInTheDocument();
  });

  it("links to the how-it-works page", async () => {
    get.mockResolvedValue({ data: asked });
    wrap();
    const link = await screen.findByRole("link", { name: /how it works/i });
    expect(link).toHaveAttribute("href", "/how-muse-works.html");
  });
});
