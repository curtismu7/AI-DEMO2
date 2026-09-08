'use strict';
/**
 * mcpProfileStore.js — saved MCP server profiles for the Generic MCP Inspector
 * (/mcp-inspector). A profile is "point this page at another MCP server":
 * websocket/http need a url, stdio needs a local command. Built-in profiles
 * are seeded (and self-healed, see seedBuiltIn) and protected from deletion:
 * DEFAULT_PROFILE_ID (this app's own banking MCP server — routes/mcpInspector.js
 * keeps its existing session-bearer / RFC 8693 / local-catalog-fallback
 * behavior untouched for it), PINGONE_PROFILE_ID (the hosted PingOne MCP
 * server, authenticated via routes/mcpPingOneAdminAuth.js's admin login rather
 * than a stored secret), and four `transport: 'privilege'` profiles — one per
 * known door on the single PingOne Privilege AI Gateway (see
 * privilege/CURRENT-CONFIGURATION.md) — all authenticated via
 * routes/mcpPrivilegeAuth.js's one admin login, no stored secret. Any other
 * profile dispatches through mcpTransports/*.
 *
 * Secrets (authValue, env values) are persisted in LMDB but never returned by
 * listProfiles()/createProfile() — callers needing them for an actual MCP call
 * use getProfile() server-side only.
 */
const crypto = require('crypto');
const lmdb = require('./lmdb/mcpProfileStore.lmdb');

const DEFAULT_PROFILE_ID = 'default-banking';
const PINGONE_PROFILE_ID = 'built-in-pingone-mcp';
// Kept as the original id: routes/mcpPrivilegeAuth.js's post-login redirect
// deep-links here (?profile=built-in-privilege-mcp) — renaming would break
// that link for anyone who bookmarked or is mid-flow on it.
const PRIVILEGE_PROFILE_ID = 'built-in-privilege-mcp';
const PRIVILEGE_OPENSEARCH_PROFILE_ID = 'built-in-privilege-opensearch';
const PRIVILEGE_BRAVE_PROFILE_ID = 'built-in-privilege-brave';
const PRIVILEGE_GRAFANA_PROFILE_ID = 'built-in-privilege-grafana';

// The gateway's client URL pattern is always <base>/<AgenticAppName>/mcp (see
// the skill below) — verified live 2026-09-07 (401, i.e. reachable, on all
// three non-opensearch paths; opensearch22's is quoted directly in the doc).
// .claude/skills/privilege-mcpgw-agent-k8s/SKILL.md is the operational source
// of truth if this base or any app name ever changes.
const PRIVILEGE_GATEWAY_BASE = 'https://mcpgw.ai-demo.ping-devops.com';

// 'pingone' and 'privilege' are reserved built-in transports —
// createProfile() (the public POST /profiles path) never accepts them; only
// ensureBuiltInsSeeded() writes them.
const TRANSPORTS = new Set(['websocket', 'http', 'stdio']);

const BUILTIN_PROFILE_IDS = new Set([
  DEFAULT_PROFILE_ID,
  PINGONE_PROFILE_ID,
  PRIVILEGE_PROFILE_ID,
  PRIVILEGE_OPENSEARCH_PROFILE_ID,
  PRIVILEGE_BRAVE_PROFILE_ID,
  PRIVILEGE_GRAFANA_PROFILE_ID,
]);

/**
 * Write a built-in profile only when it's missing or has drifted from the
 * desired shape (transport/url/label) — a no-op on the common path so this
 * doesn't turn every listProfiles()/getProfile() call into an LMDB write.
 * The drift check is what makes a stale value (like the dead gateway host
 * this replaced) self-heal on the next call instead of needing manual LMDB
 * surgery — see the 2026-09-07 incident in privilege/CURRENT-CONFIGURATION.md.
 */
function seedBuiltIn(id, desired) {
  const existing = lmdb.getProfile(id);
  const drifted = !existing
    || existing.transport !== desired.transport
    || existing.url !== desired.url
    || existing.label !== desired.label;
  if (!drifted) return;
  lmdb.saveProfile(id, {
    id,
    ...desired,
    isBuiltIn: true,
    createdAt: (existing && existing.createdAt) || new Date().toISOString(),
  });
}

function ensureBuiltInsSeeded() {
  seedBuiltIn(DEFAULT_PROFILE_ID, {
    label: 'AIDemo MCP (this app)',
    transport: 'websocket',
    isDefault: true,
  });
  seedBuiltIn(PINGONE_PROFILE_ID, {
    label: 'PingOne MCP (admin)',
    transport: 'pingone',
    isDefault: false,
  });
  seedBuiltIn(PRIVILEGE_PROFILE_ID, {
    label: 'Privilege: Banking (banking-rest2)',
    transport: 'privilege',
    url: `${PRIVILEGE_GATEWAY_BASE}/banking-rest2/mcp`,
    isDefault: false,
  });
  // Known limitation, not fixed here: this door 404s once actually
  // authenticated — the gateway rejects /opensearch22/mcp because that app's
  // backend is registered with an /sse entry path. See
  // demo_mcp_pingone/README.md "Entry path". The other
  // three doors use the catalog/OpenAPI-MCP mechanism, not an /sse backend,
  // and are unaffected.
  seedBuiltIn(PRIVILEGE_OPENSEARCH_PROFILE_ID, {
    label: 'Privilege: OpenSearch',
    transport: 'privilege',
    url: `${PRIVILEGE_GATEWAY_BASE}/opensearch22/mcp`,
    isDefault: false,
  });
  seedBuiltIn(PRIVILEGE_BRAVE_PROFILE_ID, {
    label: 'Privilege: Brave Search',
    transport: 'privilege',
    url: `${PRIVILEGE_GATEWAY_BASE}/mcp-brave-search/mcp`,
    isDefault: false,
  });
  seedBuiltIn(PRIVILEGE_GRAFANA_PROFILE_ID, {
    label: 'Privilege: Grafana',
    transport: 'privilege',
    url: `${PRIVILEGE_GATEWAY_BASE}/mcp-grafana/mcp`,
    isDefault: false,
  });
}

/** Strip secret fields; callers use this for anything that reaches the browser. */
function maskProfile(record) {
  const { authValue, env, ...rest } = record;
  return {
    ...rest,
    hasAuthValue: !!authValue,
    envKeys: env ? Object.keys(env) : [],
  };
}

function listProfiles() {
  ensureBuiltInsSeeded();
  return lmdb
    .loadProfiles()
    .map(([, record]) => maskProfile(record))
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
}

/** Full record including secrets — server-side use only (mcpInspector.js dispatch). */
function getProfile(id) {
  ensureBuiltInsSeeded();
  return lmdb.getProfile(id);
}

function createProfile({ label, transport, url, authHeader, authValue, command, args, env }) {
  if (transport === 'pingone') {
    throw new Error('the pingone transport is reserved for the built-in PingOne MCP profile');
  }
  if (transport === 'privilege') {
    throw new Error('the privilege transport is reserved for the built-in Privilege MCP profile');
  }
  if (!TRANSPORTS.has(transport)) {
    throw new Error(`transport must be one of: ${[...TRANSPORTS].join(', ')}`);
  }
  if ((transport === 'websocket' || transport === 'http') && !String(url || '').trim()) {
    throw new Error('url is required for websocket/http transport');
  }
  if (transport === 'stdio' && !String(command || '').trim()) {
    throw new Error('command is required for stdio transport');
  }

  const id = crypto.randomUUID();
  const record = {
    id,
    label: String(label || '').trim() || `${transport} server`,
    transport,
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
  if (transport === 'websocket' || transport === 'http') {
    record.url = String(url).trim();
    if (String(authHeader || '').trim() && String(authValue || '').trim()) {
      record.authHeader = String(authHeader).trim();
      record.authValue = String(authValue).trim();
    }
  } else {
    record.command = String(command).trim();
    record.args = Array.isArray(args) ? args.map(String) : [];
    record.env = env && typeof env === 'object' ? env : {};
  }

  lmdb.saveProfile(id, record);
  return maskProfile(record);
}

function deleteProfile(id) {
  if (BUILTIN_PROFILE_IDS.has(id)) {
    const err = new Error('built-in profiles cannot be deleted');
    err.code = 'default_profile_protected';
    throw err;
  }
  ensureBuiltInsSeeded();
  if (!lmdb.getProfile(id)) {
    const err = new Error(`no MCP server profile "${id}"`);
    err.code = 'profile_not_found';
    throw err;
  }
  lmdb.deleteProfile(id);
}

module.exports = {
  DEFAULT_PROFILE_ID,
  PINGONE_PROFILE_ID,
  PRIVILEGE_PROFILE_ID,
  PRIVILEGE_OPENSEARCH_PROFILE_ID,
  PRIVILEGE_BRAVE_PROFILE_ID,
  PRIVILEGE_GRAFANA_PROFILE_ID,
  listProfiles,
  getProfile,
  createProfile,
  deleteProfile,
};
