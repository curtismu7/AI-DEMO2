'use strict';

const fs = require('fs');
const path = require('path');
const nlIntentParser = require('./nlIntentParser');
const fallbackChipsLoader = require('../config/fallback-chips/loader');

const VERTICALS_DIR = path.join(__dirname, '..', 'config', 'verticals');
const MAX_SUGGESTIONS = 4;

/**
 * Accept only a well-formed vertical id. Doubles as the path guard for the
 * manifest read below, since the id arrives from a request query param.
 * @returns {string|null}
 */
function normalizeVerticalId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
  return /^[a-z0-9-]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * That vertical's own real chips. They live at `dashboard.chips10`; the
 * manifest top level has no chips array, so reading it yields zero silently.
 * @returns {Array} chips10 for the vertical, or [] if it has no manifest
 */
function loadVerticalChips10(verticalId) {
  if (!verticalId) return [];
  const manifestPath = path.join(VERTICALS_DIR, verticalId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = require(manifestPath);
  return (manifest.dashboard && manifest.dashboard.chips10) || [];
}

/**
 * Explicit "nothing matched" result. Never carries another vertical's chips —
 * the suggestions come from the active vertical alone, and `chips` stays empty
 * so a caller that renders it cannot show foreign data.
 *
 * `closestCandidate` is deliberately absent: parseForFallback is an ordered
 * regex cascade that returns a hit or nothing, so there is no score to report
 * and inventing one would misrepresent the routing.
 */
function buildNoMatch(verticalId) {
  const chips10 = loadVerticalChips10(verticalId);
  const suggestions = chips10.slice(0, MAX_SUGGESTIONS).map((chip) => ({
    id: chip.id,
    label: chip.label,
    message: chip.message,
    tool: chip.tool,
  }));

  const message = verticalId
    ? `No ${verticalId} action matched that request. ${chips10.length} ${chips10.length === 1 ? 'intent was' : 'intents were'} considered and none matched.`
    : 'No vertical is active, so no action could be matched. Choose a vertical and try again.';

  return {
    chips: [],
    verticalId: verticalId || null,
    isFallback: true,
    detectionMethod: 'none',
    noMatch: true,
    intentsConsidered: chips10.length,
    suggestions,
    message,
  };
}

/**
 * Resolve which vertical's fallback chips to use based on user prompt intent.
 * @param {string} userPrompt - User's most recent message
 * @param {object} verticalCtx - Current vertical context (may be undefined/invalid)
 * @returns {object} { chips, verticalId, isFallback, detectionMethod } on a
 *   match, or the no-match shape above. Resolves to one vertical or none —
 *   never to a substitute vertical.
 */
async function resolveFallbackChips(userPrompt, verticalCtx = {}) {
  const ctxVertical = normalizeVerticalId(verticalCtx.verticalId);

  try {
    const intent = nlIntentParser.parseForFallback(userPrompt, verticalCtx);
    const parsedVertical = normalizeVerticalId(intent.vertical);
    const verticalToUse = parsedVertical || ctxVertical;

    if (!verticalToUse) return buildNoMatch(null);

    // kind:'unknown' is parseForFallback's one "nothing matched, but a vertical
    // is active" answer — no banking action, no education topic, and not the
    // active vertical's own keywords either. Serving that vertical's fallback
    // chips would report a MATCH for a prompt nothing matched, and the sole
    // caller (AIAgent.fetchNoMatch) drops any result without `noMatch`, so the
    // user saw a hard-coded banking-phrased sentence instead of the no-match
    // that names their vertical. Now every foreign prompt — a banking transfer
    // typed in government, a retail order typed in banking — lands on the
    // explicit no-match #1214 built, with that vertical's own suggestions.
    if (intent.kind === 'unknown') return buildNoMatch(verticalToUse);

    const chips = await fallbackChipsLoader.loadFallbackChips(verticalToUse);
    if (!chips || chips.length === 0) return buildNoMatch(verticalToUse);

    return {
      chips,
      verticalId: verticalToUse,
      isFallback: true,
      detectionMethod: parsedVertical ? 'parsed' : 'context',
    };
  } catch (error) {
    console.warn(
      `[fallback] Intent detection failed for vertical "${ctxVertical || 'none'}":`,
      error.message
    );
    return buildNoMatch(ctxVertical);
  }
}

module.exports = {
  resolveFallbackChips,
};
