'use strict';

/**
 * Isolated, throwaway LMDB location for the (default-config) test suite.
 *
 * The app's LMDB store (data/persistent/lmdb/) holds credentials + config the
 * running server needs across restarts. Tests must NEVER read or write it —
 * doing so both pollutes test results with operator state AND risks corrupting
 * real credentials. setup.js points process.env.LMDB_PATH at a per-worker subdir
 * under here; globalSetup wipes BASE once per run so each run starts fresh
 * (matching CI's empty-store behavior). A per-worker subdir keeps parallel jest
 * workers from colliding on one store.
 */

const os = require('os');
const path = require('path');

const BASE = path.join(os.tmpdir(), 'ai-demo-jest-lmdb');

function workerDir() {
  return path.join(BASE, String(process.env.JEST_WORKER_ID || '1'));
}

module.exports = { BASE, workerDir };
