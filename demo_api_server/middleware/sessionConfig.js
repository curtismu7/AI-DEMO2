/**
 * sessionConfig.js
 *
 * Compat shim for services that historically imported
 * `require('../middleware/sessionConfig').store` (killSwitchService,
 * auditLogService, agentRateLimit). The real store is created in server.js
 * (LMDB or memory) and registered here via setStore().
 *
 * Do not create a second store here — that would diverge from express-session.
 */

/** @type {import('express-session').Store | null} */
let store = null;

/**
 * Register the process-wide express-session store (called from server.js).
 * @param {import('express-session').Store | null | undefined} sessionStore
 */
function setStore(sessionStore) {
  store = sessionStore || null;
}

module.exports = {
  get store() {
    return store;
  },
  setStore,
};
