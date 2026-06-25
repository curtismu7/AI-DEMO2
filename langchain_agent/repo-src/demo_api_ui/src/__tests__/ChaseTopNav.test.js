/**
 * @file ChaseTopNav.test.js
 * Unit tests for the ChaseTopNav component.
 *
 * Covers:
 *   - Renders brand logo area and brand name from industry preset
 *   - Shows user greeting with firstName + lastName when both present
 *   - Falls back to username, then email prefix, then "Guest" for greeting
 *   - Shows "Admin" role label for admin users, "User" for others
 *   - Shows no greeting when user prop is null / undefined
 *   - "Learn" button toggles the TRiSM panel open/closed
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ChaseTopNav from "../components/ChaseTopNav";

// ── Mock heavy child components ───────────────────────────────────────────────
vi.mock("../components/BrandLogo", () => ({ default: () => (
  <svg data-testid="brand-logo" />
) }));

vi.mock(
  "../components/TRiSMTrainingPanel",
  () => ({
    default: function TRiSMTrainingPanel({ isOpen, onClose }) {
      return isOpen ? (
        <div data-testid="trism-panel">
          <button onClick={onClose}>Close</button>
        </div>
      ) : null;
    },
  }),
);

// ── Mock IndustryBrandingContext ──────────────────────────────────────────────
vi.mock("../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Super Bank" } }),
}));

// ── CSS import (no-op in Jest) ────────────────────────────────────────────────
vi.mock("../components/ChaseTopNav.css", () => ({}), { virtual: true });

describe("ChaseTopNav", () => {
  // ── Brand area ──────────────────────────────────────────────────────────────

  it("renders the brand logo", () => {
    render(<ChaseTopNav user={null} />);
    expect(screen.getByTestId("brand-logo")).toBeInTheDocument();
  });

  it("renders the brand short name from the industry preset", () => {
    render(<ChaseTopNav user={null} />);
    expect(screen.getByText("Super Bank")).toBeInTheDocument();
  });

  // ── User greeting ───────────────────────────────────────────────────────────

  it("shows full name when firstName and lastName are both present", () => {
    render(
      <ChaseTopNav
        user={{ firstName: "Alice", lastName: "Smith", role: "user" }}
      />,
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows firstName only when lastName is absent", () => {
    render(<ChaseTopNav user={{ firstName: "Alice", role: "user" }} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("falls back to user.name when firstName/lastName are absent", () => {
    render(<ChaseTopNav user={{ name: "Bob Jones", role: "user" }} />);
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("falls back to username when name is absent", () => {
    render(<ChaseTopNav user={{ username: "carol", role: "user" }} />);
    expect(screen.getByText("carol")).toBeInTheDocument();
  });

  it("falls back to email prefix when username is absent", () => {
    render(<ChaseTopNav user={{ email: "dave@bank.com", role: "user" }} />);
    expect(screen.getByText("dave")).toBeInTheDocument();
  });

  it("shows no greeting section when user prop is null", () => {
    render(<ChaseTopNav user={null} />);
    expect(screen.queryByText(/Admin|User/)).not.toBeInTheDocument();
  });

  // ── Role label ──────────────────────────────────────────────────────────────

  it('shows "Admin" role label for admin user', () => {
    render(<ChaseTopNav user={{ firstName: "Alice", role: "admin" }} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it('shows "User" role label for non-admin user', () => {
    render(<ChaseTopNav user={{ firstName: "Bob", role: "customer" }} />);
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  // ── Learn button / TRiSM panel ──────────────────────────────────────────────

  it("renders the Learn button", () => {
    render(<ChaseTopNav user={null} />);
    expect(
      screen.getByRole("button", { name: /open ai trism training panel/i }),
    ).toBeInTheDocument();
  });

  it("opens the TRiSM panel when Learn is clicked", () => {
    render(<ChaseTopNav user={null} />);
    expect(screen.queryByTestId("trism-panel")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /open ai trism training panel/i }),
    );
    expect(screen.getByTestId("trism-panel")).toBeInTheDocument();
  });

  it("closes the TRiSM panel when the panel fires onClose", () => {
    render(<ChaseTopNav user={null} />);
    fireEvent.click(
      screen.getByRole("button", { name: /open ai trism training panel/i }),
    ); // open
    fireEvent.click(screen.getByRole("button", { name: /close/i })); // close via panel
    expect(screen.queryByTestId("trism-panel")).not.toBeInTheDocument();
  });

  it("toggles the TRiSM panel closed when Learn is clicked again", () => {
    render(<ChaseTopNav user={null} />);
    fireEvent.click(
      screen.getByRole("button", { name: /open ai trism training panel/i }),
    ); // open
    fireEvent.click(
      screen.getByRole("button", { name: /open ai trism training panel/i }),
    ); // close
    expect(screen.queryByTestId("trism-panel")).not.toBeInTheDocument();
  });
});
