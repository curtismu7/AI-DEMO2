'use strict';

/**
 * Transaction Tokens (draft-ietf-oauth-transaction-tokens) demo routes —
 * self-contained mock. PingOne has no native Txn-Token Service (TTS); this
 * simulates one so the shape of the protocol — a short-lived, context-bound
 * token minted at the edge and re-validated at each downstream hop instead
 * of re-authenticating — is executable here.
 */
const express = require('express');
const router = express.Router();
const { mintDemoJwt, decodeDemoJwt } = require('../utils/demoJwt');

/**
 * Edge service requests a txn-token from the Transaction Token Service,
 * carrying the caller's subject token and the request context to bind.
 *
 * @flow txn-tokens
 * @name TXN Tokens
 * @rfc https://datatracker.ietf.org/doc/html/draft-ietf-oauth-transaction-tokens-12 Transaction Tokens
 * @why Transaction Tokens pin the context of one request: the edge service swaps the caller's token for a short-lived txn-token recording who called, what they asked for, and which workload chain handled it. Every internal hop can verify the original request context instead of trusting whoever called it last.
 * @example A numbered work order stapled to a job as it moves through a shop floor: any station can check what was actually ordered, rather than trusting the previous station's word for it. A compromised internal service cannot invent a "transfer $10,000" job from a "check balance" request.
 * @ai Agent requests fan out across many internal services. A txn-token makes the original human request travel with the work, so deep services enforce against what the user actually asked — not what an intermediate agent claims they asked.
 * @actor edge-service
 * @to txn-token-service
 * @step 1
 * @body {"subject_token":"demo-subject-access-token","request_ctx":{"method":"POST","path":"/transfer"},"purp":"issue"}
 */
router.post('/request', express.json(), (req, res) => {
  const { subject_token, request_ctx, purp } = req.body || {};
  if (!subject_token || !request_ctx) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'subject_token and request_ctx are required' });
  }
  const txn_token = mintDemoJwt({
    iss: 'demo-tts',
    aud: 'internal-services',
    sub: 'demo-user',
    txn: `txn-${Date.now()}`,
    purp: purp || 'issue',
    rctx: request_ctx,
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  res.json({ txn_token, token_type: 'N_A', expires_in: 60 });
});

/**
 * A downstream microservice receives the txn-token on the next hop,
 * validates it, and re-mints a fresh one to propagate further inward.
 *
 * @flow txn-tokens
 * @actor downstream-service
 * @to txn-token-service
 * @step 2
 * @body {"txn_token":"demo.placeholder.token","hop":"inventory-service"}
 */
router.post('/propagate', express.json(), (req, res) => {
  const { txn_token, hop } = req.body || {};
  if (!txn_token || !hop) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'txn_token and hop are required' });
  }
  const receivedClaims = decodeDemoJwt(txn_token);
  const propagated_txn_token = mintDemoJwt({
    iss: 'demo-tts',
    aud: 'internal-services',
    sub: receivedClaims?.sub || 'unknown-demo-subject',
    txn: receivedClaims?.txn || `txn-${Date.now()}`,
    purp: 'propagate',
    hop,
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  res.json({ valid: !!receivedClaims, propagated_txn_token, hop });
});

module.exports = router;
