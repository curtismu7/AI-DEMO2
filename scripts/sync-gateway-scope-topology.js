#!/usr/bin/env node
/**
 * ping-gateway/config/scope-topology.json is a byte-for-byte copy of the root
 * scope-topology.json. PingGateway's p1az-decision.groovy reads the copy (it is
 * what gets mounted at /var/gateway/config) for its tool -> requiredScopes
 * backstop, so a stale copy means the gateway enforces yesterday's scopes while
 * the BFF and the PDP enforce today's.
 *
 * The copy used to be maintained by hand and nothing compared the two; it fell
 * ~190 lines behind (TECH_DEBT 2026-08-26). It is now generated:
 *
 *   node scripts/sync-gateway-scope-topology.js          write the copy
 *   node scripts/sync-gateway-scope-topology.js --check  exit 1 if it differs
 *
 * `npm run topology:verify` runs --check, so CI fails a PR that changes the root
 * topology without re-running the sync.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'scope-topology.json';
const COPY = path.join('ping-gateway', 'config', 'scope-topology.json');

/** @returns {{ inSync: boolean, reason: string|null }} */
function compare(root) {
  const source = fs.readFileSync(path.join(root, SOURCE));
  let copy;
  try {
    copy = fs.readFileSync(path.join(root, COPY));
  } catch {
    return { inSync: false, reason: `${COPY} is missing` };
  }
  return source.equals(copy)
    ? { inSync: true, reason: null }
    : { inSync: false, reason: `${COPY} differs from ${SOURCE}` };
}

function sync(root) {
  fs.copyFileSync(path.join(root, SOURCE), path.join(root, COPY));
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (process.argv.includes('--check')) {
    const { inSync, reason } = compare(root);
    if (!inSync) {
      console.error(`❌ ${reason}. PingGateway would enforce a stale topology.`);
      console.error('   Fix: node scripts/sync-gateway-scope-topology.js   (then restart ping-gateway)');
      process.exit(1);
    }
    console.log(`✅ ${COPY} matches ${SOURCE}`);
  } else {
    sync(root);
    console.log(`wrote ${COPY} from ${SOURCE}`);
  }
}

module.exports = { compare, sync, SOURCE, COPY };
