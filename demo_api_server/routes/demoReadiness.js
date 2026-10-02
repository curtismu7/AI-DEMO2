'use strict';

const express = require('express');
const { authenticateToken, requireAdmin, requireScopes } = require('../middleware/auth');
const { createDemoReadinessJobStore, DemoReadinessJobError } = require('../services/demoReadinessJobStore');
const { startReadinessRun } = require('../services/demoReadinessRunner');
const configStore = require('../services/configStore');

// This route runs inside the BFF — the one process holding the loaded config
// store — so its runs can audit effective flags, A2A credentials and PAR settings.
const defaultStore = createDemoReadinessJobStore({
  runReadiness: (args) => startReadinessRun({ ...args, configStore }),
});

function sendJobError(res, error) {
  if (error instanceof DemoReadinessJobError) {
    return res.status(error.statusCode).json({ error: error.code, message: error.message });
  }
  return res.status(500).json({ error: 'demo_readiness_job_failed', message: 'The readiness job request could not be completed.' });
}

function verifiedAdminAssertion(user) {
  const subject = typeof user?.sub === 'string' && user.sub.trim()
    ? user.sub.trim()
    : typeof user?.id === 'string' && user.id.trim() ? user.id.trim() : null;
  const scopes = Array.isArray(user?.scopes) ? user.scopes.filter((scope) => scope === 'admin') : [];
  if (!subject || (user.role !== 'admin' && scopes.length === 0)) return null;
  return Object.freeze({
    subject,
    role: user.role === 'admin' ? 'admin' : 'user',
    scopes: Object.freeze(scopes),
    tokenType: typeof user.tokenType === 'string' ? user.tokenType : 'oauth',
  });
}

function unavailableGuard(name) {
  return (_req, res) => res.status(500).json({ error: 'authorization_guard_unavailable', message: `${name} is unavailable.` });
}

function createDemoReadinessRouter({ store = defaultStore, authenticateToken: injectedAuthentication = authenticateToken } = {}) {
  const router = express.Router();
  const authenticationGuard = typeof injectedAuthentication === 'function' ? injectedAuthentication : unavailableGuard('Authentication');
  const adminGuard = typeof requireAdmin === 'function' ? requireAdmin : unavailableGuard('Administrator authorization');
  const configuredAdminScopeGuard = typeof requireScopes === 'function' ? requireScopes(['admin']) : null;
  const adminScopeGuard = typeof configuredAdminScopeGuard === 'function'
    ? configuredAdminScopeGuard
    : unavailableGuard('Administrator scope authorization');
  const guards = [authenticationGuard, adminGuard, adminScopeGuard];

  router.post('/jobs', ...guards, (req, res) => {
    try {
      const assertion = verifiedAdminAssertion(req.user);
      if (!assertion) return res.status(403).json({ error: 'admin_identity_required', message: 'A verified administrator identity is required.' });
      return res.status(202).json(store.start({ subject: assertion.subject }));
    } catch (error) {
      return sendJobError(res, error);
    }
  });

  router.get('/jobs/:jobId', ...guards, (req, res) => {
    try {
      const subject = verifiedAdminAssertion(req.user)?.subject;
      if (!subject) return res.status(403).json({ error: 'admin_identity_required', message: 'A verified administrator identity is required.' });
      return res.status(200).json(store.get({ jobId: req.params.jobId, subject }));
    } catch (error) {
      return sendJobError(res, error);
    }
  });

  router.post('/jobs/:jobId/confirm', ...guards, (req, res) => {
    try {
      const assertion = verifiedAdminAssertion(req.user);
      if (!assertion) return res.status(403).json({ error: 'admin_identity_required', message: 'A verified administrator identity is required.' });
      if (!req.body || Object.keys(req.body).some((key) => key !== 'digest')) {
        return res.status(400).json({ error: 'invalid_confirmation_body', message: 'Confirmation accepts only the repair digest.' });
      }
      return res.status(202).json(store.confirm({
        jobId: req.params.jobId,
        subject: assertion.subject,
        digest: req.body.digest,
        adminAssertion: assertion,
      }));
    } catch (error) {
      return sendJobError(res, error);
    }
  });

  return router;
}

module.exports = createDemoReadinessRouter();
module.exports.createDemoReadinessRouter = createDemoReadinessRouter;
module.exports.verifiedAdminAssertion = verifiedAdminAssertion;
