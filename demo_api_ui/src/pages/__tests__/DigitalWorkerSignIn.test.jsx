import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DigitalWorkerSignIn from "../DigitalWorkerSignIn";
import { openSignIn } from "../../utils/signInService";

vi.mock("../../utils/signInService", () => ({ openSignIn: vi.fn() }));

describe("DigitalWorkerSignIn", () => {
  it("says what signing in unlocks and returns to /digital-worker, whatever page URL is current", () => {
    render(<DigitalWorkerSignIn what="arm the worker" />);
    expect(screen.getByRole("status")).toHaveTextContent("Sign in to arm the worker.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    // Explicit, not the signInService default of window.location.pathname: pinned so a future
    // route change cannot silently send people somewhere else after login.
    expect(openSignIn).toHaveBeenCalledWith({ returnTo: "/digital-worker" });
  });
});
