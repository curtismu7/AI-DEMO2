/**
 * startupConfigGuard.js — boot-time validation that the URLs and OAuth resource
 * audiences this BFF will actually use match the source-of-truth manifests
 * (service-topology.json for addressing, scope-topology.json for audiences).
 *
 * Why: a stale/misconfigured gateway URL or a resource-URI that doesn't match
 * the scope-topology audience used to surface only at the first request — as
 * `ECONNREFUSED :3005` or a silent prod 401. This catches both at startup.
 *
 * Behaviour: by default any mismatch is FATAL (process.exit(1)) so a broken
 * config fails loudly at boot instead of half-serving. Set
 * TOPOLOGY_GUARD=warn to downgrade to a warning (e.g. for an intentional
 * experiment). Checks only keys that are actually set — unset is not a mismatch.
 */

const fs = require('node:fs');
const path = require('node:path');
const scopeTopology = require('./scopeTopology');

const ROOT = path.resolve(__dirname, '../../');
const SERVICE_TOPOLOGY_PATH = path.join(ROOT, 'service-topology.json');

// Service URLs whose PORT is the same in every environment (in-cluster service
// name vs local 127.0.0.1, but always the same port). These can be validated
// cross-environment; MCP_SERVER_URL is intentionally excluded because it routes
// to the MCP server (8080) in k8s but through the gateway (3005) locally.
const INVARIANT_URL_KEYS = {
  MCP_GATEWAY_HTTP_URL: 'mcp-gateway',
  DEMO_API_BASE_URL: 'bff',
  // HITL service: same port (3009) in every environment — in-cluster
  // hitl-service:3009 vs local localhost:3009. A wrong port here means every
  // transfer consent challenge silently fails to reach the HITL service.
  HITL_SERVICE_URL: 'hitl-service',
};

// PingOne resource-URI env vars -> the scope-topology audience role they must equal.
const RESOURCE_URI_KEYS = {
  // Forward-unchanged contract: the gateway forwards the inbound bearer to the
  // MCP server WITHOUT re-exchange (demo_mcp_gateway authorizeMcpRequest.ts
  // Step 4; GatewayTokenPolicy D-05 even forbids a downstream MCP-server aud in
  // the inbound token). So the MCP server validates the SAME audience the
  // gateway forwards — the *gateway* audience, never a separate mcpServer one.
  // This was the drift that 401'd every agent tool call with "aud validation
  // failed" (token_aud=mcpgateway.ping.demo, expected=mcpserver.ping.demo): the
  // key used to map to 'mcpServer', so the guard validated internal SoT
  // consistency instead of the cross-service runtime contract and passed the
  // broken config. If a future design reintroduces a gateway->server
  // re-exchange (hop #3), flip this back to 'mcpServer' together with that code.
  MCP_SERVER_RESOURCE_URI: 'mcpGateway',
  MCP_RESOURCE_URI: 'mcpGateway',
  MCP_GW_RESOURCE_URI: 'mcpGateway',
  PINGONE_RESOURCE_MCP_GATEWAY_URI: 'mcpGateway',
  PINGONE_RESOURCE_AGENT_GATEWAY_URI: 'agentGateway',
  // Two-exchange final audience: the BFF requests this in RFC 8693 exchange #2, so it
  // MUST equal the gateway audience (service-topology derives it as aud:mcpGateway).
  PINGONE_RESOURCE_TWO_EXCHANGE_URI: 'mcpGateway',
  // A2A chained-exchange intermediate audience (Exchange #1 result).
  PINGONE_RESOURCE_A2A_INTERMEDIATE_URI: 'a2aIntermediate',
};

function effective(key) {
  // process.env first (what the pod was handed), then configStore default.
  // configStore is required lazily and best-effort: the guard must still run
  // (validating process.env) even if configStore can't initialise.
  if (process.env[key] != null && process.env[key] !== '') return process.env[key];
  try { return require('./configStore').getEffective(key) || ''; } catch { return ''; }
}

/** Collect config issues (empty array = all good). Throws only on unreadable SoT. */
function collectIssues() {
  const issues = [];

  const topo = JSON.parse(fs.readFileSync(SERVICE_TOPOLOGY_PATH, 'utf8'));
  for (const [key, svcName] of Object.entries(INVARIANT_URL_KEYS)) {
    const val = effective(key);
    if (!val) continue;
    const expected = topo.services?.[svcName]?.port;
    const got = (val.match(/:(\d+)/) || [])[1];
    if (expected && got && got !== String(expected)) {
      issues.push(`${key}="${val}" targets port ${got}, but service-topology.json puts ${svcName} on ${expected}`);
    }
  }

  const aud = scopeTopology.audiences(); // { enduser, agentGateway, mcpServer, mcpGateway }
  for (const [key, role] of Object.entries(RESOURCE_URI_KEYS)) {
    const val = effective(key);
    if (!val) continue;
    if (aud[role] && val !== aud[role]) {
      issues.push(`${key}="${val}" but scope-topology.json audience for ${role} is "${aud[role]}" (token validation would 401)`);
    }
  }

  // JWKS endpoint invariant. Agent token signatures are verified against PingOne's
  // OIDC JWKS, which lives on the AUTH host (auth.pingone.com/<env>/as/jwks). The
  // resolver (demo_mcp_server/src/auth/jwks.ts) falls back to PINGONE_BASE_URL +
  // /jwks when PINGONE_JWKS_URI / PINGONE_ISSUER are unset — but PINGONE_BASE_URL is
  // the MANAGEMENT API host (api.pingone.com/v1/environments/<env>), whose /jwks
  // returns 403. That makes every agent token signature check fail → 401 → the user
  // is logged out on the first agent prompt (a sibling of the aud-drift bug above;
  // the live configmap reverts this on redeploy). Flag a JWKS URL that resolves to
  // the management host.
  const jwksUri =
    effective('PINGONE_JWKS_URI') ||
    (effective('PINGONE_ISSUER') ? `${effective('PINGONE_ISSUER').replace(/\/+$/, '')}/jwks` : '') ||
    (effective('PINGONE_BASE_URL') ? `${effective('PINGONE_BASE_URL').replace(/\/+$/, '')}/jwks` : '');
  if (jwksUri && (/\/v1\/environments\//.test(jwksUri) || /(^|\/\/)api\.pingone\.com\b/.test(jwksUri))) {
    issues.push(
      `JWKS resolves to the Management API host ("${jwksUri}") — its /jwks returns 403, so every agent token ` +
      `signature check fails (401 → forced logout). Set PINGONE_JWKS_URI to the AUTH host OIDC JWKS ` +
      `(e.g. https://auth.pingone.com/<env>/as/jwks).`,
    );
  }

  return issues;
}

/**
 * Run the guard. Logs a one-line OK, or reports issues and (by default) exits.
 * Never throws to the caller — a guard bug must not take down boot silently;
 * it logs and continues.
 */
// Advisory (never fatal): authorize_mode now defaults to 'pingone' (real PingOne
// Authorize, fail-closed). If PingOne Authorize is not configured, every transaction
// will fail closed with a 503 — warn loudly at boot so a deny-all is never a mystery.
// Deployments that intend to run the demo engine must store authorize_mode='simulated'.
function warnIfAuthorizeModeUnconfigured() {
  try {
    const configStore = require('./configStore');
    const { resolveAuthorizeMode } = require('./simulatedAuthorizeService');
    const { isConfigured } = require('./pingOneAuthorizeService');
    const { mode } = resolveAuthorizeMode(configStore);
    if ((mode === 'pingone' || mode === 'pingone_fallback_simulated') && !isConfigured()) {
      const consequence = mode === 'pingone'
        ? 'transactions will FAIL CLOSED (503) until it is configured'
        : 'transactions will fall back to the simulated/demo engine';
      console.warn(
        `[STARTUP GUARD] authorize_mode='${mode}' but PingOne Authorize is not configured — ${consequence}.\n` +
        `  Set the Authorize worker credentials + decision endpoint, or store authorize_mode='simulated' to use the demo engine.`);
    }
  } catch (err) {
    console.warn(`[STARTUP GUARD] authorize_mode check skipped: ${err.message}`);
  }
}

function clearRedirectUrisFromConfigStore() {
  try {
    const cs = require('./configStore');
    const keys = ['admin_redirect_uri', 'user_redirect_uri'];
    for (const key of keys) {
      const val = cs.getEffective(key);
      if (val) {
        delete cs._cache[String(key).toUpperCase()];
        console.log(`[STARTUP] Cleared stale configStore ${key} — will use environment variables`);
      }
    }
  } catch (err) {
    console.warn(`[STARTUP] Could not clear redirect URIs: ${err.message}`);
  }
}

function runStartupConfigGuard() {
  clearRedirectUrisFromConfigStore();
  warnIfAuthorizeModeUnconfigured();
  let issues;
  try {
    issues = collectIssues();
  } catch (err) {
    console.warn(`[STARTUP GUARD] skipped — could not load source of truth: ${err.message}`);
    return;
  }

  if (issues.length === 0) {
    console.log('[STARTUP GUARD] OK — service URLs + resource audiences match the source of truth.');
    return;
  }

  const report = `[STARTUP GUARD] ${issues.length} config issue(s) vs source of truth:\n  - ${issues.join('\n  - ')}`;
  if (String(process.env.TOPOLOGY_GUARD || '').toLowerCase() === 'warn') {
    console.warn(`[WARN] ${report}\n  (TOPOLOGY_GUARD=warn — continuing anyway)`);
    return;
  }
  console.error(`[FATAL] ${report}\n  Fix the config to match service-topology.json / scope-topology.json, or set TOPOLOGY_GUARD=warn to override.`);
  process.exit(1);
}

module.exports = { runStartupConfigGuard, collectIssues, warnIfAuthorizeModeUnconfigured };
