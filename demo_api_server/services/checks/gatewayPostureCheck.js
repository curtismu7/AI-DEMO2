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
 * A mock PDP is worth KNOWING about before you claim real enforcement on stage.
 * It is not, on its own, a contradiction: ff_authorize_simulated governs the
 * BFF's in-process transaction authorization, and this gateway never reads it.
 * An earlier version of this check failed on that pair and was wrong.
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
    // Is a real PDP answering? Read from the gateway itself. Deliberately NOT
    // cross-referenced against ff_authorize_simulated — see the note below.
    const engineIsReal = !NOT_REAL.has(policySource);
    const meta = { url, policySource, failOpen, enforcing, engineIsReal };

    // NO split-brain check here, deliberately.
    //
    // An earlier version FAILED when policySource was a mock while
    // ff_authorize_simulated was false, calling it "the UI claims real PingOne
    // Authorize". That coupling was wrong. ff_authorize_simulated controls the
    // BFF's in-process TRANSACTION authorization (simulatedAuthorizeService) —
    // its own description says "evaluate with an in-process policy... no worker
    // token or PingOne API call" — and demo_mcp_gateway does not read that flag
    // at ALL (zero references in its source). Which PDP this gateway calls is
    // set by PINGAUTHORIZE_ENDPOINT, independently.
    //
    // Two unrelated facts that both say "authorize". Failing on the pair put a
    // false blocking red on the demo-readiness screen, which is worse than not
    // checking: the screen you trust has to be right about what is wrong.
    //
    // What IS worth reporting is below, factually: who decides, what is
    // enforcing, and what fails open.

    if (off.length || failOpen.length) {
      // Never call the engine "real" here just because there is no
      // contradiction: when simulation is DECLARED, p1az-mock is the expected
      // answer, not a real PDP. Mislabelling it would reintroduce the exact
      // confusion this check exists to remove.
      const enginePhrase = engineIsReal
        ? `Engine "${policySource}" is a real PDP, but `
        : `Decisions come from "${policySource}" (not a real PDP), and `;
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

    if (!engineIsReal) {
      return {
        status: 'warn',
        detail:
          `Decisions on this gateway come from "${policySource}", not a real PDP. `
          + 'Every declared control is enforcing and nothing is failing open, but only claim '
          + 'real policy enforcement for paths this gateway does not decide.',
        meta,
        nextAction:
          'This gateway speaks the PingAuthorize PAP API, not PingOne cloud, so repointing the '
          + 'endpoint will not make it real. To move the A2A path onto real PingOne: author a rule '
          + 'DENYing ActChainDepth < 2 for the sensitive_* tools, confirm with '
          + '`npm run verify:a2a-policy` (real P1AZ currently PERMITs depth-1, so switching first '
          + 'would remove the delegation control), then point Exchange #2 at IG.',
      };
    }

    return {
      status: 'pass',
      detail: `Decisions come from "${policySource}"; every declared control is enforcing and nothing is failing open.`,
      meta,
    };
  },
};

register(posture);
module.exports = { posture, readPosture, NOT_REAL };
