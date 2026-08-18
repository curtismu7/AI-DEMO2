'use strict';

/**
 * RFC 8693 Token Exchange demo routes — self-contained mock, no PingOne
 * dependency.
 *
 * The real /api/oauth/token/token + /api/oauth/token/introspect routes
 * (routes/oauthToken.js) are wired to clientCredentialsTokenService and
 * require application/x-www-form-urlencoded bodies plus real client
 * credentials — the protocol playground's execution engine always sends
 * JSON, so every request there 400'd on content-type before reaching any
 * business logic. This mirrors the same mechanics — exchange a subject
 * token for an access token; introspect that access token — as plain
 * POST/JSON, matching PKCE's demo pattern.
 */
const express = require('express');
const router = express.Router();
const { mintDemoJwt, decodeDemoJwt } = require('../utils/demoJwt');

/**
 * Exchange delegated token via RFC 8693 token exchange. Client sends a
 * subject token (typically an ID token) and requests an access token.
 *
 * @flow rfc8693-token-exchange
 * @name RFC 8693 Token Exchange
 * @rfc https://datatracker.ietf.org/doc/html/rfc8693 RFC 8693
 * @why Token Exchange (RFC 8693) trades one token for another at the authorization server: narrower audience, narrower scope, and an act claim recording who is acting on whose behalf. No service ever forwards the user's original token — each hop gets a token minted for exactly that hop.
 * @example A valet key: starts the car, will not open the trunk. In a microservice chain, the gateway exchanges the user's token for a service-scoped token per downstream call, so a compromised downstream service holds a token good for almost nothing.
 * @ai This is the backbone of this demo. Every agent hop — BFF to agent, agent to MCP — is a fresh exchange, so the token that reaches a tool server is scoped to that one call, and the nested act chain is a cryptographic audit trail of every delegation.
 * @actor client-app
 * @to token-exchanger
 * @step 1
 * @body {"grant_type":"urn:ietf:params:oauth:grant-type:token-exchange","subject_token":"demo-subject-id-token","subject_token_type":"urn:ietf:params:oauth:token-type:id_token","requested_token_type":"urn:ietf:params:oauth:token-type:access_token","audience":"demo-resource-server"}
 */
router.post('/token', express.json(), (req, res) => {
  const { grant_type, subject_token, audience } = req.body || {};
  if (grant_type !== 'urn:ietf:params:oauth:grant-type:token-exchange') {
    return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'grant_type must be urn:ietf:params:oauth:grant-type:token-exchange' });
  }
  if (!subject_token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'subject_token is required' });
  }
  const access_token = mintDemoJwt({
    iss: 'demo-rfc8693-exchanger',
    sub: 'demo-user',
    aud: audience || 'demo-resource-server',
    act: { sub: 'demo-agent' },
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  res.json({
    access_token,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'Bearer',
    expires_in: 3600,
  });
});

/**
 * Validate and introspect the delegated token via RFC 8693. Token exchanger
 * verifies the subject token and returns token details.
 *
 * @flow rfc8693-token-exchange
 * @actor token-exchanger
 * @to client-app
 * @step 2
 * @body {"token":":access_token"}
 */
router.post('/introspect', express.json(), (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
  }
  const claims = decodeDemoJwt(token);
  if (!claims) {
    return res.json({ active: false });
  }
  res.json({ active: true, ...claims });
});

module.exports = router;
