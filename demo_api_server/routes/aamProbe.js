'use strict';

/**
 * GET /api/aam/probe
 *
 * Calls the gateway's AAM-protected path and returns the PingOne Authorize
 * decision, with the verbatim Sideband request and response JSON.
 *
 * WHY THIS EXISTS: /aam is called directly by clients, so nothing in the BFF
 * normally receives the gateway's X-Gw-Audit-Trail header. The Groovy filters
 * can stamp a perfect trail and the token chain would still be empty, because
 * no BFF code is in the path to read it. This route puts the BFF in the path.
 *
 * A DENY is a successful probe, not an error. The gateway stamps the trail on
 * both outcomes, so the 403 carries exactly the decision a demo wants to show;
 * reporting it as a failure would throw that away. `ok` describes whether the
 * probe ran, `decision` describes what AAM said.
 *
 * Mounted behind authenticateToken by server.js, like the other admin gateway
 * routes.
 */

const express = require('express');
const axios = require('axios');
const configStore = require('../services/configStore');
const { _parseGwAuditTrail } = require('../services/mcpGatewayClient');

const router = express.Router();

// The API service registered in PingOne matches on this base URL, so the Host
// header must present it even when the gateway is reached on another address.
const AAM_HOST = 'api.ping.demo:3036';

router.get('/probe', async (req, res) => {
  if (configStore.getEffective('ff_aam') !== 'true') {
    return res.status(200).json({ ok: false, disabled: true, reason: 'ff_aam is off' });
  }

  const base = process.env.MCP_PINGGATEWAY_URL || 'http://ping-gateway:8080';
  const simulated = configStore.getEffective('ff_authorize_simulated') === 'true';

  try {
    const gwRes = await axios.get(`${base}/aam/health`, {
      timeout: 20000,
      // Never throw on status: the 403 deny is the case worth reporting, and an
      // axios throw would lose the audit-trail header attached to it.
      validateStatus: () => true,
      headers: {
        Host: AAM_HOST,
        // The gateway trusts X-Authz-Simulated only alongside the internal
        // secret, so a gateway-audience token cannot force the mock backend.
        'X-Authz-Simulated': String(simulated),
        'X-BFF-Internal': process.env.BFF_INTERNAL_SECRET || '',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
    });

    const trail = _parseGwAuditTrail(gwRes);
    const aam = (trail && trail.aam) || null;

    return res.status(200).json({
      ok: true,
      httpStatus: gwRes.status,
      decision: aam ? aam.decision : null,
      backend: aam ? aam.backend : null,
      serviceUri: aam ? aam.serviceUri : null,
      elapsedMs: aam ? aam.elapsedMs : null,
      request: aam ? aam.request : null,
      response: aam ? aam.response : null,
    });
  } catch (err) {
    // Gateway down or unreachable — report it rather than 500, so the UI can
    // render the reason in place instead of showing a blank failure.
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
