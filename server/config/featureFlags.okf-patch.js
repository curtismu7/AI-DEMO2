/**
 * OKF Feature Flag — Patch for FLAG_REGISTRY
 *
 * INSTALLATION: Add this entry to the FLAG_REGISTRY object in featureFlags.js
 * (around line 33, alongside existing ff_* entries).
 *
 * Copy the object below into FLAG_REGISTRY:
 */

// ---------- PASTE INTO FLAG_REGISTRY ----------

/*
  ff_okf_grounding: {
    name: 'ff_okf_grounding',
    label: 'OKF Knowledge Grounding',
    description:
      'When enabled, injects deterministic OKF knowledge assertions into the demo agent system prompt. ' +
      'The agent will cite assertions using [K1]–[Kn] notation. When disabled, the agent uses only the ' +
      'manifest system prompt (no grounding, no RAG).',
    default: false,
    category: 'agent',
  },
*/

// ---------- END PASTE ----------

/**
 * Usage in consuming code:
 *
 *   const { getFlag } = require('../config/featureFlags');
 *   if (getFlag('ff_okf_grounding')) {
 *     const okfLoader = require('../services/okfLoaderService');
 *     const knowledgeBlock = okfLoader.formatForPrompt('banking-domain');
 *     systemPrompt += '\n' + knowledgeBlock;
 *   }
 */

module.exports = {
  FLAG_NAME: 'ff_okf_grounding',
  FLAG_ENTRY: {
    name: 'ff_okf_grounding',
    label: 'OKF Knowledge Grounding',
    description:
      'When enabled, injects deterministic OKF knowledge assertions into the demo agent system prompt. ' +
      'The agent will cite assertions using [K1]–[Kn] notation. When disabled, the agent uses only the ' +
      'manifest system prompt (no grounding, no RAG).',
    default: false,
    category: 'agent',
  },
};
