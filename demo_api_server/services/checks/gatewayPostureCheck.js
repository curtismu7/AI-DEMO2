'use strict';

/**
 * WHO decided, and WHAT is actually enforcing.
 *
 * WHY THIS EXISTS
 *
 * Every other gateway check asks whether a call succeeded. None asks whether
 * the authority that allowed it was real, or whether the controls the demo
 * claims are switched on. A gateway that permits everything, with a mock PDP
 * and every enforcement flag off, passes a "did the call work" check perfectly.
 *
 * Found live on 2026-07-26 — the gateway's own /health said:
 *
 *   policySource: "p1az-mock"
 *   enforcing:    { dpop: false, intent: false, rar: false, act: false,
 *                   webBotAuth: "monitor" }
 *   failOpen:     [ MCP_GW_ALLOW_UNVERIFIED_TOKENS, HITL_SERVICE_URL,
 *                   ALLOW_UNSIGNED_TRAT_CONTEXT, INTENT_TOKEN_REQUIRED,
 *                   REQUIRE_ACT_FOR_AGENT_TOOLS ]
 *
 * ...while ff_authorize_simulated was FALSE, i.e. the UI told the audience the
 * decisions were real PingOne Authorize. Standing up and saying "PingOne
 * Authorize denied that" when mock-v1 decided it is the one inaccuracy that
 * matters, because it is the exact claim the demo exists to make.
 *
 * NOTE ON SCOPE: two gateways decide here, and they disagree. PingGateway (IG)
 * calls real PingOne cloud (api.pingone.com/.../decisionEndpoints/) and serves
 * the main chip path. This Node gateway speaks the PingAuthorize PAP shape
 * ({base}/governance/pap/alpha/policy/{worker}/decision) and serves the A2A
 * specialist path. They are different products with different APIs, so this is
 * NOT fixable by repointing an endpoint — see the check detail.
 *
 * This check changes nothing. It reports the posture, which is the part that
 * was missing.
 */

const configStore = require('../configStore');
const { register } = require('./registry');

/** Policy sources that are not a real PDP answering. */
const NOT_REAL = new Set(['p1az-mock', 'local-fallback', 'mock', 'none']);

function gatewayUrl() {
  return (
    process.env.MCP_GW_URL
    || configStore.getEffective('mcp_gw_url')
    || process.env.MCP_GATEWAY_URL
    || configStore.getEffective('mcp_gateway_url')
    || 'http://mcp-gateway:3005'
  );
}

/**
 * Read the gateway's self-reported authz posture. Read-only: GET /health makes
 * no decision and mutates nothing.
 * @returns {Promise<{ok:boolean, authz:object|null, error?:string}>}
 */
async function readPosture(url) {
  const { probeGatewayHealth } = require('../../routes/mcpGatewayConfig');
  try {
    const { running, response } = await probeGatewayHealth(url);
    if (!running || !response) return { ok: false, authz: null, error: `no /health from ${url}` };
    return { ok: true, authz: response.authz || null, raw: response };
  } catch (err) {
    return { ok: false, authz: null, error: err && err.message ? err.message : 'probe failed' };
  }
}

const posture = {
  id: 'gateway.posture',
  name: 'Gateway policy source and enforcement posture',
  category: 'Agent Gateway',
  severity: 'blocking',
  async run() {
    const url = gatewayUrl();
    const { ok, authz, error } = await readPosture(url);

    if (!ok) {
      return {
        status: 'warn',
        detail: `Could not read the gateway posture — ${error}.`,
        nextAction: `Check the Agent Gateway is up and MCP_GW_URL points at it (tried ${url}).`,
      };
    }
    if (!authz) {
      return {
        status: 'warn',
        detail: 'Gateway /health has no authz block — older gateway build, posture unknown.',
        nextAction: 'Rebuild demo_mcp_gateway so /health reports policySource, enforcing and failOpen.',
      };
    }

    const policySource = String(authz.policySource || 'unknown');
    const failOpen = Array.isArray(authz.failOpen) ? authz.failOpen : [];
    const enforcing = authz.enforcing && typeof authz.enforcing === 'object' ? authz.enforcing : {};
    const off = Object.entries(enforcing)
      .filter(([, v]) => v === false)
      .map(([k]) => k);

    // The demo claims real Authorize unless it says otherwise. Reading the flag
    // rather than assuming, so turning simulation ON deliberately is not a fail.
    const simulated = configStore.getEffective('ff_authorize_simulated');
    const claimsReal = !(simulated === true || simulated === 'true');
    const engineIsReal = !NOT_REAL.has(policySource);

    const meta = { url, policySource, failOpen, enforcing, claimsReal };

    if (claimsReal && !engineIsReal) {
      return {
        status: 'fail',
        detail:
          `Split-brain: decisions come from "${policySource}" but ff_authorize_simulated is false, `
          + 'so the UI tells the audience these are real PingOne Authorize decisions. '
          + (off.length ? `Also not enforcing: ${off.join(', ')}. ` : '')
          + (failOpen.length ? `${failOpen.length} fail-open switch(es) active.` : ''),
        meta,
        nextAction:
          'This gateway speaks the PingAuthorize PAP API, NOT PingOne cloud — repointing the '
          + 'endpoint will not make it real (and setting PINGAUTHORIZE_MOCK_BASE elsewhere only '
          + 'relabels the mock as real). Either run a real PingAuthorize, teach it PingOne\'s '
          + 'decision API, or set ff_authorize_simulated=true so the UI stops claiming otherwise.',
      };
    }

    if (off.length || failOpen.length) {
      // Never call the engine "real" here just because there is no
      // contradiction: when simulation is DECLARED, p1az-mock is the expected
      // answer, not a real PDP. Mislabelling it would reintroduce the exact
      // confusion this check exists to remove.
      const enginePhrase = engineIsReal
        ? `Engine "${policySource}" is real, but `
        : `Engine "${policySource}" is simulated (declared via ff_authorize_simulated), and `;
      return {
        status: 'warn',
        detail:
          enginePhrase
          + (off.length ? `not enforcing: ${off.join(', ')}. ` : '')
          + (failOpen.length ? `fail-open active: ${failOpen.join(', ')}.` : ''),
        meta,
        nextAction:
          'Only claim a control on stage if it shows as enforcing here — an off control still '
          + 'lets the call through, which looks identical to it passing.',
      };
    }

    return {
      status: 'pass',
      detail: engineIsReal
        ? `Decisions come from "${policySource}"; every declared control is enforcing and nothing is failing open.`
        : `Decisions come from "${policySource}" (simulation declared); every declared control is enforcing and nothing is failing open.`,
      meta,
    };
  },
};

register(posture);
module.exports = { posture, readPosture, NOT_REAL };
