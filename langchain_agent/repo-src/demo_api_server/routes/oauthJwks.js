/**
 * oauthJwks — read-only JWKS endpoint that publishes the BFF's PUBLIC client-auth
 * key (the one used for private_key_jwt / RFC 7523 client authentication).
 *
 * This is for teaching/visualization only. PingOne validates our signed client
 * assertions against the public JWK registered DIRECTLY on the application (the
 * `jwks` value), not by fetching this endpoint — so it intentionally needs no
 * inbound reachability from PingOne. It lets the demo SHOW the published key.
 *
 * Returns an empty key set when no private key is configured (flag-off / unprovisioned).
 */
const express = require('express');
const router = express.Router();
const clientAssertionService = require('../services/clientAssertionService');

router.get('/', (req, res) => {
  const jwk = clientAssertionService.getPublicJwk();
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ keys: jwk ? [jwk] : [] });
});

module.exports = router;
