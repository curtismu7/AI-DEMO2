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
 *   200  { enabled: true|false }  — success
 *   403  forbidden                — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const configStore = require('../services/configStore');

const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);

router.get('/feature-flags/weather-mcp-showcase', (req, res) => {
  const presented = req.headers['x-internal-gateway-secret'];
  const presentedBuf = typeof presented === 'string' ? Buffer.from(presented) : null;
  if (
    !presentedBuf ||
    presentedBuf.length !== INTERNAL_SECRET_BUF.length ||
    !crypto.timingSafeEqual(presentedBuf, INTERNAL_SECRET_BUF)
  ) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_weather_mcp_showcase');
  const enabled = (raw === null || raw === undefined) ? true : (raw === true || raw === 'true');
  return res.json({ enabled });
});

module.exports = router;
