#!/usr/bin/env node
// scripts/compose-env-diff.js
'use strict';

/**
 * Name the compose services whose runtime environment changed between two
 * revisions of docker-compose.yml.
 *
 * Why this exists. deploy-live.sh maps changed PATHS to services. An edit that
 * only touches a service's `environment:` block changes no path under any
 * service's source dir, so deploy-live restarted nothing, stamped the range as
 * deployed, and exited 0. Container env is frozen at create, so the running
 * service kept the old value while the checkout, the merge and the deploy all
 * looked clean.
 *
 * Observed twice on 2026-08-28 while wiring the audit door: adding
 * GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID and the MCP_GW_OAUTH_STATIC_* block
 * merged and "deployed" successfully, and `docker exec ... env` still reported
 * <unset>. That reads as "the code is wrong" and sends you debugging the
 * feature instead of the deploy — the silent direction of the same failure the
 * image-built-services trap has.
 *
 * The fix is not a louder warning: `run-docker.sh restart <svc>` already
 * recreates, which is exactly what picks up new env. So deploy-live can simply
 * DEPLOY these services instead of telling a human to. This file answers the
 * only question it was missing: which ones.
 *
 * Compared structurally rather than by diff hunk because a hunk tells you which
 * LINES moved, not which SERVICE owns them — and `environment:` blocks all look
 * alike, so line-based attribution guesses wrong at block boundaries.
 *
 * Text-parsed, not YAML-parsed: this runs from a bash deploy script on a host
 * where root node_modules may not be installed, the same constraint the service
 * map gates work under.
 *
 * ponytail: a near-identical service-block scanner lives in
 * check-ghcr-source-labels.js (it wants `build:`, this wants `environment:`).
 * Two small readers beat one shared abstraction at this size; if a third
 * appears, lift them into scripts/lib/composeBlocks.js.
 *
 * Usage:
 *   node scripts/compose-env-diff.js <old-compose> <new-compose>
 * Prints one service name per line; empty output means nothing to redeploy.
 */

const fs = require('fs');

// Keys whose change requires a RECREATE, not a restart-in-place. `environment:`
// and `env_file:` are read once at container create; `build.args` bakes into
// the image. Everything else in a service block either does not affect a
// running container or is already covered by deploy-live's path mapping.
const ENV_KEYS = ['environment', 'env_file'];

/**
 * Split a compose file into service name -> raw block lines.
 *
 * @param {string} text docker-compose.yml contents
 * @returns {Map<string, string[]>}
 */
function serviceBlocks(text) {
  const blocks = new Map();
  let current = null;
  // Only two-space keys under `services:` are services. Without this, a
  // top-level `volumes:` or `networks:` mapping contributes its own entries at
  // the same indentation and they parse as services.
  let inServices = false;
  for (const line of text.split('\n')) {
    const topLevel = line.match(/^([A-Za-z0-9_.-]+):/);
    if (topLevel) {
      inServices = topLevel[1] === 'services';
      current = null;
      continue;
    }
    if (!inServices) continue;
    const svc = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (svc) {
      current = svc[1];
      blocks.set(current, []);
      continue;
    }
    if (current) blocks.get(current).push(line);
  }
  return blocks;
}

/**
 * The env-affecting slice of one service block, normalised for comparison.
 *
 * Comments and blank lines are dropped so that reformatting or annotating a
 * block does not trigger a needless recreate — only a real value change does.
 *
 * @param {string[]} block lines of one service block
 * @returns {string} canonical text; equal strings mean equal environment
 */
function envSignature(block) {
  const parts = [];

  const collect = (startIdx, bodyIndent) => {
    const out = [];
    for (let i = startIdx + 1; i < block.length; i += 1) {
      const line = block[i];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      if (indent < bodyIndent) break;
      out.push(line.trim());
    }
    return out;
  };

  block.forEach((line, i) => {
    const top = line.match(/^ {4}([A-Za-z0-9_]+):(.*)$/);
    if (!top) return;
    const [, key, inline] = top;
    if (ENV_KEYS.includes(key)) {
      const value = inline.trim();
      parts.push(`${key}:${value}`, ...collect(i, 6).map((l) => `${key}/${l}`));
    }
    if (key === 'build') {
      // build.args only — context/dockerfile changes already move a path that
      // deploy-live maps, and target changes are caught by the label gate.
      for (let j = i + 1; j < block.length && /^ {6}\S/.test(block[j]); j += 1) {
        if (/^ {6}args:/.test(block[j])) {
          parts.push('build.args:', ...collect(j, 8).map((l) => `build.args/${l}`));
        }
      }
    }
  });

  return parts.join('\n');
}

/**
 * @param {string} oldText docker-compose.yml at the old revision
 * @param {string} newText docker-compose.yml at the new revision
 * @returns {string[]} service names needing a recreate, sorted
 */
function changedEnvServices(oldText, newText) {
  const before = serviceBlocks(oldText);
  const after = serviceBlocks(newText);
  const changed = [];
  for (const [name, block] of after) {
    // A service that did not exist before is created by this deploy anyway —
    // deploy-live's own path mapping and run-docker.sh own that case, and
    // reporting it here would ask for a recreate of something not yet running.
    if (!before.has(name)) continue;
    if (envSignature(before.get(name)) !== envSignature(block)) changed.push(name);
  }
  return changed.sort();
}

function main(argv) {
  const [oldFile, newFile] = argv;
  if (!oldFile || !newFile) {
    console.error('usage: compose-env-diff.js <old-compose> <new-compose>');
    return 2;
  }
  const read = (f) => (f === '/dev/null' || !fs.existsSync(f) ? '' : fs.readFileSync(f, 'utf8'));
  for (const svc of changedEnvServices(read(oldFile), read(newFile))) console.log(svc);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { serviceBlocks, envSignature, changedEnvServices };
