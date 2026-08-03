const express = require('express');
const router = express.Router();
const fallbackDataResolver = require('../../services/fallbackDataResolver');

/**
 * GET /api/fallback/chips
 * Resolve fallback chips based on user prompt intent
 */
router.get('/chips', async (req, res) => {
  const { prompt, verticalId } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const result = await fallbackDataResolver.resolveFallbackChips(prompt, {
      verticalId: verticalId === 'undefined' ? undefined : verticalId,
    });

    // Spreading the result keeps the no-match fields (noMatch, suggestions,
    // intentsConsidered, message) intact; dropping them would leave the caller
    // with an empty chip list and no reason for it.
    res.json({
      chips: result.chips,
      verticalId: result.verticalId,
      isFallback: result.isFallback,
      detectionMethod: result.detectionMethod,
      ...(result.noMatch
        ? {
            noMatch: true,
            intentsConsidered: result.intentsConsidered,
            suggestions: result.suggestions,
            message: result.message,
          }
        : {}),
    });
  } catch (error) {
    console.error('[fallback-route] Error resolving chips:', error);
    res.status(500).json({ error: 'Failed to resolve fallback chips' });
  }
});

module.exports = router;
