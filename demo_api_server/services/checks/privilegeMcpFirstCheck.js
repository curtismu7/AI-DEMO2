'use strict';

/**
 * Proves the Privilege-first MCP chain is actually usable, not merely configured.
 *
 * With ff_mcp_gateway_privilege_first ON, getMcpGatewayHttpUrl() sends EVERY MCP
 * tool call through the Privilege AI Gateway (mcpGatewayClient.js). That hop needs
 * a live Privilege gateway session, and that session lives in BFF memory — so a
 * restart, or an expiry nobody was watching, turns every tool call into an auth
 * failure that reads like a broken gateway. Plan §2.2 calls this the demo-killer:
 * the flag is on, the config is right, and nothing works because a human needs to
 * sign in.
 *
 * The three outcomes are deliberately different, because the remedy differs:
 *   warn — no session / expired  → a person signs in; nothing is broken
 *   fail — 403 from Privilege    → the Agentic App's policy is missing or expired
 *   pass — tools/list answers    → the whole chain is live, tool count as evidence
 *
 * Probe: authenticated MCP JSON-RPC `tools/list` POST to the same URL tool calls
 * use (getPrivilegeGatewayUrl, shared rather than copied).
 *
 * NOT reusing scripts/check-mcp-preflight.js's `probe()`, which the plan named:
 * that module calls main() unguarded at import time (no `require.main === module`),
 * so requiring it from the BFF would run the whole preflight and process.exit() the
 * server. Its probe() is also a bare GET returning {status}, not JSON-RPC.
 */

const { register } = require('./registry');
const privilegeGatewaySession = require('../privilegeGatewaySession');
const { getPrivilegeGatewayUrl } = require('../mcpGatewayClient');

const TIMEOUT_MS = 8000;

async function runPrivilegeMcpFirstCheck() {
  const url = getPrivilegeGatewayUrl();
  if (!url) {
    // getMcpGatewayHttpUrl() warns and falls through to the next lane here, so
    // the flag is on but Privilege is not in the path at all. Say that, rather
    // than dialling `undefined` and reporting a confusing network error.
    return {
      status: 'warn',
      detail: 'ff_mcp_gateway_privilege_first is ON but no MCP_PRIVILEGE_GATEWAY_URL (or MCP_FACADE_PRIVILEGE_GATEWAY_BASE) is set — tool calls fall through to the next lane.',
      nextAction: 'Set MCP_PRIVILEGE_GATEWAY_URL, or turn the flag off outside SE (plan D3: MCP-first is SE-only).',
    };
  }

  const session = privilegeGatewaySession.status();
  if (!session.ready) {
    return {
      status: 'warn',
      detail: session.reason === 'expired'
        ? 'the Privilege gateway session has expired and holds no refresh token'
        : 'no Privilege gateway session is held by this BFF',
      nextAction: 'Sign in to the Privilege gateway again — until then every MCP tool call on this flag fails as an auth error, not as a gateway fault.',
    };
  }

  const token = await privilegeGatewaySession.getAccessToken();
  if (!token) {
    return {
      status: 'warn',
      detail: 'the Privilege gateway session could not produce an access token (refresh failed)',
      nextAction: 'Sign in to the Privilege gateway again.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
  } catch (err) {
    const why = err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : (err.cause?.message || err.message);
    return { status: 'fail', detail: `Privilege gateway unreachable at ${url}: ${why}` };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 403) {
    return {
      status: 'fail',
      detail: 'Privilege policy missing or expired for app agent-gateway',
      nextAction: 'Privilege console → Agentic Apps → agent-gateway → check the policy is attached to this user and has not passed its time-box. An expired policy is a bare 403.',
    };
  }
  if (!res.ok) {
    return { status: 'fail', detail: `Privilege gateway answered ${res.status} to an authenticated tools/list at ${url}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    return { status: 'fail', detail: `Privilege gateway answered 200 but not JSON-RPC at ${url}` };
  }
  if (parsed.error) {
    return { status: 'fail', detail: `tools/list returned a JSON-RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}` };
  }

  const tools = parsed.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return {
      status: 'fail',
      detail: 'the Privilege app answered tools/list with no tools',
      nextAction: 'The Agentic App resolved but exposes nothing — check the backend MCP Server URL and that discovery succeeded (console shows the merged tool list).',
    };
  }

  return {
    status: 'pass',
    detail: `Privilege answers an authenticated tools/list with ${tools.length} tool${tools.length === 1 ? '' : 's'} at ${url}`,
  };
}

register({
  id: 'gateway.privilege_first',
  name: 'Privilege-first MCP chain answers an authenticated tools/list',
  category: 'Agent Gateway',
  severity: 'advisory',
  appliesWhen: (flags) => flags.ff_mcp_gateway_privilege_first === true,
  run: runPrivilegeMcpFirstCheck,
});

module.exports = { runPrivilegeMcpFirstCheck };
