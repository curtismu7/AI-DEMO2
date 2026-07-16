/**
 * OKF Prompt Injector
 *
 * Middleware service that conditionally appends OKF knowledge assertions to
 * the demo agent's system prompt when ff_okf_grounding is enabled.
 *
 * Usage:
 *   const { injectOkfKnowledge } = require('./okfPromptInjector');
 *   const augmentedPrompt = injectOkfKnowledge(systemPrompt, { domain: 'banking-domain' });
 */

const okfLoader = require('./okfLoaderService');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_DOMAIN = 'banking-domain';

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Resolves the current value of ff_okf_grounding.
 * Uses configStore.getEffective() — the same pattern as the rest of the BFF.
 * Avoids caching a broken require — re-attempts on each call so that if
 * configStore initializes late, subsequent calls succeed.
 *
 * @returns {boolean}
 */
function isFlagEnabled() {
  // Primary: try configStore (may not be available during early startup or in tests)
  try {
    const configStore = require('./configStore');
    if (typeof configStore.getEffective !== 'function') {
      // Module loaded but not fully initialized — fall through to env
      return process.env.FF_OKF_GROUNDING === 'true' || process.env.FF_OKF_GROUNDING === '1';
    }
    const raw = configStore.getEffective('ff_okf_grounding');
    // configStore stores booleans as strings ('true'/'false')
    return raw === true || raw === 'true' || raw === '1';
  } catch (err) {
    // configStore not available (testing, standalone, or startup race).
    // Do NOT cache this failure — next call re-attempts require() which
    // returns the cached module if it has since loaded successfully.
    return process.env.FF_OKF_GROUNDING === 'true' || process.env.FF_OKF_GROUNDING === '1';
  }
}

/**
 * Conditionally appends OKF knowledge block to a system prompt.
 *
 * When ff_okf_grounding is OFF (or bundle is unavailable), returns the
 * original prompt unchanged — zero side effects.
 *
 * @param {string} systemPrompt - The existing system prompt
 * @param {object} [opts] - Options
 * @param {string} [opts.domain] - Domain to inject (default: 'banking-domain')
 * @param {string[]} [opts.tags] - Optional tag filter for assertions
 * @param {boolean} [opts.forceFlag] - Override flag check (for testing/preview)
 * @returns {string} The (possibly augmented) system prompt
 */
function injectOkfKnowledge(systemPrompt, opts = {}) {
  // Guard: if systemPrompt is null/undefined (e.g., missing manifest), passthrough unchanged
  if (!systemPrompt) {
    return systemPrompt;
  }

  const {
    domain = DEFAULT_DOMAIN,
    tags,
    forceFlag,
  } = opts;

  // Gate on feature flag
  const enabled = forceFlag !== undefined ? forceFlag : isFlagEnabled();
  if (!enabled) {
    return systemPrompt;
  }

  // Ensure loader is initialized
  if (!okfLoader.isInitialized()) {
    const result = okfLoader.initialize();
    if (result.errors.length > 0 && result.loaded === 0) {
      // Silent fallback — don't break the agent if bundles are missing
      console.warn('[OKF] Loader initialization had errors:', result.errors);
      return systemPrompt;
    }
  }

  // Get formatted knowledge block
  const filterOpts = tags ? { tags } : {};
  const knowledgeBlock = okfLoader.formatForPrompt(domain, filterOpts);

  if (!knowledgeBlock) {
    return systemPrompt;
  }

  // Inject after the existing system prompt with clear separation
  return systemPrompt + '\n\n' + knowledgeBlock;
}

/**
 * Returns metadata about what would be injected (for debugging / admin UI).
 *
 * @param {object} [opts]
 * @param {string} [opts.domain]
 * @returns {object} { enabled, domain, assertionCount, version, title }
 */
function getInjectionStatus(opts = {}) {
  const domain = opts.domain || DEFAULT_DOMAIN;
  const enabled = isFlagEnabled();

  if (!okfLoader.isInitialized()) {
    okfLoader.initialize();
  }

  const meta = okfLoader.getBundleMeta(domain);

  return {
    enabled,
    domain,
    bundleLoaded: !!meta,
    assertionCount: meta ? meta.assertionCount : 0,
    version: meta ? meta.version : null,
    title: meta ? meta.title : null,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  injectOkfKnowledge,
  getInjectionStatus,
  // Exported for testing
  _isFlagEnabled: isFlagEnabled,
};
