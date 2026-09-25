import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PingOneProtectBrowserDemo from "../PingOneProtectBrowserDemo";
import { evaluateProtectBrowserRisk } from "../../services/protectAuthenticationService";
import { collectPingOneSignals } from "../../lib/pingOneSignalsSdk";
import { getSdkClient } from "../../lib/oidcSdkClient";

vi.mock("../../services/protectAuthenticationService", () => ({
  evaluateProtectBrowserRisk: vi.fn(),
}));
vi.mock("../../lib/pingOneSignalsSdk", () => ({ collectPingOneSignals: vi.fn() }));
vi.mock("../../lib/oidcSdkClient", () => ({ getSdkClient: vi.fn() }));

describe("PingOneProtectBrowserDemo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    collectPingOneSignals.mockResolvedValue("private-signals-payload");
    evaluateProtectBrowserRisk.mockResolvedValue({
      level: "LOW",
      recommendedAction: "ALLOW",
      botDetection: { level: "LOW", status: "COMPLETE", detectedRuleId: "rule-1" },
    });
  });

  it("collects Signals, evaluates with Protect, and displays the response without starting OIDC", async () => {
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/username or email to evaluate/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect evaluation/i }));

    expect(await screen.findByRole("region", { name: /protect risk evaluation response/i })).toHaveTextContent("LOW");
    expect(screen.getByRole("region", { name: /protect risk evaluation response/i })).toHaveTextContent("ALLOW");
    expect(screen.getByRole("region", { name: /protect risk evaluation response/i })).toHaveTextContent("COMPLETE");
    expect(collectPingOneSignals).toHaveBeenCalledOnce();
    expect(evaluateProtectBrowserRisk).toHaveBeenCalledWith({ userId: "alice@example.com", signalsData: "private-signals-payload" });
    expect(getSdkClient).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("protect-auth-flow-v1")).toBeNull();
    expect(document.body.textContent).not.toContain("private-signals-payload");
  });

  it.each(["LOW", "MEDIUM", "HIGH"])("shows the Protect %s response as an evaluation result", async (level) => {
    evaluateProtectBrowserRisk.mockResolvedValue({ level, recommendedAction: "REVIEW" });
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/username or email to evaluate/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect evaluation/i }));

    const response = await screen.findByRole("region", { name: /protect risk evaluation response/i });
    expect(response).toHaveTextContent(level);
    expect(response).toHaveTextContent("REVIEW");
    expect(getSdkClient).not.toHaveBeenCalled();
  });

  it("fails closed when Signals collection fails", async () => {
    collectPingOneSignals.mockRejectedValue(new Error("Signals unavailable"));
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/username or email to evaluate/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect evaluation/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Signals unavailable");
    expect(evaluateProtectBrowserRisk).not.toHaveBeenCalled();
    expect(getSdkClient).not.toHaveBeenCalled();
  });

  it("opens a standalone pop-out and exposes a theme toggle", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ focus: vi.fn() });
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /open protect demo pop-out/i }));
    expect(open).toHaveBeenCalledWith("/protect-auth-demo/popout", "pingone-protect-auth", expect.stringContaining("popup"));
    expect(screen.getByRole("button", { name: /switch to (light|dark) theme/i })).toBeInTheDocument();
  });
});
