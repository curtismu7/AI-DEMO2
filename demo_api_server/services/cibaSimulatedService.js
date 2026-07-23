'use strict';

/**
 * cibaSimulatedService.js
 *
 * In-process simulated CIBA engine — used as a failover when PingOne's
 * /as/bc-authorize endpoint is unreachable or unprovisioned (see the
 * "Known gap" note in claudSkills/pingone/ciba/SKILL.md). Mirrors
 * cibaService.js's public call shape closely enough that routes/ciba.js
 * can call either behind one interface, and plays the same role that
 * simulatedAuthorizeService.js plays for transactionAuthorizationService.js.
 *
 * No network calls, no PingOne credentials.
 */

const crypto = require('crypto');
const { logEvent: logAppEvent } = require('./appEventService');

const SIMULATED_APPROVE_DELAY_MS = 60_000;
const SIMULATED_EXPIRES_IN = 300;
const SIMULATED_INTERVAL = 5;

/**
 * Mint a fake auth_req_id and initiation response, matching the shape of
 * cibaService.initiateBackchannelAuth()'s return value.
 *
 * @param {string} loginHint
 * @param {string} [bindingMessage]
 * @param {string} [scope]
 * @param {string} [acrValues]
 * @returns {{ auth_req_id: string, expires_in: number, interval: number }}
 */
function initiateSimulated(loginHint, bindingMessage, scope, acrValues) {
  const auth_req_id = `sim-${crypto.randomUUID()}`;
  logAppEvent('auth_lifecycle', 'info', `CIBA (simulated): initiating for ${loginHint}`,
    { tag: 'ciba/initiate', metadata: { loginHint, scope, engine: 'simulated', hasAcrValues: !!acrValues, bindingMessage: bindingMessage || undefined } });
  return {
    auth_req_id,
    expires_in: SIMULATED_EXPIRES_IN,
    interval: SIMULATED_INTERVAL,
  };
}

/**
 * True once enough time has passed since initiation to "auto-approve" the
 * simulated request.
 *
 * @param {{ initiatedAt: number }} pending — the session's cibaRequests[authReqId] record
 * @returns {boolean}
 */
function isSimulatedApproved(pending) {
  return Date.now() - pending.initiatedAt >= SIMULATED_APPROVE_DELAY_MS;
}

module.exports = {
  initiateSimulated,
  isSimulatedApproved,
  SIMULATED_APPROVE_DELAY_MS,
};
