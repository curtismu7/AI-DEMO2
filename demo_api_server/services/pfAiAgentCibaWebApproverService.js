'use strict';

const crypto = require('crypto');
const configStore = require('./configStore');
const { oauthError } = require('./pfAiAgentOAuthService');

// Demo-only approval channel for PingFederate's CIBA. The PingFederate plugin (ai-agent-ciba-approver)
// registers each request here and polls for the answer; a person decides on the demo page. PingFederate
// still runs the whole CIBA protocol, so this proves PingFederate's flow and not PingOne MFA.
const TTL_MS = 5 * 60 * 1000;
const TRANSACTION_ID = /^[0-9a-f-]{36}$/i;

// ponytail: in-memory and per BFF process; a restart drops pending requests (PingFederate then expires them).
const requests = new Map();

const value = (store, key) => String(store.getEffective(key) || '').trim();

function approverSecret(store) {
  if (process.env.NODE_ENV === 'production') return '';
  if (value(store, 'pf_ai_ciba_web_approver_enabled').toLowerCase() !== 'true') return '';
  return value(store, 'pf_ai_ciba_approver_secret');
}

function isEnabled(store = configStore) {
  return Boolean(approverSecret(store));
}

function sameSecret(a, b) {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

// The plugin authenticates with the shared secret; anything else gets the same 404 as "feature off".
function authorize(headers, store) {
  const secret = approverSecret(store);
  const match = /^Bearer (.+)$/.exec(String(headers?.authorization || ''));
  if (!secret || !match || !sameSecret(match[1], secret)) {
    throw oauthError('PF_AI_CIBA_WEB_APPROVER_NOT_FOUND', 'Not found', 404);
  }
}

function prune(now) {
  for (const [id, entry] of requests) if (entry.expiresAt <= now) requests.delete(id);
}

function register({ headers, body, store = configStore, now = Date.now }) {
  authorize(headers, store);
  const { transactionId, subject, bindingMessage } = body || {};
  if (typeof transactionId !== 'string' || !TRANSACTION_ID.test(transactionId)
    || typeof subject !== 'string' || !subject.trim() || subject.length > 256) {
    throw oauthError('PF_AI_CIBA_WEB_APPROVER_REQUEST_INVALID', 'A transactionId and subject are required', 400);
  }
  prune(now());
  requests.set(transactionId, {
    subject: subject.trim(),
    bindingMessage: typeof bindingMessage === 'string' ? bindingMessage.slice(0, 64) : null,
    status: 'pending',
    createdAt: now(),
    expiresAt: now() + TTL_MS,
  });
  return { ok: true };
}

function lookup({ headers, transactionId, store = configStore, now = Date.now }) {
  authorize(headers, store);
  prune(now());
  const entry = requests.get(transactionId);
  if (!entry) throw oauthError('PF_AI_CIBA_WEB_APPROVER_NOT_FOUND', 'Not found', 404);
  return { status: entry.status };
}

// The page's Approve / Deny: answers the newest pending request for the user the page asked about.
function decide(req, decision, { store = configStore, now = Date.now } = {}) {
  if (!isEnabled(store)) throw oauthError('PF_AI_CIBA_WEB_APPROVER_NOT_FOUND', 'Not found', 404);
  if (decision !== 'approve' && decision !== 'deny') {
    throw oauthError('PF_AI_CIBA_DECISION_INVALID', 'The decision must be approve or deny', 400);
  }
  const pending = req?.session?.pfAiAgent?.cibaPending;
  if (!pending) throw oauthError('PF_AI_CIBA_NOTHING_PENDING', 'No approval request is pending', 409);
  prune(now());
  const hint = String(pending.loginHint).toLowerCase();
  const candidates = [...requests.values()]
    .filter((entry) => entry.status === 'pending' && entry.subject.toLowerCase() === hint)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!candidates.length) throw oauthError('PF_AI_CIBA_NOTHING_PENDING', 'PingFederate has not registered a request yet', 409);
  candidates[0].status = decision === 'approve' ? 'approved' : 'denied';
  return { ok: true };
}

module.exports = { isEnabled, register, lookup, decide, _requests: requests };
