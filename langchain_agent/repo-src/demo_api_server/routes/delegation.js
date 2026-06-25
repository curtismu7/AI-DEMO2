'use strict';

const express = require('express');
const router  = express.Router();
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

module.exports = router;
