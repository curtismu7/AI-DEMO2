'use strict';

/**
 * Token-chain evidence for support-console operator writes.
 *
 * The rail on /admin/<vertical> reads the same trace vocabulary as agent runs,
 * but an operator write runs none of the agent pipeline: there is no LLM, no
 * RFC 8693 exchange, no gateway. Minting those hops here would be fiction. What
 * really happened — and what the chain therefore shows — is the delegated-
 * authority story the support console exists to teach:
 *
 *   operator session  the verified admin session the BFF established at sign-in
 *   verification      THIS session's live identity verification for THIS customer
 *   the write         the row, its status before and after
 *   the audit         the operator-attributed audit entry
 *
 * No authorize hop: the console's scope table is advisory (nothing on this path
 * evaluates policy — see supportConsoleConfig.js), and a chain that showed a
 * policy decision that never ran would lie. No token claims: no token is minted
 * — the session's own token does the authorizing, as at sign-in.
 *
 * Consumed by routes/adminVerticals.js (writeAction) and
 * middleware/requireCustomerVerified.js (the 403 denial chain). No require back
 * into routes — the middleware takes its deps as arguments to avoid a circular
 * require, and this module must not reintroduce one.
 */

function operatorSessionEvent(req, vertical) {
  return {
    id: 'operator-session',
    label: 'Operator session',
    status: 'done',
    timestamp: new Date().toISOString(),
    vertical,
    claims: {
      operator: req.user?.sub || req.user?.username || 'unknown',
      username: req.user?.username || null,
      role: req.user?.role || null,
    },
    explanation:
      'The operator signed in through PingOne OIDC. The BFF holds the tokens '
      + 'server-side and re-establishes identity from the session cookie on '
      + 'every request — the browser never holds a bearer token.',
  };
}

function operatorVerificationEvent(verified, customerId, expiresAt, vertical) {
  return {
    id: 'operator-verification',
    label: verified ? 'Customer identity verified' : 'Customer identity NOT verified',
    status: verified ? 'done' : 'error',
    timestamp: new Date().toISOString(),
    vertical,
    claims: { customerId: String(customerId) },
    ...(verified ? { verifiedUntil: new Date(expiresAt).toISOString() } : {}),
    explanation: verified
      ? 'The operator completed the customer-identity challenge for THIS '
        + 'customer. The verification is keyed to the customer in the operator '
        + 'session — it authorizes writes against them and no one else.'
      : 'No live verification for THIS customer in this session. Every write '
        + 'against customer data requires it — the request was refused before '
        + 'the store was touched.',
  };
}

/**
 * The full chain for a completed operator write. `action` is the audited
 * action string ("POST /api/admin/<vertical>/...").
 */
function buildOperatorWriteChain(req, { vertical, customerId, verifiedUntil, action, row, beforeStatus, afterStatus, request, result }) {
  return [
    operatorSessionEvent(req, vertical),
    operatorVerificationEvent(true, customerId, verifiedUntil, vertical),
    {
      id: 'operator-write',
      label: `Store write — ${row}`,
      status: 'done',
      timestamp: new Date().toISOString(),
      vertical,
      claims: { row: String(row), beforeStatus: beforeStatus ?? null, afterStatus: afterStatus ?? null },
      request: { method: request.method, url: request.url },
      result,
      explanation:
        'The BFF applied the write through the vertical store helper, scoped '
        + 'to the verified customer\'s own data. The operator\'s session '
        + 'identity, not a token passed through the browser, is what '
        + 'authorized it.',
    },
    {
      id: 'operator-audit',
      label: 'Audit recorded',
      status: 'done',
      timestamp: new Date().toISOString(),
      vertical,
      claims: { operator: req.user?.sub || req.user?.username || 'unknown', action },
      explanation:
        'The write was recorded in the operator audit trail, attributed to '
        + 'the operator — the accountability half of acting on behalf of '
        + 'someone else.',
    },
  ];
}

/** The refusal chain for a write blocked by the verification gate. */
function buildOperatorDenialChain(req, { vertical, customerId, action }) {
  return [
    operatorSessionEvent(req, vertical),
    operatorVerificationEvent(false, customerId, undefined, vertical),
    {
      id: 'operator-audit',
      label: 'Audit recorded',
      status: 'done',
      timestamp: new Date().toISOString(),
      vertical,
      claims: { operator: req.user?.sub || req.user?.username || 'unknown', action },
      explanation:
        'A denial that leaves no trace is worse than no audit at all — the '
        + 'refused request was recorded too.',
    },
  ];
}

module.exports = { buildOperatorWriteChain, buildOperatorDenialChain };
