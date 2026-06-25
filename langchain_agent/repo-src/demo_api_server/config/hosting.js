'use strict';

/**
 * Deployment target detection (Replit, local).
 */

/** True in a Replit Repl or Replit Deployment (env set by the platform). */
function isReplit() {
  return !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT);
}

/**
 * OAuth client IDs/secrets are supplied only via env — Config UI hides the full editor (hosted demo style).
 * On Replit, set REPLIT_MANAGED_OAUTH=true to enable deployment-managed mode.
 */
function isDeploymentManagedPingOneOAuth() {
  return process.env.REPLIT_MANAGED_OAUTH === 'true';
}

/**
 * Prefer ADMIN_CONFIG_PASSWORD + X-Config-Password when sessions may not persist, opt-in on Replit.
 */
function useConfigPasswordHeader() {
  return process.env.REPLIT_CONFIG_PASSWORD_MODE === 'true';
}

/**
 * Extra referer logging for OAuth callbacks on known hosted stacks (canonical URL / PingOne flows).
 */
function shouldCheckOAuthCallbackReferer() {
  return isReplit();
}

module.exports = {
  isReplit,
  isDeploymentManagedPingOneOAuth,
  useConfigPasswordHeader,
  shouldCheckOAuthCallbackReferer,
};
