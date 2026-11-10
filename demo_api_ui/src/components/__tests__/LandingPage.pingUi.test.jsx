/**
 * LandingPage on the shared Ping UI primitives (Wave 6): one site header (the app's TopNav, not a second one from this
 * page), one <main> owner, a role="note" banner that states only the sign-in state, and exactly one primary button per
 * state: signed out -> Use Cases, customer -> Customer Dashboard, admin -> Admin Dashboard.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

import LandingPage from "../LandingPage";

const renderPage = (user) =>
  render(
    <MemoryRouter>
      <LandingPage user={user} />
    </MemoryRouter>,
  );

const ACTIONS = ["Admin Dashboard", "Customer Dashboard", "Use Cases", "Setup"];

describe("LandingPage — Ping UI structure", () => {
  beforeEach(() => mockNavigate.mockClear());

  test("a signed-out visitor sees no second site header and one set of four actions", () => {
    const { container } = renderPage(null);
    expect(container.querySelector(".landing-header")).toBeNull();
    expect(screen.queryByText("PingOne Identity")).toBeNull();
    for (const name of ACTIONS) {
      expect(screen.getAllByRole("button", { name }), name).toHaveLength(1);
    }
  });

  test("the page renders no <main> of its own (the app shell owns it) and exactly one h1", () => {
    const { container } = renderPage(null);
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  test("the banner is the first child of the Ping UI page root and is a note", () => {
    const { container } = renderPage(null);
    const root = container.querySelector(".pu-page.landing-page");
    expect(root).toBeTruthy();
    expect(root.firstElementChild.classList.contains("pu-banner-wrap")).toBe(true);
    const banner = screen.getByRole("note");
    expect(banner.getAttribute("data-testid")).toBe("landing-banner");
    expect(banner.textContent).toMatch(/makes no API calls of its own/i);
  });

  test.each([
    [null, "Signed out", "Use Cases"],
    [{ role: "customer" }, "Signed in as customer", "Customer Dashboard"],
    [{ role: "admin" }, "Signed in as admin", "Admin Dashboard"],
  ])("state %j: banner word %s and exactly one primary (%s)", (user, word, primary) => {
    const { container } = renderPage(user);
    expect(within(screen.getByRole("note")).getByText(word)).toBeTruthy();
    const primaries = [...container.querySelectorAll("button.pu-btn--primary")];
    expect(primaries.map((b) => b.textContent)).toEqual([primary]);
    // every hero action is a Ping UI button, none carries the old hero-cta classes
    for (const name of ACTIONS) {
      const btn = screen.getByRole("button", { name });
      expect(btn.classList.contains("pu-btn"), name).toBe(true);
      expect(btn.className).not.toMatch(/hero-cta|btn-primary|btn-secondary/);
    }
  });

  test("the hero actions keep the .landing-hero-actions hook the visibility observer reads", () => {
    const { container } = renderPage(null);
    const row = container.querySelector(".landing-hero-actions");
    expect(row).toBeTruthy();
    expect(within(row).getAllByRole("button")).toHaveLength(4);
  });

  test("the four capability cards stay a labelled list of real list items", () => {
    renderPage(null);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Core Capabilities", level: 2 })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
  });

  test("handlers are unchanged: Customer Dashboard and Setup navigate", () => {
    renderPage({ role: "customer" });
    fireEvent.click(screen.getByRole("button", { name: "Customer Dashboard" }));
    expect(mockNavigate).toHaveBeenLastCalledWith("/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(mockNavigate).toHaveBeenLastCalledWith("/configure");
  });

  test("an admin's Admin Dashboard goes to /admin and a customer's Use Cases to /use-cases/live", () => {
    const first = renderPage({ role: "admin" });
    fireEvent.click(screen.getByRole("button", { name: "Admin Dashboard" }));
    expect(mockNavigate).toHaveBeenLastCalledWith("/admin");
    first.unmount();
    renderPage({ role: "customer" });
    fireEvent.click(screen.getByRole("button", { name: "Use Cases" }));
    expect(mockNavigate).toHaveBeenLastCalledWith("/use-cases/live");
  });
});
