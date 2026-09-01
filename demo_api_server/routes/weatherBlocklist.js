'use strict';
/**
 * /api/weather-blocklist — admin surface for the weather-mcp deny list.
 *
 * Reads are open (the showcase page renders the policy for a signed-out
 * visitor, exactly like the feature-flag pill). Mutations go through the SAME
 * gate as feature-flag mutations, so this route cannot become a quieter way to
 * change gateway policy than the flags API it sits beside.
 *
 *   GET    /api/weather-blocklist          -> { cities: [{label, lat, lon}], radiusDeg }
 *   POST   /api/weather-blocklist          { city } -> geocode + add
 *   DELETE /api/weather-blocklist/:label   -> remove
 */
const express = require('express');
const router = express.Router();
const {
  BLOCK_RADIUS_DEG,
  getBlockedCities,
  addCity,
  removeCity,
} = require('../services/weatherBlocklist');

router.get('/', (req, res) => {
  res.json({ cities: getBlockedCities(), radiusDeg: BLOCK_RADIUS_DEG });
});

router.post('/', async (req, res) => {
  const city = req.body && req.body.city;
  if (typeof city !== 'string' || !city.trim()) {
    return res.status(400).json({ error: 'Body must be { city: "<place>" }' });
  }
  try {
    const { list, added } = await addCity(city);
    return res.json({ cities: list, radiusDeg: BLOCK_RADIUS_DEG, added });
  } catch (err) {
    // 404 (no such place) and 502 (geocoder unreachable) are different problems
    // for the admin — one is a typo, the other is not their fault. Keep them apart.
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

router.delete('/:label', async (req, res) => {
  try {
    const { list, removed } = await removeCity(req.params.label);
    if (!removed) return res.status(404).json({ error: 'not on the list' });
    return res.json({ cities: list, radiusDeg: BLOCK_RADIUS_DEG });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
