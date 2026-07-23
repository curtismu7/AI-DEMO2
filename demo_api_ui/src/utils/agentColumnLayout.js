// demo_api_ui/src/utils/agentColumnLayout.js
/** Persist / restore dashboard middle-agent column width. */

export const AGENT_COL_WIDTH_KEY = "ud_agent_col_width_px";

export const AGENT_COL_DEFAULT_WIDTH = 380;
export const AGENT_COL_MIN_WIDTH = 320;
export const AGENT_COL_MAX_WIDTH = 960;

/**
 * Read stored agent-column width, clamped to min/max.
 * @returns {number}
 */
export function readStoredAgentColWidth() {
  try {
    const n = parseInt(localStorage.getItem(AGENT_COL_WIDTH_KEY) || "", 10);
    if (Number.isFinite(n)) {
      return Math.min(AGENT_COL_MAX_WIDTH, Math.max(AGENT_COL_MIN_WIDTH, n));
    }
  } catch {
    /* ignore */
  }
  return AGENT_COL_DEFAULT_WIDTH;
}

/**
 * Persist agent-column width.
 * @param {number} width
 */
export function persistAgentColWidth(width) {
  try {
    localStorage.setItem(AGENT_COL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* ignore */
  }
}
