'use strict';

const { buildOperatorDenialChain } = require('../services/operatorTokenChain');

/**
 * Rejects a support write unless the operator's session holds a live
 * verification for the customer the write targets.
 *
 * The customer id is read from req.body.userId — the field every write action
 * in routes/adminVerticals.js already requires — falling back to
 * req.params.customerId for the case routes.
 *
 * Deliberately independent of req.session.stepUpVerified: that field records
 * the OPERATOR's own MFA. Honouring it here would let an operator's step-up
 * unlock writes against any customer.
 *
 * Takes its dependencies as arguments rather than requiring adminVerticals.js:
 * that file requires this one, and a circular require would leave one side
 * holding a half-built export.
 */
function makeRequireCustomerVerified({ isCustomerVerified, recordAudit, liveSupportSession, observeSupportEvent }) {
  return function requireCustomerVerified(req, res, next) {
    const customerId = req.body?.userId || req.params?.customerId;
    if (!customerId) return next(); // the route's own 400 handles this

    // The authority is the LIVE ceremony session: a customer token minted by
    // the customer's own sign-on, TTL-bounded, keyed to THIS customer. The
    // legacy TTL flag stays as the denial-chain fallback for a session that
    // predates the ceremony (old BFF behind new UI) but no longer grants.
    if (liveSupportSession && liveSupportSession(req, customerId)) return next();
    if (isCustomerVerified(req, customerId) && req.session?.support?.subjectToken) return next();

    const action = `${req.method} ${req.originalUrl}`;
    recordAudit(req, {
      action,
      customerId: String(customerId),
      outcome: 'denied',
    });
    // The 403 also stamps the support demo track. Injected like the other deps
    // (routes/adminVerticals.js requires demoTrackService); the default no-op
    // keeps direct constructions (tests) observation-free rather than broken.
    try { observeSupportEvent?.({ kind: 'write-denied' }, req.sessionID); } catch { /* best-effort */ }

    // The refusal's own evidence: which session tried, and the missing
    // verification. Rendered by the console rail like a completed write's
    // chain — a denial that draws nothing looks like a UI bug, not a control.
    // The vertical is the first path segment inside this router
    // (…/<vertical>/<resource>/…). req.baseUrl is only the mount
    // ("/api/admin") — req.path carries the per-vertical part.
    const vertical = String(req.path || '').split('/').filter(Boolean)[0];
    const tokenChain = buildOperatorDenialChain(req, { vertical, customerId, action });

    return res.status(403).json({
      error: 'customer_not_verified',
      customerId: String(customerId),
      need_verification: true,
      tokenChain,
    });
  };
}

module.exports = { makeRequireCustomerVerified };
