/**
 * OKF ConfigStore — Patch for FIELD_DEFS
 *
 * INSTALLATION: Add this entry to the FIELD_DEFS object in configStore.js
 * (around line 299, alongside existing ff_* field definitions).
 *
 * Copy the object below into FIELD_DEFS:
 */

// ---------- PASTE INTO FIELD_DEFS ----------

/*
  ff_okf_grounding: {
    type: 'boolean',
    default: false,
    label: 'OKF Knowledge Grounding',
    description: 'Inject OKF assertions into agent system prompts for deterministic, citable answers.',
    category: 'flags',
    restart: false,
  },
*/

// ---------- END PASTE ----------

module.exports = {
  FIELD_NAME: 'ff_okf_grounding',
  FIELD_DEF: {
    type: 'boolean',
    default: false,
    label: 'OKF Knowledge Grounding',
    description: 'Inject OKF assertions into agent system prompts for deterministic, citable answers.',
    category: 'flags',
    restart: false,
  },
};
