const FALLBACK_CHIPS = {
  banking: require('./banking'),
  retail: require('./retail'),
  'sporting-goods': require('./sporting-goods'),
  government: require('./government'),
  workforce: require('./workforce'),
  university: require('./university'),
  manufacturing: require('./manufacturing'),
};

/**
 * Load fallback chip definitions for a vertical
 * @param {string} verticalId - Vertical identifier (banking, retail, etc.)
 * @returns {Array} Chip array with useCaseId fields populated
 */
async function loadFallbackChips(verticalId = 'banking') {
  const chips = FALLBACK_CHIPS[verticalId];

  if (!chips) {
    console.warn(`[fallback-loader] Unknown vertical "${verticalId}", using banking`);
    return FALLBACK_CHIPS.banking;
  }

  return chips;
}

module.exports = {
  loadFallbackChips,
  FALLBACK_CHIPS,
};
