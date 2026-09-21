'use strict';

const {
  loadHostedAccessPolicy,
  hasCurrentHostedAccessApproval,
} = require('../services/hostedAccessPolicy');

const EXACT_BYPASSES = new Set([
  'GET /api/auth/hosted-access/login',
  'GET /api/auth/hosted-access/callback',
  'GET /api/auth/hosted-access/logout',
  'POST /api/auth/hosted-registration/request',
  'POST /api/auth/hosted-registration/verify',
  'POST /api/auth/hosted-registration/resend',
  'GET /api/auth/hosted-registration/status',
  'GET /api/healthz',
]);

function pathname(value) {
  return String(value || '').split('?')[0];
}

function isHostedAccessBypassPath(path, method) {
  return EXACT_BYPASSES.has(`${String(method || 'GET').toUpperCase()} ${pathname(path)}`);
}

function sendAccessRestricted(res) {
  res.status(403);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type('html');
  return res.send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access restricted</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#071426;color:#fff;font:600 18px/1.5 system-ui,sans-serif}main{max-width:36rem;padding:2rem;border:1px solid #fff;border-radius:.75rem}</style></head><body><main>Access restricted to authorized Ping employees.</main></body></html>');
}

function createHostedAccessGate({
  policy = loadHostedAccessPolicy(),
  hasApproval = hasCurrentHostedAccessApproval,
} = {}) {
  return function hostedAccessGate(req, res, next) {
    if (!policy.enabled || isHostedAccessBypassPath(req.originalUrl || req.url, req.method)) return next();
    if (hasApproval(req.hostedSession, policy)) return next();
    return res.status(401).send({ error: 'hosted_access_required' });
  };
}

function hostedAccessCheck({
  policy = loadHostedAccessPolicy(),
  hasApproval = hasCurrentHostedAccessApproval,
} = {}) {
  return function check(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!policy.enabled || hasApproval(req.hostedSession, policy)) return res.status(204).end();
    return res.status(401).end();
  };
}

module.exports = {
  createHostedAccessGate,
  hostedAccessCheck,
  isHostedAccessBypassPath,
  sendAccessRestricted,
};
