'use strict';
const { validateToken } = require('./tokenValidationService');
const { getOboConfig } = require('./oboConfig');

// Accepts only a delegation token: right audience AND an `act` object naming a client.
async function verifyDownstream(token) {
  const cfg = getOboConfig();
  try {
    const c = await validateToken(token, { jwksUri: cfg.jwksUri, issuer: cfg.issuer, audience: cfg.audience });
    if (!c.act || typeof c.act !== 'object' || !c.act.client_id) {
      return { status: 401, error: 'no act object (not a delegation token)' };
    }
    return { status: 200, acting_for: c.sub, acted_by: c.act };
  } catch (e) {
    return { status: 401, error: e.message };
  }
}

module.exports = { verifyDownstream };
