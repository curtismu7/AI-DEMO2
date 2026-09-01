'use strict';
/**
 * /internal/feature-flags/weather-mcp-showcase — gateway-only endpoint
 *
 * Lets ping-gateway's tx-weather-scope.groovy check the live value of
 * ff_weather_mcp_showcase on every /mcp/weather request, so a Quick Flags UI
 * toggle takes effect immediately with no gateway restart. Same
 * x-internal-gateway-secret gate as this directory's other /internal/* routes.
 *
 * Status codes:
 *   200  { enabled, allowedState: 'texas'|'michigan'|'any'|'any-except-blocked',
 *            blockedCities: [{label, lat, lon}], blockRadiusDeg }
 *   403  forbidden                — missing or wrong x-internal-gateway-secret
 *
 * blockedCities is only meaningful for allowedState 'any-except-blocked'; it is
 * always sent so the gateway never needs a second round-trip to decide.
 */
const express = require('express');
// Resolved per call — routes are required long before the vault opens, so a
// module-scope snapshot could never see a vault-supplied BFF_INTERNAL_SECRET.
const {
  DEFAULT_INTERNAL_SECRET,
  internalSecret,
  isDefaultInternalSecret,
  internalSecretMatches,
} = require('../utils/internalSecret');
const router = express.Router();
const configStore = require('../services/configStore');
const { getBlockedCities, BLOCK_RADIUS_DEG } = require('../services/weatherBlocklist');


router.get('/feature-flags/weather-mcp-showcase', (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_weather_mcp_showcase');
  const isUnset = raw === null || raw === undefined || raw === '';
  const enabled = isUnset ? true : (raw === true || raw === 'true');

  const rawState = configStore.getEffective('ff_weather_mcp_allowed_state');
  // 'any-except-miami' shipped first and hardcoded one city. The mode is now a
  // configurable list, so the old value is accepted and folded into the new one
  // — without this alias a flag already set to it would fall back to 'texas'
  // SILENTLY and the gateway would start denying every city.
  const normalizedState = rawState === 'any-except-miami' ? 'any-except-blocked' : rawState;
  const allowedState = ['texas', 'michigan', 'any', 'any-except-blocked'].includes(normalizedState)
    ? normalizedState
    : 'texas';

  return res.json({
    enabled,
    allowedState,
    blockedCities: getBlockedCities(),
    blockRadiusDeg: BLOCK_RADIUS_DEG,
  });
});

module.exports = router;
