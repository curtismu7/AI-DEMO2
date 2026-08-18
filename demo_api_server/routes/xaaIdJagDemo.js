'use strict';

/**
 * XAA / ID-JAG (draft-ietf-oauth-identity-chaining) demo routes —
 * self-contained mock. PingOne does not yet issue Identity Assertion JWT
 * Authorization Grants; this simulates the two-hop cross-domain exchange —
 * home IdP vouches for the user's identity to a foreign domain's AS, which
 * then trades that assertion for an access token scoped to its own resource.
 */
const express = require('express');
const router = express.Router();
const { mintDemoJwt, decodeDemoJwt } = require('../utils/demoJwt');

/**
 * Client exchanges its home-domain ID token for an ID-JAG assertion scoped
 * to the target (foreign) domain's authorization server.
 *
 * @flow xaa
 * @name XAA / ID-JAG
 * @rfc https://datatracker.ietf.org/doc/html/draft-looker-app-driven-authorization-16 App-Driven AuthZ
 * @why XAA / ID-JAG covers cross-domain delegation: a client with an identity in its home domain exchanges its ID token for an ID-JAG assertion the target domain's authorization server accepts — cross-company access rooted in one home identity, with no shared user store and no second login.
 * @example Airline status getting you into a partner lounge: the partner does not have you in its member database — it accepts an assertion from your airline and issues its own lounge pass. Here, the foreign domain's AS mints its own access token from the ID-JAG.
 * @ai An agent working across two companies' APIs — booking travel, filing an insurance claim — gets a per-domain token in each, every one traceable to the same home identity that delegated the task.
 * @actor client-app
 * @to idp-a
 * @step 1
 * @body {"subject_token":"demo-id-token","subject_token_type":"urn:ietf:params:oauth:token-type:id_token","requested_token_type":"urn:ietf:params:oauth:token-type:id-jag","audience":"domain-b-as"}
 */
router.post('/id-jag', express.json(), (req, res) => {
  const { subject_token, requested_token_type, audience } = req.body || {};
  if (!subject_token || requested_token_type !== 'urn:ietf:params:oauth:token-type:id-jag' || !audience) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'subject_token, requested_token_type=...id-jag, and audience are required',
    });
  }
  const id_jag = mintDemoJwt({
    iss: 'demo-idp-a',
    aud: audience,
    sub: 'demo-user',
    act: { iss: 'demo-idp-a' },
    exp: Math.floor(Date.now() / 1000) + 120,
  });
  res.json({ issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag', access_token: id_jag, token_type: 'N_A' });
});

/**
 * Foreign domain's AS trades the ID-JAG assertion for an access token scoped
 * to its own resource server (JWT-bearer grant, RFC 7523 shape).
 *
 * @flow xaa
 * @actor domain-b-as
 * @to client-app
 * @step 2
 * @body {"grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer","assertion":"demo.placeholder.idjag","scope":"read"}
 */
router.post('/token', express.json(), (req, res) => {
  const { grant_type, assertion, scope } = req.body || {};
  if (grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !assertion) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'grant_type=...jwt-bearer and assertion are required' });
  }
  const assertionClaims = decodeDemoJwt(assertion);
  const access_token = mintDemoJwt({
    iss: 'demo-idp-b-as',
    aud: 'domain-b-resource-server',
    sub: assertionClaims?.sub || 'unknown-demo-subject',
    scope: scope || 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  res.json({ access_token, token_type: 'Bearer', expires_in: 3600, scope: scope || 'read' });
});

module.exports = router;
