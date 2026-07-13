const nlIntentParser = require('./nlIntentParser');
const fallbackChipsLoader = require('../config/fallback-chips/loader');

/**
 * Resolve which vertical's fallback chips to use based on user prompt intent
 * @param {string} userPrompt - User's most recent message
 * @param {object} verticalCtx - Current vertical context (may be undefined/invalid)
 * @returns {object} { chips: Chip[], verticalId: string, isFallback: true }
 */
async function resolveFallbackChips(userPrompt, verticalCtx = {}) {
  try {
    // Try to parse intent from the prompt to detect vertical
    const intent = nlIntentParser.parseForFallback(userPrompt, verticalCtx);

    // Extract vertical from intent result (parseForFallback always sets vertical or returns kind='none')
    const verticalToUse = intent.vertical || 'banking';

    const chips = await fallbackChipsLoader.loadFallbackChips(verticalToUse);

    return {
      chips,
      verticalId: verticalToUse,
      isFallback: true,
      detectionMethod: intent.vertical ? 'parsed' : 'default',
    };
  } catch (error) {
    // Fallback to banking if anything fails
    console.warn('[fallback] Error detecting vertical, using banking default:', error.message);

    const chips = await fallbackChipsLoader.loadFallbackChips('banking');
    return {
      chips,
      verticalId: 'banking',
      isFallback: true,
      detectionMethod: 'default',
    };
  }
}
module.exports = {
  resolveFallbackChips,
};
