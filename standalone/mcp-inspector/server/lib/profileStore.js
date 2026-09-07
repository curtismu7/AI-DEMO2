'use strict';
/**
 * profileStore.js — saved MCP server profiles ("point this tool at another
 * MCP server"): websocket/http need a url, stdio needs a local command.
 * Persisted as a flat JSON file under ~/.mcp-inspector (or PROFILE_STORE_DIR)
 * rather than a database — this is a local single-user dev tool.
 *
 * Secrets (authValue, env values) are stored on disk but never returned by
 * listProfiles()/createProfile(); callers needing them for an actual MCP call
 * use getProfile() server-side only.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STORE_DIR = process.env.PROFILE_STORE_DIR || path.join(os.homedir(), '.mcp-inspector');
const STORE_FILE = path.join(STORE_DIR, 'profiles.json');
const TRANSPORTS = new Set(['websocket', 'http', 'stdio']);

function load() {
  try {
    const text = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function save(all) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
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
  return Object.values(load()).map(maskProfile);
}

/** Full record including secrets — server-side use only. */
function getProfile(id) {
  return load()[id] || null;
}

function createProfile({ label, transport, url, authHeader, authValue, command, args, env }) {
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

  const all = load();
  all[id] = record;
  save(all);
  return maskProfile(record);
}

function deleteProfile(id) {
  const all = load();
  if (!all[id]) {
    const err = new Error(`no MCP server profile "${id}"`);
    err.code = 'profile_not_found';
    throw err;
  }
  delete all[id];
  save(all);
}

module.exports = { listProfiles, getProfile, createProfile, deleteProfile, STORE_FILE };
