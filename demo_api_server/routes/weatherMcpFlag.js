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
 *   200  { enabled: true|false, allowedState: 'texas'|'michigan'|'any'|'any-except-miami' }
 *   403  forbidden                — missing or wrong x-internal-gateway-secret
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


router.get('/feature-flags/weather-mcp-showcase', (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_weather_mcp_showcase');
  const isUnset = raw === null || raw === undefined || raw === '';
  const enabled = isUnset ? true : (raw === true || raw === 'true');

  const rawState = configStore.getEffective('ff_weather_mcp_allowed_state');
  const allowedState = ['texas', 'michigan', 'any', 'any-except-miami'].includes(rawState)
    ? rawState
    : 'texas';

  return res.json({ enabled, allowedState });
});

module.exports = router;
