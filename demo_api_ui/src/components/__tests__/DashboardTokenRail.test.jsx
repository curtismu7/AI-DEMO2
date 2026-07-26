// demo_api_ui/src/components/__tests__/DashboardTokenRail.test.jsx
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DashboardTokenRail from "../DashboardTokenRail";
import {
  TOKEN_RAIL_COLLAPSED_KEY,
  TOKEN_RAIL_COLLAPSED_WIDTH,
  TOKEN_RAIL_DEFAULT_WIDTH,
  TOKEN_RAIL_WIDTH_KEY,
} from "../../utils/tokenRailLayout";

describe("DashboardTokenRail", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders children expanded by default with default width", () => {
    render(
      <DashboardTokenRail>
        <div data-testid="rail-child">chain</div>
      </DashboardTokenRail>,
    );
    const rail = screen.getByTestId("dashboard-token-rail");
    expect(rail).toHaveAttribute("data-collapsed", "false");
    expect(rail.style.width).toBe(`${TOKEN_RAIL_DEFAULT_WIDTH}px`);
    expect(screen.getByTestId("rail-child")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-token-rail-resize")).toBeInTheDocument();
  });

  it("collapses and expands like the side nav toggle", () => {
    render(
      <DashboardTokenRail>
        <div>chain</div>
      </DashboardTokenRail>,
    );
    const toggle = screen.getByTestId("dashboard-token-rail-toggle");
    fireEvent.click(toggle);
    const rail = screen.getByTestId("dashboard-token-rail");
    expect(rail).toHaveAttribute("data-collapsed", "true");
    expect(rail.style.width).toBe(`${TOKEN_RAIL_COLLAPSED_WIDTH}px`);
    expect(localStorage.getItem(TOKEN_RAIL_COLLAPSED_KEY)).toBe("1");
    expect(
      screen.queryByTestId("dashboard-token-rail-resize"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(rail).toHaveAttribute("data-collapsed", "false");
    expect(localStorage.getItem(TOKEN_RAIL_COLLAPSED_KEY)).toBe("0");
  });

  it("restores collapsed state from localStorage", () => {
    localStorage.setItem(TOKEN_RAIL_COLLAPSED_KEY, "1");
    localStorage.setItem(TOKEN_RAIL_WIDTH_KEY, "400");
    render(
      <DashboardTokenRail>
        <div>chain</div>
      </DashboardTokenRail>,
    );
    expect(screen.getByTestId("dashboard-token-rail")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });
});
