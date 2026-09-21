import { render, screen } from "@testing-library/react";
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
});
