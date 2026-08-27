import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import SessionReauthBanner from "../SessionReauthBanner";

// The education drawer is irrelevant here and pulls in a provider tree.
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));

const navSpies = vi.hoisted(() => ({
  force: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("../../utils/authUi", () => ({
  navigateToCustomerOAuthForceLogin: navSpies.force,
  navigateToAdminOAuthLogin: navSpies.admin,
}));

// Stand in for DraggableModal. The real one renders through its own portal
// root, which React Testing Library's cleanup does not reap — left in place it
// leaks DOM into whatever test runs next in the same worker. What matters here
// is which branch renders and what it is given, not the modal chrome (that has
// its own tests).
vi.mock("../DraggableModal", () => ({
  default: ({ isOpen, title, children, footer }) =>
    isOpen ? (
      <div data-testid="draggable-modal">
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
}));

// These tests navigate to assert returnTo. Restore the URL afterwards: leaving
// the jsdom history on another path leaks into whatever runs next in the
// worker, which is exactly how an unrelated suite starts failing.
let originalUrl;

beforeEach(() => {
  originalUrl = window.location.href;
  navSpies.force.mockClear();
  navSpies.admin.mockClear();
});

afterEach(() => {
  window.history.pushState({}, "", originalUrl);
});

describe("SessionReauthBanner", () => {
  it("renders session expiry inside a modal, not the fixed banner", () => {
    const { container } = render(
      <SessionReauthBanner message="Your session expired." role="customer" onDismiss={() => {}} />,
    );

    expect(screen.getByText("Your session expired.")).toBeInTheDocument();
    expect(screen.getByTestId("draggable-modal")).toBeInTheDocument();
    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    // The fixed banner shell must NOT be what renders for an expiry.
    expect(container.querySelector(".session-reauth-banner__inner")).toBeNull();
  });

  it("tells the user they will come back to the page", () => {
    render(<SessionReauthBanner message="expired" role="customer" onDismiss={() => {}} />);
    expect(screen.getByText(/come back to this page/i)).toBeInTheDocument();
  });

  it("passes the current path as returnTo when signing in", () => {
    window.history.pushState({}, "", "/agent-gateway-inspector");
    render(<SessionReauthBanner message="expired" role="customer" onDismiss={() => {}} />);

    screen.getByRole("button", { name: "Sign In" }).click();

    expect(navSpies.force).toHaveBeenCalledWith("/agent-gateway-inspector");
  });

  it("uses the admin flow for an admin session", () => {
    window.history.pushState({}, "", "/admin");
    render(<SessionReauthBanner message="expired" role="admin" onDismiss={() => {}} />);

    screen.getByRole("button", { name: "Admin Sign In" }).click();

    expect(navSpies.admin).toHaveBeenCalledWith("/admin");
    expect(navSpies.force).not.toHaveBeenCalled();
  });

  // HITL consent is a protected flow — this change must not restyle it.
  it("keeps the fixed banner for the HITL approval case", () => {
    const { container } = render(
      <SessionReauthBanner message="Approve the transfer." role="customer" isHITL onDismiss={() => {}} />,
    );

    expect(container.querySelector(".session-reauth-banner--hitl")).not.toBeNull();
    expect(screen.getByText("Manual approval required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn more" })).toBeInTheDocument();
    // Not a modal.
    expect(screen.queryByTestId("draggable-modal")).toBeNull();
    expect(screen.queryByText("Sign in required")).toBeNull();
  });
});
