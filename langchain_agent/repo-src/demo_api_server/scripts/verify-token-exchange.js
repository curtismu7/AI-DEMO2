#!/usr/bin/env node
// banking_api_server/scripts/verify-token-exchange.js
/**
 * Live PingOne RFC 8693 token exchange + optional session chain check.
 * Uses real tokens only — no mocks. Does not print full JWTs (preview + decoded claims).
 *
 * Usage (from banking_api_server):
 *   node scripts/verify-token-exchange.js
 *   node scripts/verify-token-exchange.js --chain-only
 *   node scripts/verify-token-exchange.js --help
 *
 * Required for exchange path:
 *   INTEGRATION_SUBJECT_ACCESS_TOKEN — User token (user access token) JWT from a real login
 *   Same PingOne + Backend-for-Frontend (BFF) env as server: PINGONE_ENVIRONMENT_ID, PINGONE_ADMIN_CLIENT_ID,
 *   PINGONE_ADMIN_CLIENT_SECRET, MCP_SERVER_RESOURCE_URI, etc. (see env.example)
 *
 * Optional:
 *   VERIFY_TOKEN_EXCHANGE_WITH_ACTOR=true — also: client_credentials (agent) + subject+actor exchange
 *   MCP_TOKEN_EXCHANGE_SCOPES — space-separated scopes (default: read write)
 *   DEMO_API_BASE_URL — default http://localhost:3001
 *   SESSION_COOKIE — e.g. "connect.sid=s%3A..." ; if set, also GET /api/tokens/chain (server must be running)
 *
 * Chain-only:
 *   node scripts/verify-token-exchange.js --chain-only
 *   Requires SESSION_COOKIE and a running API; validates session storage + full token chain JSON.
 */

'use strict';

require('dotenv').config();

const axios = require('axios');
const configStore = require('../services/configStore');
const oauthService = require('../services/oauthService');

function previewToken(t) {
  if (!t || typeof t !== 'string') return '(none)';
  if (t.length < 24) return `${t}…`;
  return `${t.slice(0, 20)}…(${t.length} chars)`;
}

/** Decode JWT payload without verification (display / diagnostics only). */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function printChainSummary(chain) {
  for (const [k, v] of Object.entries(chain)) {
    const st = v.status || '?';
    const err = v.error ? ` — ${v.error}` : '';
    const sub = v.content?.payload?.sub || v.content?.token_preview || '';
    const bit = sub ? ` ${String(sub).slice(0, 48)}` : '';
    console.log(`  [${k}] ${st}${err}${bit}`);
  }
}

function printClaims(label, payload) {
  if (!payload) {
    console.log(`  ${label}: (not a JWT or parse failed)`);
    return;
  }
  const summary = {
    sub: payload.sub,
    aud: payload.aud,
    scope: payload.scope,
    iss: payload.iss,
    exp: payload.exp,
    act: payload.act,
    may_act: payload.may_act,
  };
  console.log(`  ${label}:`, JSON.stringify(summary, null, 2));
}

async function runChainOnly() {
  const baseUrl = (process.env.DEMO_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  const cookie = process.env.SESSION_COOKIE || '';
  if (!cookie.trim()) {
    console.error('For --chain-only: set SESSION_COOKIE (browser DevTools → Application → Cookie → copy connect.sid=…).');
    process.exit(1);
  }
  const url = `${baseUrl}/api/tokens/chain`;
  console.log(`GET ${url} (with session cookie)`);
  const res = await axios.get(url, {
    headers: { Cookie: cookie },
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    console.error('HTTP', res.status, res.data);
    process.exit(1);
  }
  console.log('Token chain (session + live exchange + MCP resolver):');
  printChainSummary(res.data);
  console.log('\nSession storage: access token lives in the Backend-for-Frontend (BFF) session as oauthTokens.accessToken (server-side).');
}

async function runExchangeAndOptionalActor() {
  const subject = process.env.INTEGRATION_SUBJECT_ACCESS_TOKEN;
  if (!subject || !String(subject).trim()) {
    console.error('Set INTEGRATION_SUBJECT_ACCESS_TOKEN to a real user access_token JWT from PingOne (after login).');
    process.exit(1);
  }

  await configStore.ensureInitialized();

  const mcpUri = configStore.getEffective('mcp_resource_uri');
  const envId = configStore.getEffective('pingone_environment_id');
  const clientId = configStore.getEffective('admin_client_id');
  if (!mcpUri) {
    console.error('mcp_resource_uri / MCP_SERVER_RESOURCE_URI is not set.');
    process.exit(1);
  }
  if (!envId || !clientId) {
    console.error('PingOne environment or admin client missing (PINGONE_ENVIRONMENT_ID, PINGONE_ADMIN_CLIENT_ID).');
    process.exit(1);
  }

  const scopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write').trim().split(/\s+/);

  console.log('PingOne token exchange (RFC 8693) — live verification');
  console.log('  environment:', envId);
  console.log('  Backend-for-Frontend (BFF) client_id:', clientId);
  console.log('  audience (mcp_resource_uri):', mcpUri);
  console.log('  scopes:', scopes.join(' '));
  console.log('  User token preview:', previewToken(subject));
  printClaims('User token', decodeJwtPayload(subject));

  let mcpToken;
  try {
    mcpToken = await oauthService.performTokenExchange(subject, mcpUri, scopes);
  } catch (e) {
    console.error('performTokenExchange failed:', e.message);
    process.exit(1);
  }

  console.log('\nOK — PingOne returned an MCP token (delegated token for MCP audience)');
  console.log('  MCP token preview:', previewToken(mcpToken));
  printClaims('MCP token', decodeJwtPayload(mcpToken));

  if (process.env.VERIFY_TOKEN_EXCHANGE_WITH_ACTOR === 'true') {
    console.log('\n--- Actor token + subject+actor exchange (optional) ---');
    try {
      const actor = await oauthService.getAgentClientCredentialsToken();
      console.log('  Actor token preview:', previewToken(actor));
      const t2a = await oauthService.performTokenExchangeWithActor(subject, actor, mcpUri, scopes);
      console.log('  T2 (with actor) preview:', previewToken(t2a));
      printClaims('T2+actor', decodeJwtPayload(t2a));
    } catch (e) {
      console.error('Actor path failed:', e.message);
      process.exit(1);
    }
  }

  const cookie = process.env.SESSION_COOKIE || '';
  if (cookie.trim()) {
    console.log('\n--- /api/tokens/chain (server must be running) ---');
    try {
      await runChainOnly();
    } catch (e) {
      console.error('Chain API failed:', e.response?.data || e.message);
      process.exit(1);
    }
  }

  console.log('\nDone. The MCP token is the real JWT the Backend-for-Frontend (BFF) sends to banking_mcp_server for tools/call when MCP_SERVER_RESOURCE_URI is set.');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
verify-token-exchange.js — real PingOne token exchange (no mocks).

  node scripts/verify-token-exchange.js
    Needs INTEGRATION_SUBJECT_ACCESS_TOKEN + full Backend-for-Frontend (BFF)/PingOne config.

  node scripts/verify-token-exchange.js --chain-only
    Needs SESSION_COOKIE; calls GET /api/tokens/chain on DEMO_API_BASE_URL.

  VERIFY_TOKEN_EXCHANGE_WITH_ACTOR=true — also test agent client_credentials + actor exchange.

See env.example (INTEGRATION_* / MCP_SERVER_RESOURCE_URI).
`);
    process.exit(0);
  }

  if (argv.includes('--chain-only')) {
    await runChainOnly();
    return;
  }

  await runExchangeAndOptionalActor();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
