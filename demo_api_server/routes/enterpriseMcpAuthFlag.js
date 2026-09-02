'use strict';
/**
 * /internal/feature-flags/enterprise-managed-mcp-auth — gateway-only endpoint
 *
 * Lets mcp-gateway read the live value of ff_enterprise_managed_mcp_auth at
 * startup, so the UI toggle is the single answer for ID-JAG rather than one
 * answer per process.
 *
 * Why this exists: the gateway advertises enterprise-managed authorization on
 * its RFC 9728 metadata document and its 401 WWW-Authenticate challenge —
 * surfaces an external MCP client reaches directly, with no BFF request in the
 * path to carry the flag. The gateway therefore read its own
 * FF_ENTERPRISE_MANAGED_MCP_AUTH env var and could disagree with the BFF
 * indefinitely; on the SE cluster it did (BFF true, gateway unset) with nothing
 * surfacing the split.
 *
 * The BFF pushes changes to the gateway's POST /admin/config when the toggle is
 * saved. That push covers the live case but is lost whenever the gateway
 * restarts on its own, since its dynamic config is in-memory — hence this
 * pull-on-boot half. Same x-internal-gateway-secret gate as the other
 * /internal/* routes.
 *
 * Status codes:
 *   200  { enabled }
 *   403  forbidden — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
// Resolved per call — routes are required long before the vault opens, so a
// module-scope snapshot could never see a vault-supplied BFF_INTERNAL_SECRET.
const { internalSecretMatches } = require('../utils/internalSecret');
const router = express.Router();
const configStore = require('../services/configStore');

router.get('/feature-flags/enterprise-managed-mcp-auth', (req, res) => {
  if (!internalSecretMatches(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Unset means "not enabled" here, matching the flag registry's
  // defaultValue: false — unlike ff_weather_mcp_showcase next door, which
  // defaults ON when unset. Do not copy that shape without checking the
  // registry.
  const raw = configStore.getEffective('ff_enterprise_managed_mcp_auth');
  const enabled = raw === true || raw === 'true';

  return res.json({ enabled });
});

module.exports = router;
