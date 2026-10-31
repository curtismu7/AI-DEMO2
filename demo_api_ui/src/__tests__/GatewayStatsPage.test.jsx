// GatewayStatsPage.test.jsx — /gateway-stats frames the admin-gated BFF stats proxy, and
// Mission Control links to it.
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import GatewayStatsPage from "../components/GatewayStatsPage";
import { MISSION_CONTROL_CATALOG } from "../config/missionControlCatalog";

describe("GatewayStatsPage", () => {
  it("iframes the BFF stats proxy, not HAProxy directly", () => {
    render(<GatewayStatsPage />);
    expect(screen.getByRole("heading", { name: "Gateway stats" })).toBeTruthy();
    expect(screen.getByTitle("HAProxy LB stats").getAttribute("src")).toBe("/api/admin/lb/runtime/stats-view");
  });

  it("is linked from Mission Control", () => {
    expect(JSON.stringify(MISSION_CONTROL_CATALOG)).toContain("/gateway-stats");
  });
});
