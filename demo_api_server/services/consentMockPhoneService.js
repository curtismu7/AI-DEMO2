'use strict';

const crypto = require('crypto');
const { step: traceStep } = require('./pfAiAgentTrace');

// /transaction-consent mock phone: a session-scoped stand-in for the user's CIBA device. Unlike the
// PingFederate mock (pfAiAgentCibaService) it has no environment gate and serves any signed-in user,
// because it moves no money and issues no token: it only proves the page's push -> tap -> result flow.
const MAX_PENDING_MS = 5 * 60 * 1000;
const TYPES = ['transfer', 'withdrawal'];

const fail = (code, message, httpStatus) => Object.assign(new Error(message), { code, httpStatus });

function view(pending, state, extra = {}) {
  return {
    state,
    requestId: pending.id,
    loginHint: pending.loginHint,
    amount: pending.amount,
    type: pending.type,
    description: pending.description,
    expiresAt: new Date(pending.expiresAt).toISOString(),
    trace: [...pending.trace, ...(extra.trace || [])],
  };
}

function start(req, { amount, type, description } = {}, { now = Date.now } = {}) {
  const loginHint = String(req.session?.user?.username || '').trim();
  if (!loginHint) throw fail('CONSENT_MOCK_USER_REQUIRED', 'Sign in first', 401);
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > 1e7) throw fail('CONSENT_MOCK_BAD_INPUT', 'amount must be a positive number', 400);
  if (!TYPES.includes(type)) throw fail('CONSENT_MOCK_BAD_INPUT', `type must be one of ${TYPES.join(', ')}`, 400);
  const createdAt = now();
  const pending = {
    id: crypto.randomUUID(),
    expiresAt: createdAt + MAX_PENDING_MS,
    loginHint,
    amount: value,
    type,
    description: String(description || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80),
    trace: [
      traceStep({
        id: 'start',
        title: 'Backchannel authentication request (mock)',
        request: { method: 'POST', url: '/bc-authorize', params: { login_hint: loginHint, scope: 'openid', binding_message: `${type}.${value}`, auth_req_id: '<held by the BFF>' } },
        note: 'The BFF holds the request instead of calling PingOne. A real run answers 200 with an auth_req_id and pushes to the user\'s device.',
      }),
      traceStep({
        id: 'push',
        title: 'Push to the user\'s device',
        note: 'The mock phone shows the notification. The user decides there, never in the browser that started the request.',
      }),
    ],
  };
  req.session.consentMockPhone = pending;
  return view(pending, 'pending');
}

function poll(req, { now = Date.now } = {}) {
  const pending = req.session?.consentMockPhone;
  if (!pending) throw fail('CONSENT_MOCK_NOTHING_PENDING', 'No approval request is pending', 409);
  if (pending.expiresAt <= now()) {
    delete req.session.consentMockPhone;
    return view(pending, 'expired', { trace: [traceStep({ id: 'expired', title: 'Token request', response: { status: 400, body: { error: 'expired_token' } } })] });
  }
  return view(pending, 'pending');
}

function decide(req, decision) {
  const pending = req.session?.consentMockPhone;
  if (!pending) throw fail('CONSENT_MOCK_NOTHING_PENDING', 'No approval request is pending', 409);
  if (decision !== 'approve' && decision !== 'deny') throw fail('CONSENT_MOCK_DECISION_INVALID', 'The decision must be approve or deny', 400);
  delete req.session.consentMockPhone;
  const approved = decision === 'approve';
  return view(pending, approved ? 'approved' : 'denied', {
    trace: [traceStep({
      id: 'decision',
      title: 'Token request (poll)',
      request: { method: 'POST', url: '/token', params: { grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: '<held by the BFF>' } },
      response: approved ? { status: 200, body: { note: 'tokens issued in a real run; none here' } } : { status: 400, body: { error: 'access_denied' } },
      note: approved ? 'Approve was tapped on the mock phone. No token was issued.' : 'Deny was tapped on the mock phone.',
    })],
  });
}

module.exports = { start, poll, decide };
