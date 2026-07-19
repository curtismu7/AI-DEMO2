/**
 * DeviceSelector — the SMS / email / passkey picker used by both the agent
 * step-up modal and the HITL transaction-consent modal.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DeviceSelector from "../DeviceSelector";

describe("DeviceSelector", () => {
  it("lists enrolled devices only when onRegisterDevice is not provided", () => {
    render(
      <DeviceSelector
        devices={[{ id: "d1", type: "EMAIL", email: "a@b.com" }]}
      />,
    );
    expect(screen.getByText("Email Code")).toBeInTheDocument();
    expect(screen.queryByText(/Set up/)).not.toBeInTheDocument();
  });

  it("offers to set up every method the user has not enrolled", () => {
    render(
      <DeviceSelector
        devices={[{ id: "d1", type: "EMAIL", email: "a@b.com" }]}
        onRegisterDevice={() => {}}
      />,
    );
    expect(screen.getByText("Email Code")).toBeInTheDocument();
    expect(screen.getByText("Set up Passkey")).toBeInTheDocument();
    expect(screen.getByText("Set up SMS Text Message")).toBeInTheDocument();
    // Already enrolled — must not also appear as a setup option.
    expect(screen.queryByText("Set up Email Code")).not.toBeInTheDocument();
  });

  it("shows no setup section once every method is enrolled", () => {
    render(
      <DeviceSelector
        devices={[
          { id: "d1", type: "EMAIL", email: "a@b.com" },
          { id: "d2", type: "SMS", phone: "+15551234567" },
          { id: "d3", type: "FIDO2", nickname: "My key" },
        ]}
        onRegisterDevice={() => {}}
      />,
    );
    expect(screen.queryByText(/Set up/)).not.toBeInTheDocument();
  });

  it("calls onRegisterDevice with the method type when a setup row is clicked", () => {
    const onRegisterDevice = vi.fn();
    render(<DeviceSelector devices={[]} onRegisterDevice={onRegisterDevice} />);
    fireEvent.click(screen.getByText("Set up Passkey"));
    expect(onRegisterDevice).toHaveBeenCalledWith("FIDO2");
  });

  it("disables the other setup rows while one is registering, and labels it Waiting…", () => {
    render(
      <DeviceSelector
        devices={[]}
        onRegisterDevice={() => {}}
        registeringType="FIDO2"
      />,
    );
    expect(screen.getByText("Waiting…")).toBeInTheDocument();
    expect(
      screen.getByText("Set up SMS Text Message").closest("button"),
    ).toBeDisabled();
  });

  it("surfaces a registration error next to the setup rows", () => {
    render(
      <DeviceSelector
        devices={[]}
        onRegisterDevice={() => {}}
        registerError="Passkeys can't be used on this host."
      />,
    );
    expect(
      screen.getByText("Passkeys can't be used on this host."),
    ).toBeInTheDocument();
  });

  it("still selects an already-enrolled device by clicking its row", () => {
    const onSelectDevice = vi.fn();
    render(
      <DeviceSelector
        devices={[{ id: "d1", type: "SMS", phone: "+15551234567" }]}
        onSelectDevice={onSelectDevice}
      />,
    );
    fireEvent.click(screen.getByText("SMS Text Message"));
    expect(onSelectDevice).toHaveBeenCalledWith("d1");
  });
});
