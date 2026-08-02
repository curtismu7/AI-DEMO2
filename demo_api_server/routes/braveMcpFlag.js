'use strict';
/**
 * /internal/feature-flags/brave-mcp-showcase — gateway-only endpoint
 *
 * Lets ping-gateway's tx-brave-scope.groovy check the live value of
 * ff_brave_mcp_showcase on every /mcp/brave request, so a Quick Flags UI
 * toggle takes effect immediately with no gateway restart. Same
 * x-internal-gateway-secret gate as this directory's other /internal/* routes
 * (see weatherMcpFlag.js).
 *
 * Status codes:
 *   200  { enabled: true|false }  — success
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


router.get('/feature-flags/brave-mcp-showcase', (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_brave_mcp_showcase');
  const isUnset = raw === null || raw === undefined || raw === '';
  const enabled = isUnset ? true : (raw === true || raw === 'true');

  return res.json({ enabled });
});

module.exports = router;
