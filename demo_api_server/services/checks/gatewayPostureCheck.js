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
 * It is not, on its own, a contradiction: ff_authorize_real governs the
 * BFF's in-process transaction authorization, and this gateway never reads it.
 * An earlier version of this check failed on that pair and was wrong.
 *
 * NOTE ON SCOPE: two gateways decide here, and they disagree. PingGateway (IG)
 * calls real PingOne cloud (api.pingone.com/.../decisionEndpoints/) and serves
 * the main chip path. The Node gateway speaks the PingAuthorize PAP shape
 * ({base}/governance/pap/alpha/policy/{worker}/decision) and serves the A2A
 * specialist path. They are different products with different APIs, so this is
 * NOT fixable by repointing an endpoint — see the check detail. This check
 * reports whichever one the flags actually put in the path (selectedGateway).
 *
 * This check changes nothing. It reports the posture, which is the part that
 * was missing.
 */

const configStore = require('../configStore');
const { register } = require('./registry');

/** Policy sources that are not a real PDP answering. */
const NOT_REAL = new Set(['p1az-mock', 'local-fallback', 'mock', 'none']);

/**
 * "p1az-mock" is not a fake standing in for PingOne, and calling it one sent a
 * reader down the wrong path twice.
 *
 * authz-server is a faithful local implementation of an AUTHORED cloud policy:
 * snapshots/gen-authorize-snapshot.js generates the P1AZ snapshot from the same
 * source of truth, and the mock deliberately emits the SAME statements[].code
 * values that snapshot defines (DENY_CODE_BY_REASON_PREFIX in
 * demo_authz_server/routes/decision.js).
 *
 * The real gap is one pending operation: that snapshot has never been imported,
 * so the live decision endpoint runs an older, partial policy. Probed
 * 2026-07-27 against the live endpoint — amount ceiling DENY (imported), but
 * A2A act-chain depth, group membership and resource ownership all PERMIT what
 * the authored policy denies.
 *
 * So the fix is NOT "repoint the endpoint at the cloud". Doing that today
 * deletes three authored controls while making the demo look more legitimate.
 * The fix is to import the snapshot, then repoint.
 */
const LOCAL_POLICY_PHRASE =
  'A2A decisions come from authz-server, which implements the authored policy locally — '
  + 'the generated P1AZ snapshot has not been imported, so the live cloud policy is missing '
  + 'rules the demo relies on.';

const LOCAL_POLICY_NEXT_ACTION =
  'Run `node demo_api_server/scripts/verifyAuthorizeCloudParity.js` to see which authored rules '
  + 'the live policy is missing. Import the generated snapshot in the console (needs the '
  + 'Authorization Admin role — the demo worker is 403 on the policy APIs), re-run until it '
  + 'passes, THEN point PINGAUTHORIZE_ENDPOINT at the cloud. Repointing first removes the '
  + 'controls that only run here.';

/**
 * WHICH gateway is actually in the path — resolved the same way every tool call
 * resolves it, not from a private env chain.
 *
 * This check used to read MCP_GW_URL / mcp_gateway_url and default to the Node
 * gateway. With ff_mcp_gateway_pinggateway ON — the steady state — the request
 * path is PingGateway (IG), so the card reported the posture of a component
 * nothing was calling while sitting under the same "Agent Gateway" heading as
 * gateway.real_path, which IS gated on that flag. Its own nextAction tells the
 * presenter to trust it on stage, so naming the wrong gateway is worse than
 * saying nothing.
 *
 * getMcpGatewayHttpUrl() is the single chokepoint the flag re-routes; the
 * IG-vs-Node comparison is the same `base === pgUrl` test callToolViaGateway
 * uses to pick IG-only routes.
 */
function selectedGateway() {
  const { tryGetMcpGatewayHttpUrl } = require('../mcpGatewayClient');
  const base = (tryGetMcpGatewayHttpUrl() || 'http://mcp-gateway:3005').replace(/\/$/, '');
  const pgUrl = (
    process.env.MCP_PINGGATEWAY_URL || configStore.getEffective('mcp_pinggateway_url') || ''
  ).replace(/\/$/, '');
  return {
    // A configured URL may already carry /mcp; /health hangs off the origin.
    url: base.replace(/\/mcp\/?$/, ''),
    isPingGateway: !!pgUrl && base === pgUrl,
  };
}

/**
 * Read the gateway's self-reported authz posture. Read-only: GET /health makes
 * no decision and mutates nothing.
 *
 * `raw` is returned even when the probe is not 200: PingGateway answers 503 with
 * a parseable `{ ready:false }` body, and "reachable but refusing to serve" is a
 * different finding from "unreachable".
 * @returns {Promise<{ok:boolean, authz:object|null, raw:object|null, error?:string}>}
 */
async function readPosture(url) {
  const { probeGatewayHealth } = require('../../routes/mcpGatewayConfig');
  try {
    const { running, response } = await probeGatewayHealth(url);
    if (!running || !response) {
      return { ok: false, authz: null, raw: response || null, error: `no /health from ${url}` };
    }
    return { ok: true, authz: response.authz || null, raw: response };
  } catch (err) {
    return { ok: false, authz: null, raw: null, error: err && err.message ? err.message : 'probe failed' };
  }
}

/**
 * PingGateway (IG) posture, from the only posture signal it exposes.
 *
 * IG has no /health authz block — its /health is p1az-readiness.groovy
 * (ping-gateway/config/routes/00-health.json), which returns 200 `{ready:true}`
 * only when P1AZDecision's DEFAULT (real, non-simulated) PingOne Authorize
 * backend is fully configured, and 503 `{ready:false}` otherwise. That is
 * exactly the "is a real PDP answering" question this card asks, read from the
 * component that answers it. Enforcement per-control is not exposed there;
 * gateway.real_path asserts the path end to end instead of guessing here.
 */
function pingGatewayPosture(url, raw, error) {
  const meta = { url, gateway: 'pinggateway', policySource: 'pingone-authorize' };
  if (!raw || typeof raw.ready !== 'boolean') {
    return {
      status: 'warn',
      detail: `Could not read the PingGateway posture — ${error || '/health did not report readiness'}.`,
      meta: { ...meta, engineIsReal: null },
      nextAction: `Check PingGateway is up and the BFF gateway URL points at it (tried ${url}).`,
    };
  }
  if (!raw.ready) {
    return {
      status: 'fail',
      detail:
        'PingGateway is the gateway in the path and it reports NOT READY — its real PingOne '
        + 'Authorize decision backend is not configured, so every gateway decision fails closed.',
      meta: { ...meta, engineIsReal: false, ready: false },
      nextAction:
        'Set the P1AZ_* env on the ping-gateway service (P1AZ_REAL_BASE, P1AZ_DECISION_ENDPOINT_ID, '
        + 'PINGONE_TOKEN_ENDPOINT, P1AZ_WORKER_CLIENT_ID, P1AZ_WORKER_CLIENT_SECRET) and re-read its '
        + '[P1AZReadiness] log line.',
    };
  }
  return {
    status: 'pass',
    detail:
      'PingGateway is the gateway in the path and its readiness probe confirms the REAL PingOne '
      + 'Authorize decision endpoint is configured, so decisions come from PingOne Authorize, not a '
      + 'local policy. PingGateway does not publish a per-control enforcement map — the end-to-end '
      + 'path is asserted by the real gateway path check.',
    meta: { ...meta, engineIsReal: true, ready: true },
  };
}

const posture = {
  id: 'gateway.posture',
  name: 'Gateway policy source and enforcement posture',
  category: 'Agent Gateway',
  severity: 'blocking',
  async run() {
    const { url, isPingGateway } = selectedGateway();
    const { ok, authz, raw, error } = await readPosture(url);

    // Different product, different posture surface — see pingGatewayPosture.
    if (isPingGateway) return pingGatewayPosture(url, raw, error);

    if (!ok) {
      return {
        status: 'warn',
        detail: `Could not read the gateway posture — ${error}.`,
        nextAction: `Check the Demo Agent Gateway is up and mcp_demo_gateway_url points at it (tried ${url}).`,
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
    // cross-referenced against ff_authorize_real — see the note below.
    const engineIsReal = !NOT_REAL.has(policySource);
    const meta = { url, gateway: 'node', policySource, failOpen, enforcing, engineIsReal };

    // NO split-brain check here, deliberately.
    //
    // An earlier version failed when policySource was mock while
    // ff_authorize_real requested real PingOne. That coupling was wrong:
    // policySource is the observed backend and remains authoritative when the
    // gateway uses its configured outage failover.
    //
    // Two unrelated facts that both say "authorize". Failing on the pair put a
    // false blocking red on the demo-readiness screen, which is worse than not
    // checking: the screen you trust has to be right about what is wrong.
    //
    // What IS worth reporting is below, factually: who decides, what is
    // enforcing, and what fails open.

    if (off.length || failOpen.length) {
      // Never call the engine "real" just because there is no contradiction —
      // but do not call authz-server a fake either. See LOCAL_POLICY_PHRASE.
      const enginePhrase = engineIsReal
        ? `Engine "${policySource}" is a real PDP, but `
        : `${LOCAL_POLICY_PHRASE} `;
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
          `${LOCAL_POLICY_PHRASE} `
          + 'Every declared control is enforcing and nothing is failing open.',
        meta,
        nextAction: LOCAL_POLICY_NEXT_ACTION,
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
module.exports = { posture, readPosture, selectedGateway, pingGatewayPosture, NOT_REAL };
