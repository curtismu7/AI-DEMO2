'use strict';

/**
 * Demo-mode guard middleware.
 *
 * When the DEMO_MODE environment variable is set to any truthy value, certain
 * destructive operations (DELETE, password change, config reset) are blocked
 * so the shared public demo cannot be accidentally or maliciously corrupted.
 *
 * Usage:
 *   const { blockInDemoMode } = require('../middleware/demoMode');
 *   router.delete('/:id', blockInDemoMode('account deletion'), requireAdmin, handler);
 *
 * On localhost / private deployments where DEMO_MODE is not set, the middleware
 * is a transparent no-op.
 */

const isDemoMode = () => !!process.env.DEMO_MODE;

/**
 * Returns an Express middleware that blocks the request when demo mode is on.
 * @param {string} operationLabel - Human-readable name shown in the error message.
 */
function blockInDemoMode(operationLabel) {
  return function demoModeGuard(req, res, next) {
    if (!isDemoMode()) return next();
    return res.status(403).json({
      error:     'demo_mode',
      operation: operationLabel,
      message:   `"${operationLabel}" is disabled on the shared public demo. ` +
                 'Fork the repo and deploy your own instance to enable all operations. ' +
                 'See the Config page → Run Your Own Instance for instructions.',
    });
  };
}

module.exports = { blockInDemoMode, isDemoMode };
