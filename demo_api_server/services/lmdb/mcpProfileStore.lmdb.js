'use strict';
/**
 * mcpProfileStore.lmdb.js — LMDB persistence for generic MCP server profiles
 * (services/mcpProfileStore.js), the Generic MCP Inspector's saved server list.
 *
 * Key layout (single LMDB DB named 'mcp_profiles'):
 *   profile:<id> -> full profile record (incl. secret authValue/env values)
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'mcp_profiles';
const PREFIX = 'profile:';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

/** @returns {[id, record][]} */
function loadProfiles() {
  const out = [];
  for (const { key, value } of _db().getRange({ start: PREFIX })) {
    if (!key.startsWith(PREFIX)) break;
    out.push([key.slice(PREFIX.length), value]);
  }
  return out;
}

function getProfile(id) { return _db().get(`${PREFIX}${id}`) || null; }
function saveProfile(id, record) { _db().putSync(`${PREFIX}${id}`, record); }
function deleteProfile(id) { _db().removeSync(`${PREFIX}${id}`); }

module.exports = { loadProfiles, getProfile, saveProfile, deleteProfile };
