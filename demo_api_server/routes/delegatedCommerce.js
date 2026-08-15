'use strict';

const express = require('express');
const router = express.Router();
const { requireAdmin, requireScopes, requireNotAdmin } = require('../middleware/auth');
const delegatedCommerceService = require('../services/delegatedCommerceService');
const delegatedCommerceStore = require('../services/lmdb/delegatedCommerceStore.lmdb');
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const delegationService = require('../services/delegationService');
const pingOneUserService = require('../services/pingOneUserService');
const mcpAuditStore = require('../services/lmdb/mcpAuditStore.lmdb');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const ALLOWED_SCOPES = new Set(['read', 'write']);

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

function currentUserId(req) {
  return req.user?.id || req.session?.user?.id || req.session?.user?.oauthId;
}

function currentRegistration(req) {
  const id = req.session?.delegatedCommerceRegistrationId;
  return id ? delegatedCommerceStore.get(id) : null;
}

function registrationIsActive(registration) {
  return registration?.status === 'active' && registration.expiresAt > Date.now();
}

async function revokeActiveDelegations(agentId, userId, exceptId = null) {
  const records = delegationStore.getDelegations(userId).filter((record) =>
    record.delegate_email === agentId &&
    record.status === 'active' &&
    record.id !== exceptId,
  );
  for (const record of records) {
    await delegationService.revokeDelegation(record.id, userId);
  }
}

router.post('/register', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const result = await delegatedCommerceService.register({
      name: req.body?.name,
      creatorUserId: currentUserId(req),
    });
    res.status(201).json(result);
  } catch (err) {
    const normalized = normalizeAxiosError(err, { label: 'Delegated agent registration' });
    res.status(err.httpStatus || normalized.httpStatus || 502).json({
      error: err.code || 'registration_failed',
      message: normalized.message,
    });
  }
});

router.post('/claim', requireNotAdmin, async (req, res) => {
  if (!req.body?.claimCode || typeof req.body.claimCode !== 'string') {
    return res.status(400).json({ error: 'claim_code_required' });
  }
  try {
    const registration = delegatedCommerceService.claim({
      claimCode: req.body.claimCode,
      userId: currentUserId(req),
    });
    req.session.delegatedCommerceRegistrationId = registration.id;
    await saveSession(req);
    res.json({ registration });
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.code || 'claim_failed', message: err.message });
  }
});

router.post('/consent', requireNotAdmin, async (req, res) => {
  const scopes = Array.isArray(req.body?.scopes) ? [...new Set(req.body.scopes)] : [];
  if (scopes.length === 0 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    return res.status(400).json({
      error: 'invalid_consent_scopes',
      message: 'Select one or more supported scopes: read, write.',
    });
  }
  const registration = currentRegistration(req);
  const userId = currentUserId(req);
  if (!registration || registration.claimedByUserId !== userId) {
    return res.status(409).json({ error: 'agent_claim_required' });
  }
  if (registration.expiresAt <= Date.now()) {
    return res.status(410).json({ error: 'agent_registration_expired' });
  }

  let granted = null;
  try {
    pingOneUserService.initialize();
    await pingOneUserService.setMayActAttribute(userId, { sub: registration.applicationId });
    granted = delegationStore.grantDelegation({
      delegator_user_id: userId,
      delegator_email: req.user?.email || req.session?.user?.email || '',
      delegate_email: registration.applicationId,
      scopes,
      access_token: req.session?.oauthTokens?.accessToken || null,
    });
    const updated = delegatedCommerceService.updateConsent(registration.id, scopes);
    req.session.agentTokens = {};
    await saveSession(req);
    await revokeActiveDelegations(registration.applicationId, userId, granted.id);
    res.json({
      ok: true,
      reauthRequired: true,
      delegationId: granted.id,
      registration: updated,
    });
  } catch (err) {
    try {
      pingOneUserService.initialize();
      await pingOneUserService.setMayActAttribute(userId, null);
      if (typeof granted?.id === 'string') {
        await delegationService.revokeDelegation(granted.id, userId);
      }
      delegatedCommerceStore.put(registration);
    } catch (rollbackErr) {
      console.error('[delegated-commerce] consent rollback failed:', rollbackErr.message);
    }
    res.status(502).json({
      error: 'consent_write_failed',
      message: 'Could not activate the scoped agent consent.',
    });
  }
});

router.get('/status', (req, res) => {
  const registration = currentRegistration(req);
  if (!registration || registration.claimedByUserId !== currentUserId(req)) {
    return res.json({ registration: null, authorized: false, scopes: [] });
  }
  const delegation = delegationStore.findActiveByActorAndGrantor(
    registration.applicationId,
    currentUserId(req),
  );
  res.json({
    registration: delegatedCommerceService.safeRegistration(registration),
    authorized: !!delegation && registrationIsActive(registration),
    delegationId: delegation?.id || null,
    scopes: delegation?.scopes || [],
  });
});

router.post('/revoke', requireNotAdmin, async (req, res) => {
  const registration = currentRegistration(req);
  const userId = currentUserId(req);
  if (!registration || registration.claimedByUserId !== userId) {
    return res.status(404).json({ error: 'active_agent_not_found' });
  }
  try {
    pingOneUserService.initialize();
    await pingOneUserService.setMayActAttribute(userId, null);
    await revokeActiveDelegations(registration.applicationId, userId);
    const revoked = delegatedCommerceService.revoke(registration.id);
    req.session.agentTokens = {};
    const auditId = `delegated-revoke-${Date.now()}`;
    mcpAuditStore.append({
      eventId: auditId,
      timestamp: new Date().toISOString(),
      eventType: 'delegated_agent_revoked',
      userId,
      agentId: registration.applicationId,
      scopes: registration.scopes || [],
      reason: req.body?.reason || 'Customer self-service revocation',
      outcome: 'revoked',
    });
    await saveSession(req);
    res.json({ ok: true, registration: revoked, auditId });
  } catch (err) {
    res.status(502).json({ error: 'revoke_failed', message: 'Could not revoke the delegated agent.' });
  }
});

router.delete('/registration/:registrationId', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    await delegatedCommerceService.cleanup(req.params.registrationId, currentUserId(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.httpStatus || 502).json({ error: err.code || 'cleanup_failed', message: err.message });
  }
});

module.exports = router;
