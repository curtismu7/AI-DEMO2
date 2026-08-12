import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import DelegationChainValuePage from "../DelegationChainValuePage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { post: vi.fn(), patch: vi.fn() },
}));

describe("DelegationChainValuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.patch.mockResolvedValue({});
    apiClient.post.mockResolvedValue({ data: { reply: "done", toolsCalled: ["sensitive_holdings"] } });
  });

  it("renders both scenario sections", () => {
    render(<DelegationChainValuePage />);
    // Scoped to the headings: both words also appear in the body copy, so a
    // bare getByText matches multiple nodes and throws.
    expect(screen.getByRole("heading", { name: /Accountability/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Authorization/i })).toBeInTheDocument();
  });

  it("invokes the agent with the accountability trigger phrase on Run", async () => {
    render(<DelegationChainValuePage />);
    const [runButton] = screen.getAllByText("Run");
    fireEvent.click(runButton);

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/agent/invoke",
        expect.objectContaining({ prompt: "hand off to a specialist" }),
      ),
    );
  });

  it("uses the mismatch trigger phrase for the authorization scenario", async () => {
    render(<DelegationChainValuePage />);
    const runButtons = screen.getAllByText("Run");
    fireEvent.click(runButtons[1]);

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/agent/invoke",
        expect.objectContaining({ prompt: "simulate an agent identity mismatch" }),
      ),
    );
  });

  it("arms ff_a2a_delegation before invoking — an unarmed flag drops the A2A overlay heuristics", async () => {
    render(<DelegationChainValuePage />);
    fireEvent.click(screen.getAllByText("Run")[0]);

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/admin/feature-flags",
        { updates: expect.objectContaining({ ff_a2a_delegation: true }) },
      ),
    );
  });

  it("surfaces a failed run instead of leaving the button spinning", async () => {
    apiClient.post.mockRejectedValue(new Error("gateway unreachable"));
    render(<DelegationChainValuePage />);
    fireEvent.click(screen.getAllByText("Run")[0]);

    expect(await screen.findByText("gateway unreachable")).toBeInTheDocument();
  });
});
