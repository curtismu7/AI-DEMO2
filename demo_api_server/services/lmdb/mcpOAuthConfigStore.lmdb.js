'use strict';
/**
 * mcpOAuthConfigStore.lmdb.js — LMDB persistence for the illustrative
 * MCP OAuth config admin page (services/mcpOAuthConfigStore.js).
 *
 * Key layout (single LMDB DB named 'mcp_oauth_config'): id -> full record
 * (includes clientSecret; services/mcpOAuthConfigStore.js is the only caller
 * allowed to hand the secret back to a route).
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'mcp_oauth_config';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function getConfig(id) { return _db().get(id) || null; }
function saveConfig(id, record) { _db().putSync(id, record); }
function deleteConfig(id) { _db().removeSync(id); }

module.exports = { getConfig, saveConfig, deleteConfig };
