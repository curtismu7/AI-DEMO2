'use strict';

/**
 * Agent Gateway config file registry.
 *
 * The single allowlist of JSON files the /agent-gateway-config admin page may
 * read and write. Requests reference files by opaque `id` ONLY — the id → path
 * mapping lives here, so a request can never supply an arbitrary path (no
 * traversal). Every path is also re-checked against its base dir before any
 * read/write (see resolveEntry).
 *
 * Base dirs (env override → Docker mount → local checkout):
 *   PING_GATEWAY_CONFIG_DIR  gateway config dir (config.json, admin.json, routes/)
 *   SCOPE_TOPOLOGY_PATH      the master scope-topology.json
 */

const fs = require('fs');
const path = require('path');

function firstExisting(candidates) {
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return candidates[candidates.length - 1]; // last = sensible default even if absent
}

// services/agentGatewayConfig → repo root is three levels up.
const REPO_ROOT = path.join(__dirname, '../../..');

const GATEWAY_CONFIG_DIR = firstExisting([
  process.env.PING_GATEWAY_CONFIG_DIR,
  '/app/gateway-config',                          // docker-compose mount
  path.join(REPO_ROOT, 'ping-gateway/config'),    // local checkout
]);

const SCOPE_TOPOLOGY_PATH = firstExisting([
  process.env.SCOPE_TOPOLOGY_PATH,
  '/scope-topology.json',                         // docker-compose mount
  path.join(REPO_ROOT, 'scope-topology.json'),    // local checkout
]);

const ENV_EXAMPLE_PATH = firstExisting([
  process.env.PING_GATEWAY_ENV_EXAMPLE,
  path.join(GATEWAY_CONFIG_DIR, '../.env.example'),
  path.join(REPO_ROOT, 'ping-gateway/.env.example'),
]);

/**
 * reloadMode:
 *   'auto'    — IG's RouterHandler watches the routes dir (~10s) and reloads.
 *   'restart' — config.json/admin.json/scope-topology.json need a gateway (and,
 *               for scope-topology, BFF) restart to take effect.
 */
function buildRegistry() {
  const entries = [
    {
      id: 'config',
      label: 'config.json',
      group: 'Core',
      type: 'ig-config',
      reloadMode: 'restart',
      absPath: path.join(GATEWAY_CONFIG_DIR, 'config.json'),
      baseDir: GATEWAY_CONFIG_DIR,
    },
    {
      id: 'admin',
      label: 'admin.json',
      group: 'Core',
      type: 'ig-admin',
      reloadMode: 'restart',
      absPath: path.join(GATEWAY_CONFIG_DIR, 'admin.json'),
      baseDir: GATEWAY_CONFIG_DIR,
    },
    {
      id: 'scope-topology',
      label: 'scope-topology.json',
      group: 'Scope Topology',
      type: 'scope-topology',
      reloadMode: 'restart',
      absPath: SCOPE_TOPOLOGY_PATH,
      baseDir: path.dirname(SCOPE_TOPOLOGY_PATH),
    },
  ];

  // Discover route files dynamically so new routes/*.json appear automatically.
  const routesDir = path.join(GATEWAY_CONFIG_DIR, 'routes');
  let routeFiles = [];
  try {
    routeFiles = fs.readdirSync(routesDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch { /* routes dir may be absent in some deployments */ }

  for (const file of routeFiles) {
    entries.push({
      id: `route:${file}`,
      label: `routes/${file}`,
      group: 'Routes',
      type: 'ig-route',
      reloadMode: 'auto',
      absPath: path.join(routesDir, file),
      baseDir: routesDir,
    });
  }

  return entries;
}

/** Public metadata (no contents, no absolute paths leaked). */
function listFiles() {
  return buildRegistry().map(({ id, label, group, type, reloadMode }) => ({
    id, label, group, type, reloadMode,
  }));
}

/**
 * Resolve an id to its registry entry, defending against traversal: the file
 * must still live inside its declared baseDir after path normalisation.
 * Returns null for unknown ids or paths that escape the base.
 */
function resolveEntry(id) {
  const entry = buildRegistry().find((e) => e.id === id);
  if (!entry) return null;
  const resolved = path.resolve(entry.absPath);
  const base = path.resolve(entry.baseDir);
  // Guard against traversal: the file must sit inside baseDir. Handle baseDir
  // being the filesystem root ('/') — there `base + path.sep` would be '//',
  // which no real path starts with (this is how scope-topology.json lives at
  // '/scope-topology.json' in the Docker deployment).
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved !== base && !resolved.startsWith(prefix)) return null;
  return { ...entry, absPath: resolved };
}

module.exports = {
  listFiles,
  resolveEntry,
  GATEWAY_CONFIG_DIR,
  SCOPE_TOPOLOGY_PATH,
  ENV_EXAMPLE_PATH,
};
