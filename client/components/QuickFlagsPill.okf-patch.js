/**
 * OKF QuickFlagsPill — Patch for QUICK_FLAGS
 *
 * INSTALLATION: Add this entry to the QUICK_FLAGS array in QuickFlagsPill.js
 * (around line 16, alongside existing flag pill entries).
 *
 * Copy the object below into the QUICK_FLAGS array:
 */

// ---------- PASTE INTO QUICK_FLAGS ARRAY ----------

/*
  {
    flag: 'ff_okf_grounding',
    label: 'OKF',
    icon: '📚',
    tooltip: 'Toggle OKF knowledge grounding — agent answers from deterministic assertions with [Kn] citations',
  },
*/

// ---------- END PASTE ----------

module.exports = {
  FLAG_NAME: 'ff_okf_grounding',
  QUICK_FLAG_ENTRY: {
    flag: 'ff_okf_grounding',
    label: 'OKF',
    icon: '📚',
    tooltip: 'Toggle OKF knowledge grounding — agent answers from deterministic assertions with [Kn] citations',
  },
};
