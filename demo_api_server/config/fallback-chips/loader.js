const FALLBACK_CHIPS = {
  banking: require('./banking'),
  retail: require('./retail'),
  'sporting-goods': require('./sporting-goods'),
  government: require('./government'),
  workforce: require('./workforce'),
  university: require('./university'),
  manufacturing: require('./manufacturing'),
  healthcare: require('./healthcare'),
  investment: require('./investment'),
};

/**
 * Load fallback chip definitions for a vertical.
 *
 * Returns null when the vertical has no chips of its own. Callers MUST NOT
 * substitute another vertical's chips: defaulting to banking here surfaced
 * bank account actions inside healthcare.
 *
 * @param {string} verticalId - Vertical identifier (banking, retail, etc.)
 * @returns {Array|null} That vertical's chip array, or null if it has none
 */
async function loadFallbackChips(verticalId) {
  // hasOwnProperty: verticalId is request-supplied, so a bare lookup would
  // resolve inherited keys like "constructor".
  if (!Object.prototype.hasOwnProperty.call(FALLBACK_CHIPS, verticalId)) {
    return null;
  }

  return FALLBACK_CHIPS[verticalId];
}

module.exports = {
  loadFallbackChips,
  FALLBACK_CHIPS,
};
