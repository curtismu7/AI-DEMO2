'use strict';

const express = require('express');
const router  = express.Router();

/** Basic email format validation (defence-in-depth before PingOne API call). */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
function isValidEmail(v) { return typeof v === 'string' && v.length <= 320 && EMAIL_RE.test(v); }

const {
  grantDelegation,
  revokeDelegation,
  listDelegations,
  getDelegationHistory,
  getDelegationsGrantedToMe,
  listAllDelegations,
  adminRevokeDelegation,
  adminGrantDelegation,
} = require('../services/delegationService');
const { requireAdmin } = require('../middleware/auth');
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const { revokeToken } = require('../services/tokenRevocation');
const configStore = require('../services/configStore');

// GET /api/delegation/history — full history for authenticated user (must come before '/:id' patterns)
router.get('/history', async (req, res) => {
  try {
    const history = await getDelegationHistory(req.user.id);
    res.json({ history });
  } catch (err) {
    console.error('[delegation] GET /history error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// GET /api/delegation/granted-to-me — delegations where I am the delegate
router.get('/granted-to-me', async (req, res) => {
  try {
    const email = req.user.email || req.user.username || '';
    const delegations = await getDelegationsGrantedToMe(email);
    res.json({ ok: true, delegations });
  } catch (err) {
    console.error('[delegation] GET /granted-to-me error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// GET /api/delegation — list active delegations for authenticated user
router.get('/', async (req, res) => {
  try {
    const delegations = await listDelegations(req.user.id);
    res.json({ delegations });
  } catch (err) {
    console.error('[delegation] GET / error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// POST /api/delegation — grant a new delegation
router.post('/', async (req, res) => {
  const { delegateEmail, scopes } = req.body || {};
  const delegatorEmail = req.user.email || req.user.username || '';
  const result = await grantDelegation({
    delegatorUserId: req.user.id,
    delegatorEmail,
    delegateEmail,
    scopes: Array.isArray(scopes) ? scopes : [],
  });
  if (!result.ok) {
    const statusMap = {
      validation_error:    400,
      self_delegation:     400,
      duplicate_delegation: 409,
      provisioning_failed: 502,
    };
    return res.status(statusMap[result.error] || 400).json(result);
  }
  res.status(201).json(result);
});

// DELETE /api/delegation/:id — revoke a delegation
router.delete('/:id', async (req, res) => {
  const result = await revokeDelegation(req.params.id, req.user.id);
  if (!result.ok) {
    return res.status(404).json(result);
  }
  res.json(result);
});

// ---------------------------------------------------------------------------
// Admin routes (requireAdmin — must have admin role or admin scope)
// ---------------------------------------------------------------------------

// GET /api/delegation/admin/all — list all delegations across all users
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const delegations = await listAllDelegations({ status });
    res.json({ delegations });
  } catch (err) {
    console.error('[delegation] GET /admin/all error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// POST /api/delegation/admin/grant — grant delegation on behalf of a delegator by email
router.post('/admin/grant', requireAdmin, async (req, res) => {
  try {
    const { delegatorEmail, delegateEmail, scopes } = req.body || {};
    // Validate email format before calling PingOne APIs
    if (!isValidEmail(delegatorEmail) || !isValidEmail(delegateEmail)) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'delegatorEmail and delegateEmail must be valid email addresses (max 320 chars).',
      });
    }
    const result = await adminGrantDelegation({
      delegatorEmail,
      delegateEmail,
      scopes: Array.isArray(scopes) ? scopes : [],
    });
    if (!result.ok) {
      const statusMap = {
        validation_error:     400,
        self_delegation:      400,
        duplicate_delegation: 409,
        provisioning_failed:  502,
      };
      return res.status(statusMap[result.error] || 400).json(result);
    }
    res.status(201).json(result);
  } catch (err) {
    console.error('[delegation] POST /admin/grant error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// DELETE /api/delegation/admin/:id — revoke any delegation (admin, no ownership check)
router.delete('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const result = await adminRevokeDelegation(req.params.id);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[delegation] DELETE /admin/:id error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// DELETE /api/delegation/admin/:id/hard — revoke + kill live token (admin)
router.delete('/admin/:id/hard', requireAdmin, async (req, res) => {
  try {
    const record = delegationStore.getDelegationById(req.params.id);
    const result = await adminRevokeDelegation(req.params.id);
    if (!result.ok) return res.status(404).json(result);

    const userId = record?.delegator_user_id || null;
    const storedToken = record?.access_token;
    const clientId = configStore.getEffective('pingone_client_id') || process.env.PINGONE_CLIENT_ID;
    const clientSecret = configStore.getEffective('pingone_client_secret') || process.env.PINGONE_CLIENT_SECRET;

    if (storedToken && clientId && clientSecret) {
      try {
        await revokeToken(storedToken, 'access_token', clientId, clientSecret);
        return res.json({ ok: true, revoked: 'hard', userId });
      } catch (err) {
        console.error('[delegation] admin hard revoke token failed (non-fatal):', err.message);
      }
    }
    res.json({ ok: true, revoked: 'soft', note: 'token_unavailable', userId });
  } catch (err) {
    console.error('[delegation] DELETE /admin/:id/hard error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
