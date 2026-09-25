import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import apiClient from "../services/apiClient";
import DelegationSection from "../pages/agenticAccessConsole/DelegationSection";

vi.mock("../services/apiClient", () => ({ default: { get: vi.fn() } }));

const globalFetch = vi.fn();

describe("Agentic Access Console — Delegation & A2A", () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    globalFetch.mockReset();
    vi.stubGlobal("fetch", globalFetch);
  });

  it("guest: renders live exchange audit (public ring buffer) and specialist registry", async () => {
    apiClient.get.mockResolvedValue({
      data: {
        logs: [
          {
            id: "redis:1",
            timestamp: "2026-09-25T14:02:11.000Z",
            _src: "exchange",
            args: [{ type: "exchange-success", timestamp: "2026-09-25T14:02:11.000Z", message: "issued MCP token", actPresent: true }],
          },
        ],
      },
    });
    globalFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ specialists: [{ vertical: "banking", specialistName: "PaymentsSpecialist", tools: ["create_transfer"] }] }),
    });

    render(<DelegationSection />);

    expect(await screen.findByText("issued MCP token")).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith("/api/logs/exchange?limit=25");
    expect(await screen.findByText("PaymentsSpecialist")).toBeTruthy();
    // Public fetch must not carry cookies — the registry is public by design.
    expect(globalFetch).toHaveBeenCalledWith(
      "/a2a/specialists/registry",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("names the state instead of faking rows when the audit feed errors", async () => {
    apiClient.get.mockRejectedValue(new Error("down"));
    globalFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ specialists: [] }) });

    render(<DelegationSection />);
    await screen.findByText(/Exchange audit log unavailable/);
    expect(screen.queryByText("act ✓")).toBeNull();
  });

  it("keeps the session-scoped log labelled sign-in only", () => {
    apiClient.get.mockResolvedValue({ data: { logs: [] } });
    globalFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ specialists: [] }) });

    render(<DelegationSection />);
    expect(screen.getByText(/session's exchange log/i)).toBeTruthy();
    expect(screen.getByText("sign-in")).toBeTruthy();
  });
});
