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

    res.json({
      chips: result.chips,
      verticalId: result.verticalId,
      isFallback: result.isFallback,
      detectionMethod: result.detectionMethod,
    });
  } catch (error) {
    console.error('[fallback-route] Error resolving chips:', error);
    res.status(500).json({ error: 'Failed to resolve fallback chips' });
  }
});

module.exports = router;
