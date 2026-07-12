/**
 * Middleware: Redirect admin users without MFA to /mfa-challenge
 * Customer users bypass this check entirely.
 *
 * Checks session for mfa_verified flag and redirects admins to the MFA challenge
 * page if they haven't completed MFA verification yet. Feature-gated by ADMIN_MFA_REQUIRED.
 */

'use strict';

const configStore = require('../services/configStore');

module.exports = function mfaSessionGate(req, res, next) {
  // Check if MFA is required by feature flag
  const adminMfaRequired = configStore.get('ADMIN_MFA_REQUIRED');

  // Not logged in, or MFA not required — pass through
  if (!req.session?.user || !adminMfaRequired) {
    return next();
  }

  const { role, mfa_verified } = req.session.user;

  // Customer users always pass; admin users need MFA
  if (role === 'customer' || mfa_verified) {
    return next();
  }

  // Admin without MFA: redirect to challenge, remember original intent
  req.session.mfa_redirect_to = req.originalUrl;
  return res.redirect('/mfa-challenge');
};
