#!/usr/bin/env node
// banking_api_server/scripts/mint-gateway-token.js
/**
 * B3 "dev-token stage prop" — teaching spec
 * docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md (§4a).
 *
 * Mints a REAL PingOne RFC 8693 token whose audience is the MCP Gateway
 * (the same audience the BFF's resolveExchangeAudience() targets), then
 * prints copy-pasteable ChatGPT Responses API and Claude `mcp_connector`
 * request snippets so a talk can demonstrate:
 *
 *   "The agent changed (now ChatGPT/Claude drives). The gateway's
 *    PingAuthorize engine + D-05 anti-bypass + RFC 8693 re-exchange
 *    still fire — but the per-tool narrowed exchange and the `act`
 *    delegation claim that light up the Token Chain panel are GONE,
 *    because the third party, not the BFF, is the caller."
 *
 * This is a STAGE PROP, deliberately NON-REPRESENTATIVE of production:
 *   - one broad gateway-audience token, hand-pasted (no per-call mint)
 *   - no actor_token  → no `act` claim
 *   - no per-tool scope narrowing
 * It mints nothing the BFF could not already mint; it changes no token
 * custody (REGRESSION_PLAN §1) — it only formats an existing exchange
 * for a third-party agent and labels the loss.
 *
 * Uses real tokens only — no mocks. Never prints a full subject JWT
 * (preview + decoded claims only); the minted gateway token IS printed
 * in full because pasting it into ChatGPT/Claude is the whole point —
 * this is a dev script, run against a dev environment.
 *
 * Usage (from banking_api_server):
 *   node scripts/mint-gateway-token.js
 *   node scripts/mint-gateway-token.js --json
 *   node scripts/mint-gateway-token.js --help
 *
 * Required:
 *   INTEGRATION_SUBJECT_ACCESS_TOKEN — real user access_token JWT (post-login)
 *   Same PingOne/BFF env as the server (PINGONE_ENVIRONMENT_ID,
 *   PINGONE_ADMIN_CLIENT_ID/SECRET, PINGONE_RESOURCE_MCP_GATEWAY_URI, …)
 *
 * Optional:
 *   GATEWAY_TOKEN_SCOPES   — space-separated (default: mcp:invoke;
 *                            the gateway resource server intentionally
 *                            carries only this on a clean topology — see
 *                            REGRESSION_PLAN §1 single-resource note)
 *   GATEWAY_PUBLIC_URL     — gateway base URL for the printed snippets
 *                            (default: http://localhost:3005)
 */

'use strict';

require('dotenv').config();

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
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function printClaims(label, payload) {
  if (!payload) {
    console.log(`  ${label}: (not a JWT or parse failed)`);
    return;
  }
  console.log(`  ${label}:`, JSON.stringify({
    sub: payload.sub,
    aud: payload.aud,
    scope: payload.scope,
    iss: payload.iss,
    exp: payload.exp,
    act: payload.act,
  }, null, 2));
}

function helpText() {
  return `
mint-gateway-token.js — B3 dev-token stage prop (no mocks).

  node scripts/mint-gateway-token.js
    Mints a real gateway-audience RFC 8693 token + prints ChatGPT /
    Claude request snippets. Needs INTEGRATION_SUBJECT_ACCESS_TOKEN +
    full BFF/PingOne config.

  node scripts/mint-gateway-token.js --json
    Emits a single JSON object { token, audience, scopes, expiresHint }
    for scripting; no snippets.

  Env: GATEWAY_TOKEN_SCOPES (default "mcp:invoke"),
       GATEWAY_PUBLIC_URL  (default http://localhost:3005)

This is a STAGE PROP: one broad token, no actor/act, no per-tool
exchange. The gateway still enforces PingAuthorize + D-05. See
docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md.
`;
}

function printSnippets(gatewayUrl, token) {
  const mcpUrl = `${gatewayUrl.replace(/\/$/, '')}/mcp`;

  console.log('\n=== ChatGPT — Responses API (remote MCP tool) ===');
  console.log(`OpenAI does NOT store the authorization value — it must be re-sent
on every Responses API request. This token is one broad gateway-aud
bearer; there is no per-tool narrowing and no \`act\` claim.\n`);
  console.log(JSON.stringify({
    model: 'gpt-4o',
    tools: [{
      type: 'mcp',
      server_label: 'super-banking-gateway',
      server_url: mcpUrl,
      authorization: token,
    }],
    input: 'List my accounts.',
  }, null, 2));

  console.log('\n=== Claude — Messages API (mcp_connector) ===');
  console.log(`Mechanically symmetric to ChatGPT: same gateway, same loss profile
(no per-tool exchange, no \`act\`). The Claude.ai *connector* path is
the qualitatively different one (Anthropic custodies + refreshes the
token) — that is Option C, not this prop.\n`);
  console.log(JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    mcp_servers: [{
      type: 'url',
      url: mcpUrl,
      name: 'super-banking-gateway',
      authorization_token: token,
    }],
    messages: [{ role: 'user', content: 'List my accounts.' }],
  }, null, 2));

  console.log(`\n=== What the demo proves ===
The gateway still runs, in order: inbound aud check
(tokenValidator.ts) -> D-05 anti-bypass (GatewayTokenPolicy.ts) ->
PingAuthorize /decision per tools/call (PingOneAuthorizeClient.ts) ->
RFC 8693 re-exchange to the backend (credentialSwap.ts). The agent
swapped; the policy gate did NOT. What is gone is upstream of the
gateway: the BFF's per-tool narrowed exchange and the \`act\`
delegation claim — the Token Chain panel has nothing to show before
the gateway. That absence IS the lesson.`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(helpText());
    process.exit(0);
  }
  const asJson = argv.includes('--json');

  const subject = process.env.INTEGRATION_SUBJECT_ACCESS_TOKEN;
  if (!subject || !String(subject).trim()) {
    console.error('Set INTEGRATION_SUBJECT_ACCESS_TOKEN to a real user access_token JWT from PingOne (after login).');
    process.exit(1);
  }

  await configStore.ensureInitialized();

  // Same audience key the BFF's resolveExchangeAudience() uses for the
  // gateway path (agentMcpTokenService.js) — do not invent a new key.
  const gatewayAud = configStore.getEffective('pingone_resource_mcp_gateway_uri');
  const envId = configStore.getEffective('pingone_environment_id');
  const clientId = configStore.getEffective('admin_client_id');
  if (!gatewayAud) {
    console.error('pingone_resource_mcp_gateway_uri / PINGONE_RESOURCE_MCP_GATEWAY_URI is not set.');
    process.exit(1);
  }
  if (!envId || !clientId) {
    console.error('PingOne environment or admin client missing (PINGONE_ENVIRONMENT_ID, PINGONE_ADMIN_CLIENT_ID).');
    process.exit(1);
  }

  // Gateway resource server intentionally carries only mcp:invoke
  // on a clean topology (REGRESSION_PLAN §1 single-resource note).
  const scopes = (process.env.GATEWAY_TOKEN_SCOPES || 'mcp:invoke')
    .trim().split(/\s+/).filter(Boolean);
  const gatewayUrl = process.env.GATEWAY_PUBLIC_URL || 'http://localhost:3005';

  if (!asJson) {
    console.log('Mint gateway-audience token (RFC 8693) — B3 stage prop, live');
    console.log('  environment:', envId);
    console.log('  BFF client_id:', clientId);
    console.log('  audience (gateway):', gatewayAud);
    console.log('  scopes:', scopes.join(' '));
    console.log('  User token preview:', previewToken(subject));
    printClaims('User token', decodeJwtPayload(subject));
  }

  let token;
  try {
    // Reuse the exact production exchange helper — no bespoke flow.
    token = await oauthService.performTokenExchange(subject, gatewayAud, scopes);
  } catch (e) {
    console.error('performTokenExchange failed:', e.message);
    process.exit(1);
  }

  const claims = decodeJwtPayload(token);

  if (asJson) {
    console.log(JSON.stringify({
      token,
      audience: gatewayAud,
      scopes,
      expiresHint: claims && claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    }));
    return;
  }

  console.log('\nOK — PingOne returned a gateway-audience token.');
  console.log('  Gateway token preview:', previewToken(token));
  printClaims('Gateway token', claims);
  console.log('\n  Full token (paste into ChatGPT/Claude — dev environment only):');
  console.log('  ' + token);
  printSnippets(gatewayUrl, token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
