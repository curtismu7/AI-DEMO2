import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import apiClient from "../services/apiClient";
import SecuritySection from "../pages/agenticAccessConsole/SecuritySection";

vi.mock("../services/apiClient", () => ({ default: { get: vi.fn() } }));

describe("Agentic Access Console — Security", () => {
  beforeEach(() => { apiClient.get.mockReset(); });

  it("guest: renders gateway decisions it owns (empty list → named empty state, not fake data)", async () => {
    apiClient.get
      .mockResolvedValueOnce({ data: { ok: true, decisions: [] } })
      .mockResolvedValueOnce({ data: { ok: true, lines: ["[P1AZ] permit tool=get_accounts"] } });

    render(<SecuritySection />);

    expect(await screen.findByText(/No decisions visible to you yet/)).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/agent-gateway/decisions?limit=15");
  });

  it("renders permit/deny rows from the gateway decision buffer", async () => {
    apiClient.get
      .mockResolvedValueOnce({
        data: {
          ok: true,
          decisions: [
            { id: "d1", timestamp: "2026-09-25T14:00:00.000Z", tool: "create_transfer", decision: "PERMIT", reason: "policy permit" },
            { id: "d2", timestamp: "2026-09-25T14:01:00.000Z", tool: "redeem_miles", decision: "DENY", reason: "insufficient_scope" },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { ok: true, lines: [] } });

    render(<SecuritySection />);
    expect(await screen.findByText("redeem_miles")).toBeTruthy();
    expect(screen.getByText("insufficient_scope")).toBeTruthy();
    expect(screen.getByText("PERMIT")).toBeTruthy();
    expect(screen.getByText("DENY")).toBeTruthy();
  });

  it("security API panel stays labelled admin-only and attack sim stays a sign-in action", async () => {
    apiClient.get
      .mockResolvedValueOnce({ data: { ok: true, decisions: [] } })
      .mockResolvedValueOnce({ data: { ok: true, lines: [] } });

    render(<SecuritySection />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(screen.getByText("admin")).toBeTruthy();
    expect(screen.getByText(/never an automatic page-load fetch/)).toBeTruthy();
    expect(screen.getByText("sign-in")).toBeTruthy();
  });

  it("gateway log failure renders a human error card, not a blank table", async () => {
    apiClient.get
      .mockResolvedValueOnce({ data: { ok: true, decisions: [] } })
      .mockResolvedValueOnce({ data: { ok: false, error: "gateway not running" } });

    render(<SecuritySection />);
    await screen.findByText(/gateway not running/i);
  });
});
