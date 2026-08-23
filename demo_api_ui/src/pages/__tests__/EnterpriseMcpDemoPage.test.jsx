import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  notifyError: vi.fn(), notifySuccess: vi.fn(),
}));
// The filmstrip has its own suite; here it only needs to mount.
vi.mock("../../components/TokenChainFilmstrip", () => ({
  default: () => <div data-testid="filmstrip" />,
}));

import apiClient from "../../services/apiClient";
import EnterpriseMcpDemoPage from "../EnterpriseMcpDemoPage";

const FLAG = "ff_enterprise_managed_mcp_auth";
const flags = (value) => ({ data: { flags: [{ id: FLAG, value }] } });

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.patch.mockResolvedValue({ data: {} });
  apiClient.get.mockResolvedValue(flags(false));
});

describe("page shell", () => {
  it("renders the movie roll", async () => {
    render(<EnterpriseMcpDemoPage />);
    expect(screen.getByTestId("filmstrip")).toBeTruthy();
  });

  it("explains the flow before asking anyone to run it", () => {
    render(<EnterpriseMcpDemoPage />);
    expect(screen.getAllByText(/ID-JAG issued/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ID-JAG redeemed/i).length).toBeGreaterThan(0);
  });

  it("will not let the scenario run before the demo is armed", () => {
    render(<EnterpriseMcpDemoPage />);
    expect(screen.getByRole("button", { name: /Send/i }).disabled).toBe(true);
  });
});

describe("arming", () => {
  it("turns the flag on and enables the run button", async () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /Turn on enterprise-managed auth/i }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/admin/feature-flags", { updates: { [FLAG]: true } },
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/i }).disabled).toBe(false);
    });
  });

  it("shows a standing armed banner, so it cannot be left on silently", async () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /Turn on enterprise-managed auth/i }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toMatch(/ARMED/);
  });

  it("shows the banner on load when the flag was already on", async () => {
    apiClient.get.mockResolvedValue(flags(true));
    render(<EnterpriseMcpDemoPage />);
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  });
});

describe("running", () => {
  it("dispatches the demo chip to the agent", async () => {
    const heard = vi.fn();
    window.addEventListener("banking-agent-prefill", heard);
    render(<EnterpriseMcpDemoPage />);

    fireEvent.click(screen.getByRole("button", { name: /Turn on enterprise-managed auth/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Send/i }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(heard).toHaveBeenCalled();
    // AIAgent.js's listener reads detail.message, not detail.text — a "text" key
    // is silently dropped (no-op) rather than throwing.
    expect(heard.mock.calls[0][0].detail.message).toBe("show my balance");
    expect(heard.mock.calls[0][0].detail.autoSend).toBe(true);
    window.removeEventListener("banking-agent-prefill", heard);
  });
});

describe("reset", () => {
  it("restores OFF when the flag was off before", async () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /Turn on enterprise-managed auth/i }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

    apiClient.patch.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Reset when done/i }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/admin/feature-flags", { updates: { [FLAG]: false } },
      );
    });
  });

  it("turns the flag off even when the page never armed it", async () => {
    apiClient.get.mockResolvedValue(flags(true));
    render(<EnterpriseMcpDemoPage />);
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Reset now/i }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/admin/feature-flags", { updates: { [FLAG]: false } },
      );
    });
  });

  it("clears the banner once reset lands", async () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /Turn on enterprise-managed auth/i }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Reset when done/i }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});

describe("blast radius", () => {
  it("never writes any flag other than the enterprise one", async () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /Turn on enterprise-managed auth/i }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Reset when done/i }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(2));

    for (const [url, body] of apiClient.patch.mock.calls) {
      expect(url).toBe("/api/admin/feature-flags");
      expect(Object.keys(body.updates)).toEqual([FLAG]);
    }
  });
});
