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
    expect(list).toHaveTextContent("PASS sub is preserved");
    expect(list).toHaveTextContent("FAIL act names the agent");
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
});
