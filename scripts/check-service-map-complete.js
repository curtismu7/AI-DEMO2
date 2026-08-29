#!/usr/bin/env node
// scripts/check-service-map-complete.js
'use strict';

/**
 * Static hygiene: every service key resolves in ALL FIVE lookups, every
 * declared sourceDir is a directory data/serverInventory.js also knows about,
 * and every ghcrImage is one k8s/aws/deploy.sh can actually rewrite.
 *
 * Blind spot by design: ALL_KEYS is this gate's iteration source, so a key
 * deleted from ALL_KEYS entirely is invisible here.
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
 * The GHCR image names k8s/aws/deploy.sh knows how to rewrite.
 *
 * This is a SIXTH service map, shaped unlike the other five: an indexed array
 * of "local:ghcr" pairs rather than a keyed lookup, living in a deploy script
 * instead of se-update-code.sh. It sat outside this gate entirely, which is the
 * same blind spot the gate exists to close, just one map further out — a
 * service added to the five and missed here deploys on SE still pointing at a
 * local image name, after an otherwise-clean CI build.
 *
 * Only the map -> IMAGE_MAP direction is asserted. Extra IMAGE_MAP entries are
 * legitimate: it also carries images this repo does not CI-build.
 *
 * @param {string} text contents of k8s/aws/deploy.sh
 * @returns {Set<string>} the GHCR-side name of every pair
 */
function readImageMap(text) {
  const block = text.match(/IMAGE_MAP=\(([\s\S]*?)\n\)/);
  if (!block) return new Set();
  const names = new Set();
  for (const line of block[1].split('\n')) {
    const pair = line.trim().match(/^"([^":]+):([^":]+)"$/);
    if (pair) names.add(pair[2]);
  }
  return names;
}

/**
 * @param {object[]} map entries from `se-update-code.sh --print-map`
 * @param {Record<string,string>} inventory sourceDir -> serverInventory key
 * @param {Set<string>} imageMap GHCR names from k8s/aws/deploy.sh's IMAGE_MAP
 * @returns {string[]} one message per problem; empty means pass
 */
function checkMap(map, inventory, imageMap) {
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
    if (entry.sourceDir && !fs.existsSync(path.join(ROOT, entry.sourceDir))) {
      errors.push(
        `service "${entry.key}" declares sourceDir "${entry.sourceDir}", which ` +
        'does not exist on disk — a rename updated neither se-update-code.sh nor ' +
        'data/serverInventory.js, so CI would build nothing for this service',
      );
    }
    if (entry.ghcrImage && !imageMap.has(entry.ghcrImage)) {
      errors.push(
        `service "${entry.key}" builds GHCR image "${entry.ghcrImage}", which ` +
        "k8s/aws/deploy.sh's IMAGE_MAP does not list — its manifests would keep " +
        'the local image name and the SE deployment would run stale or fail to pull',
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
  const inventory = readInventory();
  const inventoryCount = Object.keys(inventory).length;
  if (inventoryCount !== 18) {
    console.error(
      `[service-map] FAIL — readInventory parsed ${inventoryCount} sourceDir entries, ` +
      'expected 18; the parser is broken, not the map',
    );
    return 1;
  }
  const imageMap = readImageMap(
    fs.readFileSync(path.join(ROOT, 'k8s', 'aws', 'deploy.sh'), 'utf8'),
  );
  // Guarded like inventoryCount above: an IMAGE_MAP this parser failed to read
  // would silently pass every service, which is the failure it is here to stop.
  if (imageMap.size < map.length) {
    console.error(
      `[service-map] FAIL — readImageMap parsed ${imageMap.size} IMAGE_MAP pairs from ` +
      `k8s/aws/deploy.sh, fewer than the ${map.length} services in the build map; ` +
      'the parser is broken, not the map',
    );
    return 1;
  }
  const errors = checkMap(map, inventory, imageMap);
  if (errors.length) {
    for (const e of errors) console.error('[service-map] FAIL —', e);
    return 1;
  }
  console.log(
    `[service-map] OK — ${map.length} services, all five lookups resolve, `
    + `sourceDirs match serverInventory, ghcrImages all in IMAGE_MAP (${imageMap.size} pairs)`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, checkMap, readInventory, readImageMap };
