'use strict';
/**
 * mcpProfileStore.js — saved MCP server profiles for the Generic MCP Inspector
 * (/mcp-inspector). A profile is "point this page at another MCP server":
 * websocket/http need a url, stdio needs a local command. Two built-in
 * profiles are seeded once and protected from deletion: DEFAULT_PROFILE_ID
 * (this app's own banking MCP server — routes/mcpInspector.js keeps its
 * existing session-bearer / RFC 8693 / local-catalog-fallback behavior
 * untouched for it), PINGONE_PROFILE_ID (the hosted PingOne MCP server,
 * authenticated via routes/mcpPingOneAdminAuth.js's admin login rather than a
 * stored secret), and PRIVILEGE_PROFILE_ID (the external Privilege Cloud MCP
 * gateway, authenticated via routes/mcpPrivilegeAuth.js's admin login). Any
 * other profile dispatches through mcpTransports/*.
 *
 * Secrets (authValue, env values) are persisted in LMDB but never returned by
 * listProfiles()/createProfile() — callers needing them for an actual MCP call
 * use getProfile() server-side only.
 */
const crypto = require('crypto');
const lmdb = require('./lmdb/mcpProfileStore.lmdb');

const DEFAULT_PROFILE_ID = 'default-banking';
const PINGONE_PROFILE_ID = 'built-in-pingone-mcp';
const PRIVILEGE_PROFILE_ID = 'built-in-privilege-mcp';
// 'pingone' and 'privilege' are reserved built-in transports —
// createProfile() (the public POST /profiles path) never accepts them; only
// ensureBuiltInsSeeded() writes them.
const TRANSPORTS = new Set(['websocket', 'http', 'stdio']);

function ensureBuiltInsSeeded() {
  if (!lmdb.getProfile(DEFAULT_PROFILE_ID)) {
    lmdb.saveProfile(DEFAULT_PROFILE_ID, {
      id: DEFAULT_PROFILE_ID,
      label: 'AIDemo MCP (this app)',
      transport: 'websocket',
      isDefault: true,
      isBuiltIn: true,
      createdAt: new Date().toISOString(),
    });
  }
  if (!lmdb.getProfile(PINGONE_PROFILE_ID)) {
    lmdb.saveProfile(PINGONE_PROFILE_ID, {
      id: PINGONE_PROFILE_ID,
      label: 'PingOne MCP (admin)',
      transport: 'pingone',
      isDefault: false,
      isBuiltIn: true,
      createdAt: new Date().toISOString(),
    });
  }
  if (!lmdb.getProfile(PRIVILEGE_PROFILE_ID)) {
    lmdb.saveProfile(PRIVILEGE_PROFILE_ID, {
      id: PRIVILEGE_PROFILE_ID,
      label: 'Privilege MCP (admin)',
      transport: 'privilege',
      isDefault: false,
      isBuiltIn: true,
      createdAt: new Date().toISOString(),
    });
  }
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
  if (id === DEFAULT_PROFILE_ID || id === PINGONE_PROFILE_ID || id === PRIVILEGE_PROFILE_ID) {
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
  listProfiles,
  getProfile,
  createProfile,
  deleteProfile,
};
