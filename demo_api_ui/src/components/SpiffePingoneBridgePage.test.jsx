import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SpiffePingoneBridgePage from "./SpiffePingoneBridgePage";

describe("SpiffePingoneBridgePage", () => {
  it("shows the simulated identity handoff and the remaining production work", () => {
    render(<SpiffePingoneBridgePage />);

    expect(screen.getByRole("heading", { name: /SPIFFE.*PingOne Bridge/i })).toBeInTheDocument();
    expect(screen.getByText("TODO / simulated")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /presents an SVID/i })).toBeInTheDocument();
    expect(screen.getByText(/SPIFFE ID to PingOne client mapping/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /private_key_jwt/i })).toBeInTheDocument();
    expect(screen.getByText(/Live SPIRE verification/)).toBeInTheDocument();
    expect(screen.getByText(/unknown or unmapped identities/i)).toBeInTheDocument();
  });

  it("opens the agent movie reel and can switch to sequence view", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(<SpiffePingoneBridgePage />);

    fireEvent.click(screen.getByRole("button", { name: /run simulated bridge/i }));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "banking-agent-open" }));
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: "agent-sequence-diagram-toggle",
        detail: expect.objectContaining({ on: false, surface: "none" }),
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: "agent-filmstrip-toggle",
        detail: expect.objectContaining({ on: true }),
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: /show sequence view/i }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "agent-filmstrip-toggle",
      detail: expect.objectContaining({ on: false, surface: "none" }),
    }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "agent-sequence-diagram-toggle",
      detail: expect.objectContaining({ on: true }),
    }));

    dispatchSpy.mockRestore();
  });
});
