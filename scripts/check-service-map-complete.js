#!/usr/bin/env node
// scripts/check-service-map-complete.js
'use strict';

/**
 * Static hygiene: every service key resolves in ALL FIVE lookups, and every
 * declared sourceDir is a directory data/serverInventory.js also knows about.
 *
 * Why this gate exists: a key present in four maps and missing from the fifth
 * is invisible. `se-update-code.sh <key>` keeps working while the build-all
 * and roll-all loops silently skip it — so the path you test is the one that
 * was never broken. That shipped twice: agent-service, then llm (#2495,
 * fixed #2505). The comment above ALL_KEYS documented the trap both times and
 * documentation did not stop it, so it becomes a check.
 *
 * Reads serverInventory.js as TEXT rather than require()ing it: root
 * node_modules is not installed in CI's hygiene job, and that module pulls in
 * the BFF's dependency graph. Same dependency-free approach as
 * check-compose-services-registered.js.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIELDS = ['key', 'sourceDir', 'composeService', 'ghcrImage', 'localImage', 'k8sDeployment'];

/** sourceDir -> service key, parsed from data/serverInventory.js source text. */
function readInventory() {
  const src = fs.readFileSync(
    path.join(ROOT, 'demo_api_server', 'data', 'serverInventory.js'), 'utf8',
  );
  const out = {};
  // Entries are object literals carrying both fields; pair them per entry so a
  // key from one entry cannot bind to a sourceDir from another.
  for (const block of src.split('{').slice(1)) {
    const key = block.match(/key:\s*'([^']+)'/);
    const dir = block.match(/sourceDir:\s*'([^']+)'/);
    if (key && dir) out[dir[1]] = key[1];
  }
  return out;
}

/**
 * @param {object[]} map entries from `se-update-code.sh --print-map`
 * @param {Record<string,string>} inventory sourceDir -> serverInventory key
 * @returns {string[]} one message per problem; empty means pass
 */
function checkMap(map, inventory) {
  const errors = [];
  for (const entry of map) {
    for (const field of FIELDS) {
      if (!entry[field]) {
        errors.push(
          `service "${entry.key || '(unnamed)'}" has an empty ${field} — ` +
          'a key missing from one lookup is silently skipped by build-all and roll-all',
        );
      }
    }
    if (entry.sourceDir && !inventory[entry.sourceDir]) {
      errors.push(
        `service "${entry.key}" declares sourceDir "${entry.sourceDir}", which ` +
        'data/serverInventory.js does not list — one of the two has drifted',
      );
    }
  }
  return errors;
}

function main() {
  const raw = execFileSync(path.join(ROOT, 'se-update-code.sh'), ['--print-map'], {
    encoding: 'utf8',
    env: { ...process.env, PING_EMAIL: '', SE_NAMESPACE: '' },
  });
  const map = JSON.parse(raw);
  if (map.length === 0) {
    console.error('[service-map] FAIL — --print-map returned no services; parser or ALL_KEYS is broken');
    return 1;
  }
  const errors = checkMap(map, readInventory());
  if (errors.length) {
    for (const e of errors) console.error('[service-map] FAIL —', e);
    return 1;
  }
  console.log(`[service-map] OK — ${map.length} services, all five lookups resolve, sourceDirs match serverInventory`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, checkMap, readInventory };
