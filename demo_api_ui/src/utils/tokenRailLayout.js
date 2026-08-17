// demo_api_ui/src/utils/tokenRailLayout.js
/** Persist / restore dashboard Token Chain rail width + collapsed state. */

export const TOKEN_RAIL_WIDTH_KEY = "ud_token_rail_width_px";
// v2: default flipped to collapsed; old key left behind so browsers that had
// the always-expanded default persisted ("0") still start collapsed once.
export const TOKEN_RAIL_COLLAPSED_KEY = "ud_token_rail_collapsed_v2";

export const TOKEN_RAIL_DEFAULT_WIDTH = 320;
export const TOKEN_RAIL_MIN_WIDTH = 220;
export const TOKEN_RAIL_MAX_WIDTH = 560;
export const TOKEN_RAIL_COLLAPSED_WIDTH = 48;

/**
 * Read stored token-rail width, clamped to min/max.
 * @returns {number}
 */
export function readStoredTokenRailWidth() {
  try {
    const n = parseInt(localStorage.getItem(TOKEN_RAIL_WIDTH_KEY) || "", 10);
    if (Number.isFinite(n)) {
      return Math.min(TOKEN_RAIL_MAX_WIDTH, Math.max(TOKEN_RAIL_MIN_WIDTH, n));
    }
  } catch {
    /* ignore */
  }
  return TOKEN_RAIL_DEFAULT_WIDTH;
}

/**
 * Read stored collapsed flag (default: collapsed).
 * @returns {boolean}
 */
export function readStoredTokenRailCollapsed() {
  try {
    const v = localStorage.getItem(TOKEN_RAIL_COLLAPSED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/**
 * Persist token-rail width.
 * @param {number} width
 */
export function persistTokenRailWidth(width) {
  try {
    localStorage.setItem(TOKEN_RAIL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* ignore */
  }
}

/**
 * Persist collapsed flag.
 * @param {boolean} collapsed
 */
export function persistTokenRailCollapsed(collapsed) {
  try {
    localStorage.setItem(TOKEN_RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}
