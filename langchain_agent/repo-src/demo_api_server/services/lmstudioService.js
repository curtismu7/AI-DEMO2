/**
 * Shared LM Studio helpers — base URL resolution and provider key.
 *
 * Extracted here so lmstudio.js routes and llmProviderStatus.js both read
 * from configStore consistently, avoiding duplicated strip-/v1 logic.
 */
const configStore = require('./configStore');

const DEFAULT_LMSTUDIO_BASE = 'http://localhost:1234';

/**
 * Returns the LM Studio origin (no trailing slash, no /v1 suffix).
 * Priority: configStore → LMSTUDIO_BASE_URL env → default localhost:1234.
 */
function getLmStudioBase() {
  const raw = configStore.getEffective('lmstudio_base_url') ||
    process.env.LMSTUDIO_BASE_URL ||
    DEFAULT_LMSTUDIO_BASE;
  // Strip /v1 suffix — we always talk to the origin; each path is appended explicitly.
  return raw.replace(/\/v1\/?$/, '');
}

module.exports = { getLmStudioBase, DEFAULT_LMSTUDIO_BASE };
