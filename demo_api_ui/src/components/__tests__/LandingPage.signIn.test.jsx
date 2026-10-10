/**
 * LandingPage — the admin and use-cases CTAs for a signed-out visitor open the
 * branded pi.flow modal (openSignIn/openAdminSignIn); they never redirect
 * straight to a BFF login endpoint.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PI_FLOW_SIGNIN_EVENT } from "../../utils/authUi";

vi.mock("../../services/cachedStatusService", () => ({ clearStatusCache: vi.fn() }));
vi.mock("../../hooks/useAuth", () => ({
  __esModule: true,
  default: () => ({ user: null, loading: false }),
  useAuth: () => ({ user: null, loading: false }),
}));

import LandingPage from "../LandingPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );

describe("LandingPage sign-in triggers", () => {
  let handled;
  let assign;
  beforeEach(() => {
    handled = vi.fn((e) => { e.detail.handled = true; });
    assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://app.test", pathname: "/", href: "", assign },
    });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
  });

  test("Admin Dashboard opens the admin modal event, not a redirect", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Admin Dashboard" })[0]);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(handled.mock.calls[0][0].detail.role).toBe("admin");
    expect(window.location.href).toBe("");
  });

  test("Use Cases opens the customer modal event with a return path, not a redirect", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Use Cases" })[0]);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(handled.mock.calls[0][0].detail.returnTo).toBe("/use-cases/live");
    expect(window.location.href).toBe("");
  });
});
