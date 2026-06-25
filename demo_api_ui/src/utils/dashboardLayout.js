// banking_api_ui/src/utils/dashboardLayout.js
/** Customer dashboard: classic (token + banking + floating zone) vs split3 (token | agent | banking). */

const STORAGE_KEY = "banking_dashboard_layout";

/**
 * @returns {'classic' | 'split3'}
 */
export function getDashboardLayout() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "classic") return "classic";
    return "split3";
  } catch {
    return "split3";
  }
}

/**
 * @param {'classic' | 'split3'} mode
 */
export function setDashboardLayout(mode) {
  const m = mode === "classic" ? "classic" : "split3";
  try {
    localStorage.setItem(STORAGE_KEY, m);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent("banking-dashboard-layout", { detail: { layout: m } }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * CSS class(es) for the middle-agent split3 grid container.
 * When the banking column is hidden, append the modifier that collapses
 * the grid from 3 tracks (token | agent | banking) to 2 (token | agent).
 *
 * @param {boolean} showBankingInMiddle
 * @returns {string}
 */
export function splitGridClass(showBankingInMiddle) {
  return showBankingInMiddle
    ? "ud-body--dashboard-split3"
    : "ud-body--dashboard-split3 ud-body--dashboard-split3--no-banking";
}
