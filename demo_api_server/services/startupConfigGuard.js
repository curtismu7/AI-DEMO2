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
  // Gateway->backend re-exchange contract: the gateway performs an RFC 8693
  // exchange (Step 4, demo_mcp_gateway authorizeMcpRequest.ts) to mint a
  // next-hop token scoped to the backend MCP-server audience (olb or invest)
  // before forwarding — it does NOT forward the inbound gateway-audience
  // bearer unchanged. So the MCP server validates the mcpServer audience,
  // not the gateway one.
  //
  // MCP_SERVER_RESOURCE_URI (and its alias MCP_RESOURCE_URI, per configStore's
  // mcp_resource_uri fallback chain — see configStore.js) is list-valued to
  // support a rollout window: it MUST contain the mcpServer audience (that's
  // what the MCP server checks tokens against), and MAY also carry the
  // mcpGateway audience as an optional/transitional entry for deployments
  // still mid-migration off the old forward-unchanged contract. Only the
  // mcpServer entry is required; an absent mcpGateway entry is not flagged.
  MCP_SERVER_RESOURCE_URI: 'mcpServer',
  // Alias of MCP_SERVER_RESOURCE_URI (see configStore.js envFallbackMap
  // 'mcp_resource_uri': ['PINGONE_RESOURCE_MCP_SERVER_URI', 'MCP_SERVER_RESOURCE_URI',
  // 'MCP_RESOURCE_URI']) — effective() can resolve MCP_RESOURCE_URI to the SAME
  // comma-list value as MCP_SERVER_RESOURCE_URI. Must use the identical
  // list-containment rule (role 'mcpServer' + LIST_VALUED_KEYS below) or this
  // false-positives on every deployment that only sets MCP_SERVER_RESOURCE_URI.
  MCP_RESOURCE_URI: 'mcpServer',
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
  const usePingGateway = (() => {
    const v = effective('ff_mcp_gateway_pinggateway');
    return v === true || v === 'true';
  })();
  for (const [key, svcName] of Object.entries(INVARIANT_URL_KEYS)) {
    const val = effective(key);
    if (!val) continue;
    // PingGateway mode routes MCP_GATEWAY_HTTP_URL at ping-gateway:8080, not mcp-gateway:3005.
    const resolvedSvc =
      key === 'MCP_GATEWAY_HTTP_URL' && usePingGateway ? 'ping-gateway' : svcName;
    const expected = topo.services?.[resolvedSvc]?.port;
    const got = (val.match(/:(\d+)/) || [])[1];
    if (expected && got && got !== String(expected)) {
      issues.push(`${key}="${val}" targets port ${got}, but service-topology.json puts ${resolvedSvc} on ${expected}`);
    }
  }

  const aud = scopeTopology.audiences(); // { enduser, agentGateway, mcpServer, mcpGateway }
  // MCP_SERVER_RESOURCE_URI and its alias MCP_RESOURCE_URI legitimately carry a
  // comma-separated accepted-audience list (RFC 8693 exchange rollout — e.g.
  // "mcpserver.ping.demo,mcpgateway.ping.demo"); both resolve to the mcpServer
  // role and are checked for list-containment rather than strict equality (see
  // RESOURCE_URI_KEYS comment above).
  //
  // MCP_GW_RESOURCE_URI is list-valued for the same reason: the real gateway
  // (tokenValidator.ts) and the mock authz server (decision.js) both accept a
  // comma-separated audience list, and docker-compose.yml APPENDS the A2A
  // gateway audience to it (pingoneProvisionService.js gives A2A its own
  // audience so the nested-`act` composer only fires on A2A calls). The live
  // value is "mcpgateway.ping.demo,https://api.ping.demo:3036/mcp,
  // mcpgateway-a2a.ping.demo" — strict equality against the single mcpGateway
  // audience made this warn on every boot, which is a false positive, not drift.
  //
  // Every other key keeps strict equality — notably
  // PINGONE_RESOURCE_TWO_EXCHANGE_URI, which per its own comment MUST equal the
  // gateway audience, and PINGONE_RESOURCE_MCP_GATEWAY_URI, which is single-valued.
  const LIST_VALUED_KEYS = new Set([
    'MCP_SERVER_RESOURCE_URI',
    'MCP_RESOURCE_URI',
    'MCP_GW_RESOURCE_URI',
  ]);
  for (const [key, role] of Object.entries(RESOURCE_URI_KEYS)) {
    const val = effective(key);
    if (!val) continue;
    if (LIST_VALUED_KEYS.has(key)) {
      const valList = val.split(',').map((s) => s.trim()).filter(Boolean);
      if (aud[role] && !valList.includes(aud[role])) {
        issues.push(`${key}="${val}" but scope-topology.json audience for ${role} is "${aud[role]}" (token validation would 401)`);
      }
    } else if (aud[role] && val !== aud[role]) {
      issues.push(`${key}="${val}" but scope-topology.json audience for ${role} is "${aud[role]}" (token validation would 401)`);
    }
  }

  // JWKS endpoint invariant. Agent token signatures are verified against PingOne's
  // OIDC JWKS, which lives on the AUTH host (auth.pingone.com/<env>/as/jwks). The
  // resolver (oauth-mcp/src/auth/jwks.ts) falls back to PINGONE_BASE_URL +
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

  // Token endpoint host invariant. PingOne's /token lives on the AUTH host
  // (auth.pingone.com/<env>/as/token). The Management API host (api.pingone.com)
  // returns 403 on /token. A stale or wrong OAUTH_TOKEN_ENDPOINT isn't caught until
  // the first OAuth flow, which surfaces as a generic 403 with no config pointer.
  const tokenEndpoint =
    effective('OAUTH_TOKEN_ENDPOINT') ||
    effective('oauth_token_endpoint');
  if (tokenEndpoint && ((/\/v1\/environments\//).test(tokenEndpoint) || (/(^|\/\/)api\.pingone\.com\b/).test(tokenEndpoint))) {
    issues.push(
      `OAUTH_TOKEN_ENDPOINT="${tokenEndpoint}" resolves to the Management API host — it returns 403 on ` +
      `/token, so every login and token-exchange fails. Set OAUTH_TOKEN_ENDPOINT to the AUTH host ` +
      `(e.g. https://auth.pingone.com/<env>/as/token).`,
    );
  }

  // MCP Gateway audience presence. The RFC 8693 token exchange requests a token
  // with audience = MCP_GW_RESOURCE_URI. An unset value passes through as empty
  // string — PingOne either rejects the exchange or issues a token with no audience,
  // and the gateway returns 401. This is only caught at the first tool call without
  // this check.
  const mcpGwAudience =
    effective('PINGONE_RESOURCE_MCP_GATEWAY_URI') ||
    effective('MCP_GW_RESOURCE_URI') ||
    effective('MCP_RESOURCE_URI') ||
    effective('MCP_SERVER_RESOURCE_URI');
  if (!mcpGwAudience) {
    issues.push(
      `MCP gateway audience is not set — token exchange will fail on every agent tool call. ` +
      `Set MCP_GW_RESOURCE_URI (or PINGONE_RESOURCE_MCP_GATEWAY_URI) to the gateway resource URI ` +
      `registered in PingOne (e.g. https://mcpgateway.ping.demo).`,
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

// Advisory (never fatal): ff_authorize_fail_open is checked FIRST in every branch
// of resolveAuthorizeMode, so it forces failover_mode=permit even when a
// deployment has explicitly stored the strict authorize_mode='pingone'. An
// operator who turned it on for one demo has disabled the failover policy on
// every authorize path, and nothing else says so at boot — the per-request
// fail-open logs only appear once PingOne is already failing.
function warnIfAuthorizeFailOpen() {
  try {
    const configStore = require('./configStore');
    if (configStore.getEffective('ff_authorize_fail_open') !== 'true') return;
    const { resolveAuthorizeMode } = require('./simulatedAuthorizeService');
    const { mode } = resolveAuthorizeMode(configStore);
    console.warn(
      `[STARTUP GUARD] ff_authorize_fail_open=true — every authorize path FAILS OPEN.\n` +
      `  Transactions, MCP tools and agent restrictions are all permitted when PingOne Authorize errors,` +
      ` overriding authorize_mode='${mode}'.\n` +
      `  Set ff_authorize_fail_open=false to honour authorize_mode, or authorize_mode='pingone_fallback_simulated'` +
      ` to keep evaluating with the demo engine during an outage.`);
  } catch (err) {
    console.warn(`[STARTUP GUARD] ff_authorize_fail_open check skipped: ${err.message}`);
  }
}

// Advisory (never fatal): the working Privilege MCP config lives in the RUNNING
// container (env is frozen at create time), so a stale root .env silently
// regresses it on the next `compose up`. Catch the two smoking guns of that
// regression at boot so a broken recreate is loud, not a mystery 401.
// See privilege/PRIVILEGE-MCP.md + REGRESSION_PLAN §4 (2026-08-10).
function warnIfPrivilegeConfigRegressed() {
  try {
    const gwUrl = process.env.PRIVILEGE_MCPGW_URL || '';
    const ssoEnv = process.env.PRIVILEGE_SSO_ENV_ID || '';
    const bankingEnv = process.env.PINGONE_ENVIRONMENT_ID || '';
    // Only relevant when a Privilege gateway is wired at all.
    if (!gwUrl && !ssoEnv) return;

    // 1) The dangerous one: Privilege SSO must be its OWN tenant, never the banking
    //    environment. The gateway rejects a token whose issuer is the banking env,
    //    so pointing SSO there breaks console-token sign-in entirely.
    if (ssoEnv && bankingEnv && ssoEnv === bankingEnv) {
      console.warn(
        `[STARTUP GUARD] PRIVILEGE_SSO_ENV_ID (${ssoEnv}) == PINGONE_ENVIRONMENT_ID — the Privilege gateway REJECTS the banking env's issuer.\n` +
        '  This is the stale-.env regression: PRIVILEGE_SSO_ENV_ID must be the Privilege tenant, not the banking env. Sign-in will fail.');
    }

    // 2) Known-dead gateway host: banking.mcpgw... does not resolve in-container and
    //    is not in the mcpgw nginx rewrite map; only mcp-pingone-admin.mcpgw... is wired.
    let host = '';
    try { host = new URL(gwUrl).host; } catch { /* gwUrl not a URL */ }
    if (host === 'banking.mcpgw.local.ping-devops.com') {
      console.warn(
        `[STARTUP GUARD] PRIVILEGE_MCPGW_URL host '${host}' does not resolve and is not in the mcpgw nginx rewrite map — the Privilege page's default target is dead.\n` +
        '  Expected https://mcp-pingone-admin.mcpgw.local.ping-devops.com/mcp (what the console-token path uses).');
    }
  } catch (err) {
    console.warn(`[STARTUP GUARD] Privilege config check skipped: ${err.message}`);
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
  warnIfAuthorizeFailOpen();
  warnIfPrivilegeConfigRegressed();
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

module.exports = { runStartupConfigGuard, collectIssues, warnIfAuthorizeModeUnconfigured, warnIfAuthorizeFailOpen, warnIfPrivilegeConfigRegressed };
