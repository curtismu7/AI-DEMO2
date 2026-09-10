import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import apiClient from "../services/apiClient";
import DashboardSection from "../pages/agenticAccessConsole/DashboardSection";

vi.mock("../services/apiClient", () => ({ default: { get: vi.fn() } }));

describe("Agentic Access Console — Dashboard recent decisions", () => {
  // Braces matter: a function returned from beforeEach runs as teardown.
  beforeEach(() => { apiClient.get.mockReset(); });

  it("signed out: no fetch, example rows labelled illustrative", () => {
    render(<DashboardSection user={null} />);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(screen.getByText("Sign in to see live data.")).toBeTruthy();
    expect(screen.getByText("delete_customer")).toBeTruthy();
  });

  it("signed in: renders live decisions, not the hardcoded rows", async () => {
    apiClient.get.mockResolvedValue({ data: { decisions: [{ id: "d1", createdAt: "2026-09-10T15:00:00Z", decision: "DENY" }] } });
    render(<DashboardSection user={{ id: "u1" }} />);
    expect(await screen.findByText("2026-09-10T15:00:00Z")).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith("/api/authorize/recent-decisions?limit=5");
    expect(screen.queryByText("delete_customer")).toBeNull();
    expect(screen.queryByText("Sign in to see live data.")).toBeNull();
  });

  it("signed in, P1AZ not configured (422): names the state instead of faking rows", async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error("Request failed with status code 422"), { response: { status: 422 } }));
    render(<DashboardSection user={{ id: "u1" }} />);
    await waitFor(() => expect(screen.getByText(/worker credentials not configured/)).toBeTruthy());
    expect(screen.queryByText("delete_customer")).toBeNull();
  });
});
