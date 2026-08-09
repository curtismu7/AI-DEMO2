'use strict';

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
function makeRequireCustomerVerified({ isCustomerVerified, recordAudit }) {
  return function requireCustomerVerified(req, res, next) {
    const customerId = req.body?.userId || req.params?.customerId;
    if (!customerId) return next(); // the route's own 400 handles this

    if (isCustomerVerified(req, customerId)) return next();

    recordAudit(req, {
      action: `${req.method} ${req.originalUrl}`,
      customerId: String(customerId),
      outcome: 'denied',
    });

    return res.status(403).json({
      error: 'customer_not_verified',
      customerId: String(customerId),
      need_verification: true,
    });
  };
}

module.exports = { makeRequireCustomerVerified };
