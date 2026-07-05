#!/usr/bin/env node
/**
 * smoke-pingone-mcp.js — end-to-end health check for the HOSTED PingOne MCP
 * server (the admin-plane MCP at api.pingone.{region}/v1/environments/{envId}/mcp,
 * NOT the repo's own banking MCP servers).
 *
 * Mints a worker client_credentials token and calls `tools/list`, exactly like
 * the BFF adapter (demo_api_server/services/mcpPingOneHttpAdapter.js): Bearer
 * auth, stateless JSON-RPC, answers may arrive as JSON or as a single SSE
 * frame. Exit 0 with a tool count on success; exit 1 with the failure reason.
 *
 * Needs live worker credentials — reads demo_api_server/.env (or the same
 * PINGONE_* vars from the environment). Run: npm run smoke:pingone-mcp
 * Deliberately NOT in CI (CI has no credentials).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadEnvFile(p) {
  const out = {};
  let txt;
  try {
    txt = fs.readFileSync(p, 'utf8');
  } catch {
    return out;
  }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(ROOT, 'demo_api_server', '.env'));
const cfg = (k) => process.env[k] || fileEnv[k] || '';

async function main() {
  const envId = cfg('PINGONE_ENVIRONMENT_ID');
  const region = cfg('PINGONE_REGION') || 'com';
  const clientId = cfg('PINGONE_WORKER_CLIENT_ID');
  const secret = cfg('PINGONE_WORKER_CLIENT_SECRET');

  if (!envId || !clientId || !secret) {
    console.error('✗ Missing PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET (env or demo_api_server/.env).');
    process.exit(1);
  }

  // 1. Worker token (client_credentials, basic auth — same as the BFF default)
  const tokenRes = await fetch(`https://auth.pingone.${region}/${envId}/as/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!tokenRes.ok) {
    console.error(`✗ Worker token mint failed (${tokenRes.status}): ${(await tokenRes.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const { access_token: token } = await tokenRes.json();

  // 2. tools/list against the hosted MCP endpoint
  const mcpUrl = `https://api.pingone.${region}/v1/environments/${envId}/mcp`;
  const mcpRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const bodyText = await mcpRes.text();
  if (!mcpRes.ok) {
    console.error(`✗ MCP tools/list failed (${mcpRes.status}): ${bodyText.slice(0, 300)}`);
    process.exit(1);
  }

  // Body may be plain JSON or a single SSE frame ("event: message\ndata: {...}")
  let payload = bodyText;
  if (/^\s*(event|data):/m.test(bodyText)) {
    const dataLines = bodyText.split('\n').filter((l) => l.startsWith('data:'));
    payload = dataLines.map((l) => l.slice(5).trim()).join('');
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (e) {
    console.error(`✗ Could not parse MCP response as JSON/SSE: ${e.message}\n${bodyText.slice(0, 300)}`);
    process.exit(1);
  }
  const tools = parsed?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    console.error(`✗ tools/list returned no tools array: ${JSON.stringify(parsed).slice(0, 300)}`);
    process.exit(1);
  }

  console.log(`✓ Hosted PingOne MCP healthy: ${tools.length} tools (env ${envId}, region ${region}).`);
  console.log('  Sample:', tools.slice(0, 5).map((t) => t.name).join(', '));
}

main().catch((err) => {
  console.error('✗ Smoke test error:', err.message);
  process.exit(1);
});
