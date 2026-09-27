import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgenticAccessConsolePage from "./AgenticAccessConsolePage";

vi.mock("./agenticAccessConsole/DashboardSection", () => ({
  default: () => <div>Dashboard section</div>,
}));

vi.mock("../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { requests: [] } }),
  },
}));

describe("AgenticAccessConsolePage CIBA tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the live CIBA action to a signed-in user", async () => {
    render(<AgenticAccessConsolePage user={{ role: "admin" }} />);

    fireEvent.click(screen.getByRole("button", { name: "CIBA" }));

    expect(
      await screen.findByRole("button", {
        name: "Try it live — initiate a real CIBA request",
      }),
    ).toBeInTheDocument();
  });
});
