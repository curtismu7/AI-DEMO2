'use strict';
/**
 * demoTrackStore.lmdb.js — LMDB persistence for the Guided Demo Track run
 * ledger, backing services/demoTrackService.js.
 * Keys (single DB 'demo_track'):
 *   demo-track:active  -> active run object
 *   demo-track:history -> array of archived runs (newest first, cap 20)
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'demo_track';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function get(key) { return _db().get(key) || null; }
function put(key, value) { _db().putSync(key, value); }

module.exports = { get, put };
