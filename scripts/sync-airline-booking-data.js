#!/usr/bin/env node
/**
 * ping-gateway/config/airline-booking-policy-data.json is a byte-for-byte copy of
 * demo_mcp_resource_server/seed/airline-booking-policy-data.json. PingGateway's
 * p1az-decision.groovy reads the copy (./config is mounted at /var/gateway/config)
 * to put the authoritative fare and the user's agent spend limit in the
 * Authorize request for book_airline_flight, so a stale copy means the gateway
 * judges yesterday's fares.
 *
 *   node scripts/sync-airline-booking-data.js          write the copy
 *   node scripts/sync-airline-booking-data.js --check  exit 1 if it differs
 *
 * Same pattern as scripts/sync-gateway-scope-topology.js.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join('demo_mcp_resource_server', 'seed', 'airline-booking-policy-data.json');
const COPY = path.join('ping-gateway', 'config', 'airline-booking-policy-data.json');

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
      console.error(`${reason}. PingGateway would judge stale booking data.`);
      console.error('Fix: node scripts/sync-airline-booking-data.js   (then restart ping-gateway)');
      process.exit(1);
    }
    console.log(`${COPY} matches ${SOURCE}`);
  } else {
    sync(root);
    console.log(`wrote ${COPY} from ${SOURCE}`);
  }
}

module.exports = { compare, sync, SOURCE, COPY };
