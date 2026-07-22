'use strict';

/**
 * PingOne Bearer gate for A2A JSON-RPC (Magic 8 Ball security pattern, P1 IdP).
 * Does not use the session cookie — separate from nested-act MCP tokens.
 */

const { decodeJwt } = require('../utils/tokenUtils');

/**
 * Express middleware: require Authorization: Bearer <PingOne JWT>.
 * Attaches req.a2aPingOne = { token, claims, clientId }.
 */
function requireA2aPingOneBearer(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'A2A protocol requires Authorization: Bearer <PingOne access token>',
    });
  }

  const token = match[1].trim();
  const decoded = decodeJwt(token);
  const claims = decoded?.claims || null;
  if (!claims || typeof claims !== 'object') {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'A2A bearer is not a decodable JWT',
    });
  }

  const clientId = claims.client_id || claims.cid || claims.sub || null;
  if (!clientId) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'A2A bearer JWT missing client_id/sub',
    });
  }

  req.a2aPingOne = { token, claims, clientId: String(clientId) };
  return next();
}

/**
 * @a2a-js UserBuilder: map validated PingOne JWT to an authenticated User.
 * Call only after requireA2aPingOneBearer.
 */
function pingOneA2aUserBuilder(req) {
  const info = req.a2aPingOne;
  if (!info?.clientId) {
    return Promise.resolve({
      get isAuthenticated() {
        return false;
      },
      get userName() {
        return 'anonymous';
      },
    });
  }
  const name = info.clientId;
  return Promise.resolve({
    get isAuthenticated() {
      return true;
    },
    get userName() {
      return name;
    },
  });
}

module.exports = {
  requireA2aPingOneBearer,
  pingOneA2aUserBuilder,
};
