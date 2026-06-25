'use strict';
/**
 * securityMonitoringStore.lmdb.js — LMDB persistence for the security-monitoring
 * dashboard state (services/securityMonitoringService.js), so alerts, client
 * risk profiles, and metrics survive a restart.
 *
 * Unlike the other stores this is NOT write-through: trackClientBehavior runs on
 * every token event, so the service flushes a single serialized snapshot on a
 * timer (and on demand) instead of writing per event. State is pure telemetry —
 * a lost snapshot between flushes is acceptable.
 *
 * Key layout (single LMDB DB named 'security_monitoring'):
 *   snapshot -> { events[], alerts[], behavior[], metrics, savedAt }
 *               (Sets in behavior are serialized to arrays by the service)
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'security_monitoring';
const SNAPSHOT_KEY = 'snapshot';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function save(snapshot) { _db().putSync(SNAPSHOT_KEY, snapshot); }
function load() { return _db().get(SNAPSHOT_KEY) || null; }
function clearAll() { _db().removeSync(SNAPSHOT_KEY); }

module.exports = { save, load, clearAll };
