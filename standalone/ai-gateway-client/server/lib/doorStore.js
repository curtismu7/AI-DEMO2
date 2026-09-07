'use strict';
/**
 * doorStore.js — the last Privilege console discovery (Agentic Apps + policy
 * inventory), persisted as a flat JSON file under ~/.ai-gateway-client (or
 * DOOR_STORE_DIR) rather than a database — this is a local single-user tool.
 * Adapted from the embedded demo's LMDB-backed privilegeDoorStore.lmdb.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR = process.env.DOOR_STORE_DIR || path.join(os.homedir(), '.ai-gateway-client');
const STORE_FILE = path.join(STORE_DIR, 'doors.json');

function saveInventory(record) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const withMeta = { ...record, discoveredAt: new Date().toISOString(), policyCount: (record.policies || []).length };
  fs.writeFileSync(STORE_FILE, JSON.stringify(withMeta, null, 2), { mode: 0o600 });
  return withMeta;
}

function getInventory() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { saveInventory, getInventory };
