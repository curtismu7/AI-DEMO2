'use strict';
/**
 * privilegeDoorStore.lmdb.js — the Privilege Agentic App list, persisted.
 *
 * WHY THIS EXISTS. The Door picker used to be built from three hardcoded app
 * names in routes/privilegeMcpClient.js. The operator keeps registering new
 * Agentic Apps, so a hardcoded list is wrong by construction — a new app
 * needed a code change.
 *
 * consoleInventory() already reads the real list from the Privilege console
 * API. What it cannot do is stay readable: the only credential that API takes
 * is an `auth_token` cookie the operator pastes out of a console browser
 * session, good for roughly an hour. So discovery is an operator action and
 * the result has to outlive the token that produced it — otherwise serving a
 * door would depend on a credential that expires during the demo.
 *
 * Hence: discovery writes here, and everything that SERVES a door reads here.
 * Only re-discovery needs the token.
 *
 * The console token itself is never stored — not here, not anywhere. This
 * holds app names and their status, which are configuration, not secrets.
 *
 * Key layout (single LMDB DB named 'privilegeDoors'):
 *   inventory -> { envId, gatewayOrigin, applications: [...], policyCount,
 *                  discoveredAt }
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'privilegeDoors';
const KEY = 'inventory';

function _db() { return getDb(DB_NAME); }

/**
 * Which policies name this app.
 *
 * The pacpolicy Spec schema is undocumented (see consoleInventory's comment),
 * so this matches on the serialized text and is a HEURISTIC — "this policy
 * mentions the app", never "this policy grants the app". It is computed here,
 * at discovery time, rather than in the UI because the policies are not
 * persisted: only the answer survives the console token, and a lapsed policy
 * is the most common cause of a 403 that reads as misconfiguration.
 */
function policiesMentioning(policies, appName) {
  if (!appName) return [];
  return policies
    .filter((p) => {
      try { return JSON.stringify(p.spec || {}).includes(appName); } catch { return false; }
    })
    .map((p) => p.name);
}

/**
 * Record a completed discovery. Replaces the previous one wholesale: the
 * console list is authoritative, so an app that has gone away must disappear
 * from the picker rather than linger as a door that 404s.
 */
function saveInventory({ envId, gatewayOrigin, applications = [], policies = [] }) {
  const record = {
    envId: envId || '',
    gatewayOrigin: gatewayOrigin || '',
    applications: applications
      .filter((app) => app?.name)
      .map((app) => ({
        name: app.name,
        status: app.status || '',
        frontEndName: app.frontEndName || null,
        backends: app.backends || [],
        entryPath: app.entryPath || null,
        policies: policiesMentioning(policies, app.name),
      })),
    policyCount: policies.length,
    discoveredAt: Date.now(),
  };
  _db().putSync(KEY, record);
  return record;
}

/** The last discovery, or null when nobody has ever connected the console. */
function getInventory() {
  return _db().get(KEY) || null;
}

function clearInventory() {
  _db().removeSync(KEY);
}

module.exports = { saveInventory, getInventory, clearInventory, policiesMentioning, DB_NAME };
