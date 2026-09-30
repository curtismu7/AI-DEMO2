'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const verifyService = require('../services/verifyService');
const transactionStore = require('../services/lmdb/verifyTransactionStore.lmdb');
const oauthEndpointResolver = require('../services/oauthEndpointResolver');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAIL', 'APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'UNKNOWN', 'EXPIRED']);

function featureEnabled() {
  return String(configStore.getEffective('pingone_verify_enabled') || '').toLowerCase() === 'true';
}

function identityFor(req) {
  const user = req.user || {};
  const userId = String(user.sub || user.id || '').trim();
  const expectedIssuer = String(oauthEndpointResolver.getPingOneIssuer() || '').trim().replace(/\/$/, '');
  const actualIssuer = String(user.issuer || '').trim().replace(/\/$/, '');
  if (
    user.openAccessDemoBinding ||
    user.isDelegated ||
    user.role === 'admin' ||
    user.userType !== 'customer' ||
    user.clientType !== 'enduser' ||
    !expectedIssuer ||
    actualIssuer !== expectedIssuer ||
    !UUID_RE.test(userId)
  ) return null;
  return { appUserId: userId, pingOneUserId: userId };
}

function returnUrl() {
  try {
    const origin = new URL(String(getFrontendOrigin() || ''));
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.hostname === 'demo-api-server') return null;
    return `${origin.origin}/profile?verify=return`;
  } catch {
    return null;
  }
}

function requireCsrf(req, res, next) {
  if (!req.headers['x-pingone-verify-csrf']) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

function unavailableResponse(res, code = 'verify_not_configured') {
  return res.status(503).json({ error: code });
}

function publicRecord(record, canEnrollRecognize = false) {
  return {
    id: record.id,
    status: record.status,
    expiresAt: record.expiresAt,
    verifiedAt: record.verifiedAt || null,
    canEnrollRecognize,
  };
}

router.get('/availability', authenticateToken, (req, res) => {
  const identity = identityFor(req);
  const enabled = featureEnabled();
  const configured = enabled && verifyService.isConfigured() && Boolean(returnUrl());
  return res.json({ enabled, available: Boolean(configured && identity), eligible: Boolean(identity) });
});

router.post('/transactions', authenticateToken, requireCsrf, async (req, res) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'verify_not_found' });
  const identity = identityFor(req);
  if (!identity) return res.status(403).json({ error: 'verify_identity_unavailable' });
  if (!verifyService.isConfigured()) return unavailableResponse(res);
  const redirectUrl = returnUrl();
  if (!redirectUrl) return unavailableResponse(res, 'verify_redirect_not_configured');

  try {
    transactionStore.pruneExpired();
    const created = await verifyService.createTransaction({
      pingOneUserId: identity.pingOneUserId,
      redirectUrl,
    });
    const record = transactionStore.save({
      id: created.id,
      appUserId: identity.appUserId,
      pingOneUserId: identity.pingOneUserId,
      status: created.status,
      expiresAt: created.expiresAt,
      verifiedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return res.status(201).json({
      id: record.id,
      webVerificationUrl: created.webVerificationUrl,
      expiresAt: record.expiresAt,
      status: record.status,
    });
  } catch (err) {
    if (err?.code === 'VERIFY_NOT_CONFIGURED') return unavailableResponse(res);
    console.warn('[PingOne Verify] transaction creation failed');
    return res.status(502).json({ error: 'verify_transaction_create_failed' });
  }
});

router.get('/transactions/:transactionId', authenticateToken, async (req, res) => {
  if (!featureEnabled()) return res.status(404).json({ error: 'verify_not_found' });
  const identity = identityFor(req);
  if (!identity) return res.status(403).json({ error: 'verify_identity_unavailable' });
  const transactionId = String(req.params.transactionId || '');
  if (!/^[a-z0-9-]{1,128}$/i.test(transactionId)) return res.status(404).json({ error: 'verify_transaction_not_found' });

  const record = transactionStore.get(transactionId);
  if (!record || record.appUserId !== identity.appUserId || record.pingOneUserId !== identity.pingOneUserId) {
    return res.status(404).json({ error: 'verify_transaction_not_found' });
  }
  if (record.status === 'SUCCESS' && record.verifiedAt) return res.json(publicRecord(record, false));
  if (TERMINAL_STATUSES.has(record.status) && record.status !== 'SUCCESS') return res.json(publicRecord(record, false));
  const expiry = Date.parse(record.expiresAt || '');
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    const expired = transactionStore.save({ ...record, status: 'EXPIRED', verifiedAt: null, updatedAt: new Date().toISOString() });
    return res.json(publicRecord(expired, false));
  }

  try {
    const current = await verifyService.readTransaction({
      pingOneUserId: identity.pingOneUserId,
      transactionId,
    });
    const verifiedAt = current.status === 'SUCCESS' ? (record.verifiedAt || new Date().toISOString()) : null;
    const updated = transactionStore.save({
      ...record,
      status: current.status,
      expiresAt: current.expiresAt,
      verifiedAt,
      updatedAt: new Date().toISOString(),
    });
    // Enrollment remains disabled until the tenant's documented Recognize
    // result-validation contract and app integration are configured.
    return res.json(publicRecord(updated, false));
  } catch (err) {
    if (err?.code === 'VERIFY_NOT_CONFIGURED') return unavailableResponse(res);
    console.warn('[PingOne Verify] transaction status read failed');
    return res.status(502).json({ error: 'verify_transaction_status_failed' });
  }
});

module.exports = router;
