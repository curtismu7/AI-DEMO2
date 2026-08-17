// demo_api_ui/src/utils/__tests__/tokenRailLayout.test.js
import { beforeEach, describe, expect, it } from "vitest";
import {
  TOKEN_RAIL_COLLAPSED_KEY,
  TOKEN_RAIL_DEFAULT_WIDTH,
  TOKEN_RAIL_MAX_WIDTH,
  TOKEN_RAIL_MIN_WIDTH,
  TOKEN_RAIL_WIDTH_KEY,
  persistTokenRailCollapsed,
  persistTokenRailWidth,
  readStoredTokenRailCollapsed,
  readStoredTokenRailWidth,
} from "../tokenRailLayout";

describe("tokenRailLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns default width when nothing stored", () => {
    expect(readStoredTokenRailWidth()).toBe(TOKEN_RAIL_DEFAULT_WIDTH);
  });

  it("clamps stored width to min/max", () => {
    localStorage.setItem(TOKEN_RAIL_WIDTH_KEY, "50");
    expect(readStoredTokenRailWidth()).toBe(TOKEN_RAIL_MIN_WIDTH);
    localStorage.setItem(TOKEN_RAIL_WIDTH_KEY, "9999");
    expect(readStoredTokenRailWidth()).toBe(TOKEN_RAIL_MAX_WIDTH);
  });

  it("persists width and collapsed flag", () => {
    persistTokenRailWidth(400);
    persistTokenRailCollapsed(true);
    expect(localStorage.getItem(TOKEN_RAIL_WIDTH_KEY)).toBe("400");
    expect(localStorage.getItem(TOKEN_RAIL_COLLAPSED_KEY)).toBe("1");
    expect(readStoredTokenRailCollapsed()).toBe(true);
  });

  it("treats missing collapsed key as collapsed", () => {
    expect(readStoredTokenRailCollapsed()).toBe(true);
  });

  it("respects an explicit expanded choice", () => {
    persistTokenRailCollapsed(false);
    expect(readStoredTokenRailCollapsed()).toBe(false);
  });
});
