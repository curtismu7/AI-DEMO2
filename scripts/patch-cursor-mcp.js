#!/usr/bin/env node
/**
 * patch-cursor-mcp.js — seed and patch project .cursor/mcp.json from bootstrap values.
 *
 * Reads demo_api_server/.env for PINGONE_ENVIRONMENT_ID, PINGONE_MCP_OAUTH_CLIENT_ID,
 * and PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID. Copies .cursor/mcp.json.example when missing,
 * then fills tenant-specific OAuth client ids and aligns banking-gateway scheme with run mode.
 *
 * Usage:
 *   node scripts/patch-cursor-mcp.js [repoRoot] [runMode]
 *   npm run patch:cursor-mcp
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const RUN_MODE = process.argv[3] || 'local';
const ENV_FILE = path.join(ROOT, 'demo_api_server', '.env');
const EXAMPLE = path.join(ROOT, '.cursor', 'mcp.json.example');
const TARGET = path.join(ROOT, '.cursor', 'mcp.json');

/** Parse KEY=VALUE lines from a dotenv file (no export syntax). */
function loadEnvFile(filePath) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/** Load JSON or return null when the file is missing or invalid. */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Merge example server entries that are missing from the live config. */
function mergeTemplateServers(config, template) {
  if (!template?.mcpServers) return config;
  config.mcpServers = config.mcpServers || {};
  for (const [name, entry] of Object.entries(template.mcpServers)) {
    if (!config.mcpServers[name]) {
      config.mcpServers[name] = JSON.parse(JSON.stringify(entry));
    }
  }
  return config;
}

function main() {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });

  const template = readJson(EXAMPLE);
  let config = readJson(TARGET);

  if (!config) {
    if (template) {
      fs.copyFileSync(EXAMPLE, TARGET);
      config = readJson(TARGET);
    } else {
      config = { mcpServers: {} };
    }
  }

  config = mergeTemplateServers(config, template);

  const fileEnv = loadEnvFile(ENV_FILE);
  const envId = process.env.PINGONE_ENVIRONMENT_ID || fileEnv.PINGONE_ENVIRONMENT_ID || '';
  const pingoneClient =
    process.env.PINGONE_MCP_OAUTH_CLIENT_ID || fileEnv.PINGONE_MCP_OAUTH_CLIENT_ID || '';
  const gatewayClient =
    process.env.PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID || fileEnv.PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID || '';

  if (envId && pingoneClient) {
    config.mcpServers.pingone = config.mcpServers.pingone || {};
    // URL format: single source of truth is getMcpUrl() in
    // demo_api_server/services/mcpPingOneHttpAdapter.js — inlined here because
    // this script is deliberately dependency-free (node builtins only).
    config.mcpServers.pingone.url = `https://mcp.pingone.com/admin/${envId}/mcp`;
    config.mcpServers.pingone.auth = config.mcpServers.pingone.auth || {};
    config.mcpServers.pingone.auth.CLIENT_ID = pingoneClient;
  }

  const scheme = RUN_MODE === 'local' ? 'https' : 'http';
  const gateway = config.mcpServers['banking-gateway'];
  if (gateway?.url) {
    gateway.url = gateway.url.replace(/^https?:/, `${scheme}:`);
    if (gatewayClient) {
      gateway.auth = gateway.auth || {};
      gateway.auth.CLIENT_ID = gatewayClient;
    }
  }

  fs.writeFileSync(TARGET, `${JSON.stringify(config, null, 2)}\n`);

  const patched = [];
  if (envId && pingoneClient) patched.push('pingone');
  if (gateway?.url) patched.push('banking-gateway');
  console.log(`✓ Patched ${TARGET}${patched.length ? ` (${patched.join(', ')})` : ''}`);
}

main();
