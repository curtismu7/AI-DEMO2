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

  it("is a visible message with a word chip, says why (401), and holds the view's one primary", () => {
    const { container } = render(<DigitalWorkerSignIn what="run the governed worker" />);
    expect(screen.getByText("Sign-in needed")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(/answered 401/);
    const primaries = container.querySelectorAll(".pu-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe("Sign in");
  });

  it("is a secondary when the caller says another primary owns the view", () => {
    const { container } = render(<DigitalWorkerSignIn what="approve on the mock phone" primary={false} />);
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Sign in" }).classList.contains("pu-btn")).toBe(true);
  });

  it("focusOnMount moves keyboard focus to the named group, so a prompt that replaces a pressed control does not drop focus to the body", () => {
    render(<DigitalWorkerSignIn what="approve on the mock phone" focusOnMount />);
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Sign-in needed" }));
  });

  it("does not move focus by default", () => {
    render(<DigitalWorkerSignIn what="arm the worker" />);
    expect(document.activeElement).toBe(document.body);
  });

  it("does not navigate on its own: nothing opens until Sign in is pressed", () => {
    openSignIn.mockClear();
    render(<DigitalWorkerSignIn what="arm the worker" />);
    expect(openSignIn).not.toHaveBeenCalled();
  });
});
