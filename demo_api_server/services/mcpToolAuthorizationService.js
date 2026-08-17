/**
 * mcpToolAuthorizationService.js
 *
 * PingOne Authorize (or simulated) on **first MCP tool use** per browser session — see
 * docs/PINGONE_AUTHORIZE_PLAN.md §7. Invoked from POST /api/mcp/tool after MCP access
 * token resolution, before the WebSocket tool call.
 */

'use strict';

const configStore = require('./configStore');
const runtimeSettings = require('../config/runtimeSettings');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const simulatedAuthorizeService = require('./simulatedAuthorizeService');
const { decodeJwtClaims } = require('./agentMcpTokenService');
const jwksService = require('./jwksService');
const oauthEndpointResolver = require('./oauthEndpointResolver');
const { buildActorBridgeHeaders } = require('./mcpActorBridge');
const hitlServiceClient = require('./hitlServiceClient');
const cibaTransactionReceipt = require('./cibaTransactionReceipt');
const hitlCredit = require('./hitlCredit');
const dataStore = require('../data/store');
const groupPolicy = require('./groupPolicy');
const {
  resolveActiveUseCaseId,
  resolveDemoUserGroupsForUseCase,
  shouldApplyEntitlementTierDemo,
  shouldApplyGroupPolicyDemo,
} = require('./useCaseDemoBehaviors');
const { getUseCaseStepUpMethod } = require('../config/useCases');
const { verticalManifest } = require('./verticalManifest');
const { resolveConsentContext } = require('./delegatedCommerceRuntime');

/**
 * Extract nested actor id from MCP JWT (RFC 8693 multi-hop) when PingOne issues act.act.
 * @param {object|null|undefined} act
 * @returns {string}
 */
function nestedActIdFromClaim(act) {
  if (!act || typeof act !== 'object') return '';
  const inner = act.act;
  if (!inner || typeof inner !== 'object') return '';
  return String(inner.client_id || inner.sub || '');
}

/**
 * Resolve the EXPECTED MCP resource URI (audience) the BFF passes to the
 * authorization policy, based on which exchange flow is active. Single source
 * of truth used by both the live MCP first-tool gate and the admin Live Policy
 * Console defaults so they never drift.
 *
 *   PingGateway mode (ff_mcp_gateway_pinggateway) → pingone_resource_pinggateway_uri
 *   Node gateway mode (MCP_GATEWAY_HTTP_URL set)  → pingone_resource_mcp_gateway_uri
 *   Two-Exchange (the default)                    → pingone_resource_two_exchange_uri || mcp_resource_uri
 *
 * NOTE: this used to branch on configStore.getEffective('ff_two_exchange_delegation'),
 * a key with NO entry in configStore FIELD_DEFS and no row in the featureFlags
 * registry. getEffective() therefore returned undefined and `!== 'false'` was
 * permanently true, making the final single-exchange branch dead code. The read
 * was deleted rather than registered because the flag no longer drives anything:
 * the exchange path is chosen by req.session.mcpExchangeMode
 * (agentMcpTokenService.resolveMcpAccessTokenWithEvents — two exchanges are
 * mandatory, 'single' is a debug-only escape hatch). Behaviour is unchanged.
 *
 * @returns {string} resolved resource URI, or '' when nothing is configured.
 */
function _resolveResourceMode() {
  // useGateway: only true when explicitly configured (env var or persisted SQLite value).
  // Intentionally excludes FIELD_DEFS defaults — a default gateway URL doesn't mean the
  // gateway is deployed, so we must not switch audience resolution based on it.
  const useGateway = !!(process.env.MCP_GATEWAY_HTTP_URL || configStore.get('mcp_gateway_http_url'));
  const usePingGateway = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';

  if (usePingGateway) return 'pinggateway';
  if (useGateway) return 'gateway';
  // Two-exchange is the mandatory default. origin/main branched here on
  // ff_two_exchange_delegation, but that flag is unregistered (getEffective →
  // undefined, `!== 'false'` permanently true), so the branch always returned
  // 'two-exchange' and 'single-exchange' was dead. This branch keeps that exact
  // behaviour WITHOUT reading the phantom flag (the 'single' path is a
  // req.session.mcpExchangeMode escape hatch, not a config resolution) — so the
  // authzGateFailOpen "never reads ff_two_exchange_delegation" guard holds.
  return 'two-exchange';
}

function resolveExpectedMcpResourceUri() {
  // When routing through PingGateway (IG), the final token audience is the
  // PingGateway resource URI (https://api.ping.demo:3036/mcp), not the Node
  // gateway audience (mcpgateway.ping.demo).
  // Every branch used to end in a literal `|| 'https://api.ping.demo:<port>/mcp'`.
  // That contradicted this function's own contract (see @returns) and is the same
  // defect class as a fabricated audience: an unconfigured deployment silently
  // received a made-up expected resource, so the audience guard compared real
  // tokens against an endpoint nobody had configured — and REGRESSION_PLAN §3
  // forbids hardcoded hosts/ports outright. Resolution is config/env only; when
  // nothing is configured the caller gets '' and must decide honestly what to do
  // (omit the key, or report that no decision could be evaluated).
  switch (_resolveResourceMode()) {
    case 'pinggateway':
      return configStore.getEffective('pingone_resource_pinggateway_uri') || process.env.PINGONE_RESOURCE_PINGGATEWAY_URI || '';
    case 'gateway':
      return configStore.getEffective('pingone_resource_mcp_gateway_uri') || '';
    case 'two-exchange':
      return configStore.getEffective('pingone_resource_two_exchange_uri') || configStore.getEffective('mcp_resource_uri') || '';
    default:
      return configStore.getEffective('mcp_resource_uri') || '';
  }
}

/**
 * The setting that actually drives resolveExpectedMcpResourceUri() in the active
 * mode. Used to render accurate remediation text on an audience mismatch — naming
 * the wrong setting (e.g. MCP_SERVER_RESOURCE_URI on the PingGateway path) tells
 * an operator to break a correct config.
 *
 * @returns {{ mode: string, settingKey: string, envVar: string|null }}
 */
function resolveExpectedMcpResourceSetting() {
  const mode = _resolveResourceMode();
  switch (mode) {
    case 'pinggateway':
      return { mode, settingKey: 'pingone_resource_pinggateway_uri', envVar: 'PINGONE_RESOURCE_PINGGATEWAY_URI' };
    case 'gateway':
      return { mode, settingKey: 'pingone_resource_mcp_gateway_uri', envVar: null };
    case 'two-exchange':
      return { mode, settingKey: 'pingone_resource_two_exchange_uri', envVar: null };
    default:
      return { mode, settingKey: 'mcp_resource_uri', envVar: null };
  }
}

/**
 * True in the modes where the outbound MCP call bridges the actor via X-Act-Client-Id
 * (any gateway or two-exchange mode). On those paths the final hop is Exchange #2 whose
 * actor (the MCP Exchanger) differs from the user's may_act.sub, so PingOne emits NO
 * native `act` (the SpEL that mints it needs actor == may_act.sub — see
 * docs/ACT_CLAIM_VERIFICATION.md), leaving the JWT actor legitimately empty. In pure
 * single-exchange mode the actor IS the AI Agent (== may_act.sub), so the token DOES
 * carry a native `act`; an empty actor there means genuinely no delegation, which the
 * UC16 no-actor guard must still be able to DENY. Mirrors resolveExpectedMcpResourceUri's
 * non-single-exchange branches so the bridge fallback and audience resolution agree.
 *
 * Two-exchange is the default and mandatory path (see resolveExpectedMcpResourceUri
 * for why the unregistered ff_two_exchange_delegation read was removed), so this
 * is true on every mode. It was ALREADY true on every mode — the deleted read
 * returned undefined and `!== 'false'` was permanently true — so the deny posture
 * is unchanged. Kept as a named predicate because the single-exchange escape
 * hatch (req.session.mcpExchangeMode = 'single') is the case it exists to
 * distinguish, and wiring that through is a separate change.
 */
function isActorBridgedMode() {
  return true;
}

/**
 * Status for admin /api/authorize/evaluation-status (no secrets).
 */
function getMcpFirstToolGateStatus() {
  const mcpEp = configStore.get('authorize_mcp_decision_endpoint_id');
  const hasMcpEndpoint = !!(mcpEp && String(mcpEp).trim());
  const pingoneReady = pingOneAuthorizeService.isMcpDelegationDecisionReady();
  const sim = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);

  return {
    mcpFirstToolGateEnabled: true,
    mcpFirstToolDecisionEndpointConfigured: hasMcpEndpoint,
    mcpFirstToolPingOneReady: pingoneReady,
    mcpFirstToolWouldRunSimulated: sim,
    mcpFirstToolWouldRunLive: !sim && pingoneReady,
    mcpFirstToolLivePendingConfig: !sim && !pingoneReady,
  };
}

/** Map MCP write tool names to transaction types for amount-based policy evaluation. */
const WRITE_TOOL_TYPE_MAP = {
  create_transfer: 'transfer',
  // Banking's own high-value action — amount-bearing, so it must reach the
  // Transaction policy like any other transfer.
  create_wire_transfer: 'transfer',
  create_deposit: 'deposit',
  create_withdrawal: 'withdrawal',
  // Vertical amount-gated writes (use-case launcher UC6/7/8 per vertical).
  pay_bill: 'transfer',
  checkout: 'transfer',
  pay_fee: 'transfer',
  pay_tuition_balance: 'transfer',
  submit_expense: 'transfer',
  extend_rental: 'transfer',
  approve_purchase_order: 'transfer',
  // investment (Meridian Wealth) UC6/7/8 — "execute a large trade of $N". Absent
  // here the chip routes but the amount policy never fires: no DENY, no step-up,
  // no consent, and the demo looks correct while authorizing everything.
  large_trade: 'transfer',
  // airlines (United) UC6/7/8/22 — "pay a $N change fee". Absent here the chip
  // routes but the amount policy never fires: no DENY, no step-up, no consent,
  // and the demo looks correct while authorizing everything.
  pay_airline_fee: 'transfer',
};

/**
 * Account-scoped tools whose params name a target account. Used to populate
 * ResourceOwnerId so PingOne Authorize / the mock can DENY cross-owner access
 * (NNP-3, UC10 Meta-chatbot pattern). get_account_balance must be here: UC10's
 * attack sim calls it with a foreign account_id — limiting this to
 * update_contact_email left ResourceOwnerId unset, Authorize inert, and the
 * sim reporting unexpected_permit even when the banking API correctly 403'd.
 */
const RESOURCE_OWNER_TOOLS = new Set([
  'update_contact_email',
  'get_account_balance',
]);

/**
 * Tools that carry a target resource identifier in their params. Returns the
 * owner id in the SAME space as subjectId / userSub (PingOne oauthId preferred,
 * else the store user id), or null if the account cannot be found / tool does
 * not apply.
 */
function resolveResourceOwnerId(tool, toolParams) {
  if (!RESOURCE_OWNER_TOOLS.has(tool) || !toolParams) return null;
  const accountId =
    toolParams.account_id ||
    toolParams.accountId ||
    null;
  if (!accountId) return null;
  const account = dataStore.getAccountById(accountId);
  if (!account) return null;
  const owner = dataStore.getUserById(account.userId);
  // Match evaluateMcpFirstToolGate's subjectId preference (oauthId / PingOne
  // sub). Comparing store-internal ids to oauth UUIDs made the rule fire on
  // every own-account call for bootstrap users linked to PingOne.
  if (owner) return owner.oauthId || owner.id;
  return account.userId;
}

/**
 * Amount for policy evaluation when a write tool names a RECORD instead of stating
 * a figure. Returns null when it does not apply, so the caller keeps its own value.
 *
 * "pay bill 402" states an id, not a price — but norm() strips "$" before the
 * heuristic parses, so a bare id was also matched as the amount ({ amount: 402,
 * recordId: "402" }) and fed to PingOne Authorize as `Amount`. A $20 bill was then
 * evaluated as a $402 payment and could trip a consent/step-up/DENY rule it should
 * never reach. (The money moved was always right: store.payBill(userId, billId)
 * ignores the amount entirely — only the DECISION was made on a fabricated number.)
 *
 * Reads the amount from the record itself, via the plugin's own data store, so the
 * policy decides on the real figure. Fails soft — any miss returns null and the
 * caller falls back to the stated amount, so the gate is never blinded.
 *
 * @param {string} tool
 * @param {object} toolParams
 * @param {string} verticalId
 * @param {string} userId - BFF internal user id (the key the vertical store uses)
 * @returns {number|null}
 */
function resolveAmountForPolicy(tool, toolParams, verticalId, userId) {
  if (tool !== 'pay_bill' || !toolParams || !userId || !verticalId) return null;
  const recordId = toolParams.billId || toolParams.recordId;
  if (!recordId) return null; // amount-driven chip ("pay my $300 bill") — stated amount stands
  try {
    const plugin = verticalManifest.plugins.get(verticalId);
    const store = plugin && typeof plugin.getDataStore === 'function' ? plugin.getDataStore() : null;
    const bills = (store && store.get(userId) && store.get(userId).billingHistory) || [];
    const bill = bills.find((b) => String(b.id) === String(recordId));
    return bill && typeof bill.amountDue === 'number' ? bill.amountDue : null;
  } catch (_) {
    return null; // never throw into the gate
  }
}

/**
 * Which step-up method the client should drive, echoed on every 428 step-up body.
 *
 * The agent step-up modal renders its device picker (SMS / email / passkey) only
 * when this is exactly 'p1mfa'; any other value — including a missing field —
 * makes it fall back to the stub OTP-only modal, so a passkey can never be
 * chosen. Same resolution order as transactionAuthorizationService so the agent
 * and direct transaction paths cannot disagree.
 *
 * A use case may DECLARE its step-up modality in the catalog (e.g. UC22 →
 * 'ciba'); that explicit, amount-independent trigger wins over the global
 * config default and is inherited by every vertical.
 *
 * @param {string|null} [useCaseId] - resolveActiveUseCaseId(req) result, if known
 * @returns {string} 'p1mfa' | 'email' | 'ciba'
 */
function resolveStepUpMethod(useCaseId) {
  const declared = getUseCaseStepUpMethod(useCaseId);
  if (declared) return declared;
  return (
    configStore.getEffective('step_up_method') ||
    runtimeSettings.get('stepUpMethod') ||
    'email'
  );
}

/**
 * Attach the gate's own (pre-override) decision plus the override source's
 * decision onto a Transaction/local-fallback override result, so the Token
 * Chain can render both instead of only the merged/overridden object. Only
 * called from override branches — a bare-PERMIT / no-override return stays
 * unchanged and carries neither key.
 * @param {object} overridden - the return value with fields already overridden
 * @param {object} gateR - the ORIGINAL r, before this override. This file
 *   never mutates r in place (only spreads it), so gateR is still the gate's
 *   own decision at every call site below.
 * @param {{source: string, decision: string, decisionId?: string|null, raw?: object|null}} secondary
 * @returns {object}
 */
function withGateAndSecondaryEvaluation(overridden, gateR, secondary) {
  return {
    ...overridden,
    gateEvaluation: {
      decision: gateR.decision,
      decisionId: gateR.decisionId || null,
      raw: gateR.raw || null,
      request: gateR._debug?.request || null,
      response: gateR._debug?.response || gateR.raw || null,
    },
    secondaryEvaluation: secondary,
  };
}

/**
 * Consult the Transaction decision endpoint for amount-bearing tool calls.
 *
 * The MCP first-tool gate answers "may this agent invoke this tool" — it does not
 * evaluate transaction limits. The Amount rule lives on the Transaction policy,
 * which until now was only reachable from routes/transactions.js (the direct
 * transfer API). So an agent chip asking for a $2500 transfer got PERMIT + a HITL
 * obligation from the gate and never met the limit rule at all — UC6 could not
 * DENY through the agent path in any vertical.
 *
 * The limit policy's outcome takes precedence over the gate's, in the natural
 * ordering DENY > STEP_UP > HITL: a hard limit-DENY overrides everything (UC6,
 * $2500), and a step-up obligation outranks the gate's HITL so UC7 ($600) demos
 * MFA step-up rather than the consent gate UC8 ($300) shows. A limit-policy
 * result with only a consent obligation (or none) leaves the gate's decision
 * intact — it must never CLEAR a HITL/step-up obligation the gate attached.
 *
 * The transaction policy is where amount thresholds live (verified live:
 * $300 -> HITL, $600 -> step-up, $2500 -> DENY); the MCP first-tool gate itself
 * only ever emits HITL, so without this consult UC6/UC7 could not fire.
 *
 * No amount → no call, so non-transactional tools are completely unaffected.
 *
 * @param {object} r - the gate's normalized PingOne result
 * @param {{amount: number|null, transactionType: string|null, userId: string, acr: string}} opts
 * @returns {Promise<object>} r, possibly upgraded to DENY or STEP_UP
 */
async function _applyTransactionPolicy(
  r,
  { amount, transactionType, userId, acr, useCaseId, hitlSatisfied = false },
) {
  // Explicit step-up trigger: a use case may DECLARE its step-up method in the
  // catalog — 'ciba' (UC22, out-of-band) or 'p1mfa' (UC7, device-list MFA).
  // Forcing stepUpRequired makes mapLivePingOneResult emit mcp_step_up_required
  // with that method (resolveStepUpMethod), so the transaction rides the SAME
  // step-up path and the UI's single handler branches on step_up_method. This is
  // amount-independent (never collides with the amount-based MFA threshold) and
  // cross-vertical (declared once, inherited by every vertical). It also fires
  // the correct STEP_UP decision here even though the live P1AZ MCP policy only
  // returns HITL for every amount — without it, the "Step-up required" demo
  // (UC7) evaluated to HITL and the proof strip flagged an authorize mismatch.
  // DENY still wins: mapLivePingOneResult checks r.decision==='DENY' before
  // step-up, and the transaction-policy DENY below is evaluated first.
  const declaredMethod = getUseCaseStepUpMethod(useCaseId);
  const forceStepUp = !!declaredMethod;
  if (!forceStepUp && (!transactionType || !Number.isFinite(amount) || amount <= 0 || !userId)) return r;
  if (r.decision === 'DENY' || r.policyNotFound) return r; // already at/above what we could add
  // MFA threshold used both to (a) demote a gate-level step-up that landed in the
  // HITL amount band and (b) refuse to promote a Transaction-policy step-up below
  // the same bar. Declared forceStepUp (UC7) always wins regardless of amount.
  const _mfaThreshold = Number(configStore.getEffective('mfa_threshold_usd') || runtimeSettings.get('mfa_threshold_usd') || 500);
  // Gate already returned step-up. Do NOT early-return blindly: a $300 MCP-gate
  // step-up used to bypass the threshold guard below, the UI then demoted it to
  // consent, and createTransferWithConsent completed via REST without MFA.
  if (r.stepUpRequired) {
    if (forceStepUp) return r;
    if (Number.isFinite(amount) && amount < _mfaThreshold) {
      return withGateAndSecondaryEvaluation({
        ...r,
        stepUpRequired: false,
        hitlRequired: true,
        transactionPolicyHitl: true,
      }, r, { source: 'transaction-policy', decision: 'HITL_REQUIRED', decisionId: r.decisionId || null, raw: r.raw || null });
    }
    return r;
  }
  try {
    const t = await pingOneAuthorizeService.evaluateTransaction({
      userId, amount, type: transactionType, acr,
    });
    if (t && t.decision === 'DENY') {
      return withGateAndSecondaryEvaluation({
        ...r,
        decision: 'DENY',
        // Surface the limit policy's own decision id/response so the Token Chain
        // and the 403 body show the rule that actually denied, not the gate's.
        decisionId: t.decisionId || r.decisionId,
        raw: t.raw || r.raw,
        transactionPolicyDenied: true,
      }, r, { source: 'transaction-policy', decision: 'DENY', decisionId: t.decisionId || null, raw: t.raw || null });
    }
    // Transaction-policy step-up is only valid when the amount is at or above the
    // MFA threshold. Without this guard a PingOne policy that returns a step-up
    // obligation for amounts in the HITL band (e.g. $300) would incorrectly route
    // UC8 (consent-only) to MFA. Use-case-declared step-up (forceStepUp, UC7) is
    // always honoured regardless of amount.
    if (forceStepUp || (t && t.stepUpRequired && Number.isFinite(amount) && amount >= _mfaThreshold)) {
      // Step-up outranks HITL. Setting stepUpRequired makes mapLivePingOneResult
      // take its step-up branch (checked before HITL) — a 428 mcp_step_up_required.
      // Clear hitlRequired so the gate's HITL obligation doesn't bleed through.
      return withGateAndSecondaryEvaluation({
        ...r,
        stepUpRequired: true,
        hitlRequired: false,
        decisionId: t?.decisionId || r.decisionId,
        raw: t?.raw || r.raw,
        transactionPolicyStepUp: true,
      }, r, { source: 'transaction-policy', decision: 'STEP_UP', decisionId: t?.decisionId || null, raw: t?.raw || null });
    }
    // Promote Transaction-policy HITL/consent onto the MCP gate. The gate itself
    // often PERMITs vertical writes (pay_bill, checkout, …) with no obligation;
    // without this, UC8 ($300) executed and ProofStrip showed authorize mismatch.
    //
    // Not on a call the human has ALREADY approved. The Transaction endpoint is
    // never told about the HITL receipt (its params are amount/type/user only),
    // so it keeps answering "Transaction Consent Required" on the retry. Promoting
    // that made the receipt-rejected branch in mapLivePingOneResult 403 the very
    // call the human had just authorized — the gate accusing itself of
    // misconfiguration over an obligation this overlay re-added.
    if (!hitlSatisfied && t && (t.consentRequired || t.hitlRequired)) {
      return withGateAndSecondaryEvaluation({
        ...r,
        hitlRequired: true,
        decisionId: t.decisionId || r.decisionId,
        raw: t.raw || r.raw,
        transactionPolicyHitl: true,
      }, r, { source: 'transaction-policy', decision: 'HITL_REQUIRED', decisionId: t.decisionId || null, raw: t.raw || null });
    }
  } catch (err) {
    // A declared step-up method is gated by the useCaseId, not the amount — it
    // must still route to step-up even if the amount-limit consult errors.
    if (forceStepUp) {
      return withGateAndSecondaryEvaluation(
        { ...r, stepUpRequired: true, hitlRequired: false, transactionPolicyStepUp: true },
        r,
        { source: 'transaction-policy', decision: 'STEP_UP', decisionId: null, raw: null },
      );
    }
    // The amount ladder ($2500 DENY / $600 step-up / $300 HITL) lives in the
    // Transaction policy. When the consult fails there is no PDP answer, so
    // there is no decision to enforce — block instead of substituting a local
    // one. Re-deriving the thresholds here made the BFF, not PingOne Authorize,
    // the thing that decided, and a demo could not tell the two apart.
    console.warn(
      '[mcpAuthz] transaction policy consult failed — failing closed:',
      err.message,
    );
    return withGateAndSecondaryEvaluation({
      ...r,
      transactionPolicyUnavailable: true,
    }, r, {
      source: 'transaction-policy',
      decision: 'UNAVAILABLE',
      decisionId: null,
      raw: { reason: `Transaction policy endpoint unavailable: ${err.message}` },
    });
  }
  // A PERMIT with no obligation is a PERMIT. This used to fall through to a local
  // amount ladder that re-imposed DENY/step-up/HITL on top of the PDP's answer —
  // whatever PingOne Authorize said, a $300 transfer was gated by BFF code.
  return r;
}

/**
 * Run MCP Authorize gate on every tool call when enabled. Evaluates aud/scope
 * from the token and business rules (e.g. HITL for transfers over threshold).
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {string} opts.tool
 * @param {string|null|undefined} opts.agentToken - MCP access JWT
 * @param {string|null|undefined} opts.userSub - PingOne user id from resolver
 * @param {string} [opts.userAcr] - from session user
 * @param {object} [opts.toolParams] - raw tool params (used for amount on write tools)
 * @param {string} [opts.hitlChallengeId] - On a HITL retry, the challenge id the
 *   agent echoes back. The gate verifies it against the canonical HITL service
 *   (3009) — approved + not-expired + bound to THIS user/agent/tool — and only
 *   then treats the HITL_CONSENT gate as discharged. A missing/invalid/forged id
 *   fails closed (re-challenge), never PERMIT. This is the ONLY place hitlApproved
 *   is derived; it is never accepted as a raw client flag.
 * @returns {Promise<
 *   | { ran: false }
 *   | { ran: true, permit: true, evaluation: object }
 *   | { ran: true, block: { status: number, body: object } }
 *   | { ran: true, simulatedError: Error }
 *   | { ran: true, pingoneError: Error }
 * >}
 */
/**
 * Decode an MCP access token into the flat token facts the PingOne Authorize
 * McpFirstTool parameter map needs (Contract C1, F3). Pure and side-effect
 * free — jwksService.hasKid is a read-only cache lookup, isActorBridgedMode /
 * buildActorBridgeHeaders are read-only config derivations — so unlike
 * buildMcpFirstToolGateInputs (which mutates session state and calls the
 * HITL service) this is safe to call more than once per request. Extracted
 * so agentPreflightService.evaluateBatch can decode the ONE token it
 * resolves for a whole tool batch without re-deriving this logic, and so
 * buildMcpFirstToolGateInputs itself has one less reason to drift from it.
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {string} opts.agentToken
 * @param {string} [opts.userSub]
 * @returns {Promise<{ claims, subjectId, tokenAudience, actClientId, nestedActClientId,
 *   tokenScopes, tokenExp, tokenIat, tokenNbf, tokenIss, tokenKid, tokenKidKnown,
 *   mayActSub, userRole }>}
 */
async function decodeMcpTokenFacts({ req, agentToken, userSub }) {
  // PAZ Trust Framework parameter map (see docs/PINGONE_AUTHORIZE_PLAN.md §MCP Delegation):
  // JWT aud                              → TokenAudience
  // JWT act.client_id || act.sub         → ActClientId     (RFC 8693 §4.1 canonical: act.sub)
  // JWT act.act.client_id || act.act.sub → NestedActClientId
  // configStore mcp_resource_uri         → McpResourceUri
  const decoded = decodeJwtClaims(agentToken);
  const claims = decoded?.claims || {};
  const subjectId = userSub || claims.sub || '';
  const tokenAudience = claims.aud != null ? (Array.isArray(claims.aud) ? claims.aud.join(' ') : String(claims.aud)) : '';
  // RFC 8693 §4.1: act.sub is the canonical actor identifier.
  // act.client_id is PingOne-specific; fall back to act.sub when absent.
  const actClientIdFromToken = claims.act && typeof claims.act === 'object'
    ? String(claims.act.client_id || claims.act.sub || '')
    : '';
  // Bridge fallback (actor-bridged modes only — see isActorBridgedMode): on the
  // gateway / two-exchange paths PingOne emits no native `act` on the final hop
  // (Exchange #2 actor != may_act.sub — docs/ACT_CLAIM_VERIFICATION.md), so the JWT
  // actor is legitimately empty. Supply the same server-to-server actor the outbound
  // MCP call bridges (X-Act-Client-Id, the AI Agent) so this gate presents the
  // identical ActClientId to P1AZ instead of DENYing with mcp-invalid-actor. Matches
  // routes/authorize.js /mcp-console-defaults; trusted because it derives from BFF
  // config/env, never the request. Scoped to bridged modes so that in single-exchange
  // mode (native `act` present) an empty actor still trips the UC16 no-actor guard.
  const actClientId = actClientIdFromToken
    || (isActorBridgedMode() ? (buildActorBridgeHeaders()['X-Act-Client-Id'] || '') : '');
  const nestedActClientId = nestedActIdFromClaim(claims.act);

  // ── Contract C1 token facts (F3) ───────────────────────────────────────────
  // The gateway McpToolCall gate sends these; the BFF McpFirstTool gate did
  // not, so the two evaluations of the same call saw different inputs and could
  // legitimately disagree. Read straight off the presented token; null when the
  // claim is absent so evaluateMcpToolDelegation OMITS the key (C1 rule 3 —
  // omission means "unknown", not "verified absent").
  // tokenScopes in particular is the only way the PDP can enforce least
  // privilege on the default path (F11).
  const tokenScopes = typeof claims.scope === 'string' && claims.scope
    ? claims.scope
    : (Array.isArray(claims.scope) ? claims.scope.join(' ') : null);
  const tokenExp = typeof claims.exp === 'number' ? claims.exp : null;
  const tokenIat = typeof claims.iat === 'number' ? claims.iat : null;
  const tokenNbf = typeof claims.nbf === 'number' ? claims.nbf : null;
  const tokenIss = claims.iss ? String(claims.iss) : null;
  // Signing-key identity (additional check). kid comes off the token HEADER,
  // which decodeJwt already returns (utils/tokenUtils.js:25) and every caller
  // so far discarded. tokenKidKnown is BFF-pre-resolved because the P1AZ
  // snapshot DSL can neither fetch a JWKS nor do array-contains — the same
  // reason InRequiredGroup and UserTier are pre-resolved. null → the key is
  // OMITTED downstream (C1 rule 3: omission means "unknown", never "verified
  // absent"), so a JWKS outage degrades THIS check and leaves the rest of the
  // gate enforcing exactly as it does today.
  const tokenKid = decoded?.header?.kid ? String(decoded.header.kid) : null;
  // A kid is only meaningful against the keyset of the issuer that minted it.
  // jwksService resolves PingOne's JWKS, so a token from any OTHER issuer must
  // resolve to null (unknown), never false — judging it against the wrong
  // keyset would report a perfectly valid token as forged.
  //
  // This is not hypothetical: clientCredentialsTokenService signs local demo
  // tokens with keyid 'client-credentials-key', which is by definition absent
  // from PingOne's JWKS. Without this guard such a token resolves false and
  // DENIES — in simulated mode (the demo default) as well as live.
  const tokenKidIssuerMatches = !!(tokenIss && tokenIss === oauthEndpointResolver.getIssuer());
  const tokenKidKnown = tokenKidIssuerMatches
    ? await jwksService.hasKid(tokenKid)
    : null;
  const mayActSub = claims.may_act && typeof claims.may_act === 'object' && claims.may_act.sub
    ? String(claims.may_act.sub)
    : null;
  // Role as a policy INPUT, replacing the removed admin code-level bypass (F5).
  const userRole = req.session?.user?.role || null;

  return {
    claims, subjectId, tokenAudience, actClientId, nestedActClientId,
    tokenScopes, tokenExp, tokenIat, tokenNbf, tokenIss, tokenKid, tokenKidKnown,
    mayActSub, userRole,
  };
}

/**
 * Assemble the token + context facts evaluateMcpFirstToolGate decides on —
 * JWT claim extraction, actor-chain derivation, HITL receipt verification,
 * group/tier/RAR resolution, and the simulated-vs-live engine parameter
 * shapes (simParams / liveDelegationArgs). Extracted so the real-time gate
 * and the advisory bulk pre-flight path (agentPreflightService.evaluateBatch)
 * assemble a tool's facts from IDENTICAL code — the alternative (two
 * assemblers that can drift) is exactly the F3 divergence this file already
 * warns about elsewhere.
 *
 * Retains every side effect of the original inline code (session mutation
 * for stepUpAlreadyVerified, cibaTransactionReceipt.record, the HITL service
 * call) — this is a pure extraction, not a purification; async I/O and the
 * two `req.session` writes are unchanged in kind and order.
 *
 * Callable only once agentToken is confirmed present — evaluateMcpFirstToolGate
 * keeps that zero-fact short-circuit check itself.
 *
 * @param {object} opts - same shape as evaluateMcpFirstToolGate, agentToken required
 * @returns {Promise<
 *   | { earlyExit: { ran: false, reason: string, skipReason: string } }
 *   | { USE_SIMULATED, runSimulated, notConfiguredDeny, simParams, liveDelegationArgs,
 *       toolAmount, transactionType, policyUserId, subjectId, useCaseId,
 *       stepUpAlreadyVerified, hitlApproved, hitlAlreadyVerified }
 * >}
 */
async function buildMcpFirstToolGateInputs({ req, tool, agentToken, userSub, userAcr, toolParams, hitlChallengeId = null }) {
  // NOTE: admin sessions used to return early here, skipping the ENTIRE
  // authorization gate in code (F5). Role is now forwarded to the PDP as
  // UserRole so the POLICY decides whether admin means anything — a code-level
  // skip is not an authorization decision.

  // Resolved once here (not at the group-policy block below) because the amount
  // resolution needs it too.
  const activeVerticalId = verticalManifest.resolver.activeIdFor(req) || 'banking';

  // Extract amount and transaction type from params for write-tool policy evaluation
  const transactionType = WRITE_TOOL_TYPE_MAP[tool] || null;
  // A tool that names a RECORD carries no amount of its own — read it from the
  // record so the policy decides on the real figure, never on a number parsed out
  // of the phrase. Returns null when it does not apply, so the stated amount stands.
  //
  // User id must match the vertical store key. POST /api/mcp/tool is gated by
  // requireSession only — it never sets req.user — so falling back to
  // userSub / session.oauthId / session.id is required. Using only req.user.id
  // made resolveAmountForPolicy always return null on the chip path, and the
  // gate fell back to the fabricated phrase amount (#539 regression).
  const policyUserId =
    (req.user && req.user.id) ||
    userSub ||
    req.session?.user?.oauthId ||
    req.session?.user?.id ||
    null;
  const recordAmount = resolveAmountForPolicy(tool, toolParams, activeVerticalId, policyUserId);
  const toolAmount = transactionType && toolParams
    ? (recordAmount !== null ? recordAmount : parseFloat(toolParams.amount || 0))
    : null;

  const USE_SIMULATED = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);

  const {
    claims, subjectId, tokenAudience, actClientId, nestedActClientId,
    tokenScopes, tokenExp, tokenIat, tokenNbf, tokenIss, tokenKid, tokenKidKnown,
    mayActSub, userRole,
  } = await decodeMcpTokenFacts({ req, agentToken, userSub });

  // ── HITL receipt verification (the ONLY place hitlApproved is derived) ──────
  // On a retry the agent echoes back the challenge id. Verify it against the
  // canonical HITL service (3009): approved + not-expired + bound to THIS
  // user (subjectId) and agent (actClientId) and tool. Only a verified receipt
  // discharges the HITL_CONSENT gate in the engines below. Fail CLOSED — any
  // error, mismatch, or non-approved status leaves hitlApproved=false, so the
  // engine re-challenges (428) rather than PERMITting. Never trust a raw flag.
  let hitlApproved = false;
  if (hitlChallengeId) {
    try {
      const status = await hitlServiceClient.getChallengeStatus(hitlChallengeId);
      const verification = hitlServiceClient.verifyHitlReceipt(
        status,
        subjectId,
        actClientId || undefined,
        tool,
        Date.now(),
        toolParams?.amount,
        toolParams || {},
      );
      hitlApproved = verification.ok === true;
      if (!hitlApproved) {
        console.warn(
          `[MCP Authorize] HITL receipt rejected for tool=${tool} reason=${verification.message} — re-challenging`,
        );
      }
    } catch (err) {
      console.warn(
        `[MCP Authorize] HITL receipt verification failed (fail-closed, re-challenge): ${err.message}`,
      );
      hitlApproved = false;
    }
  }

  // EXPECTED audience the BFF passes to the policy. The policy compares this
  // against the bearer token's `aud` to catch step-skipping (an attacker
  // sending an intermediate-step token directly to MCP). See
  // resolveExpectedMcpResourceUri() for the per-mode resolution rules.
  const mcpResourceUri = resolveExpectedMcpResourceUri();

  const resourceOwnerId = resolveResourceOwnerId(tool, toolParams);

  // Group-membership policy (Scenario 1). Resolve the tool's required group and
  // the user's groups ONLY when the feature is enabled, so both authorize engines
  // receive identical RequiredGroup / UserGroups parameters (parity). When the
  // flag is off these stay null and the group guard is a no-op end-to-end.
  let requiredGroup = null;
  let userGroups = null;
  let userTier = null;
  let inRequiredGroup = null;
  const verticalId = activeVerticalId;
  const useCaseId = resolveActiveUseCaseId(req);

  // Session-level step-up already satisfied this cycle (CIBA / stub OTP
  // completion) -- mirrors mcpLocalTools.js's consumption of the same flag.
  // Unlike a real P1MFA re-auth, CIBA/OTP completion never re-mints the
  // access token's ACR, so without this the presented token looks unchanged
  // and this gate would re-demand step-up forever on the immediate retry.
  // Single-use: consumed here so it cannot silently PERMIT a later,
  // unrelated tool call. Suppresses only the step-up escalation below --
  // DENY and HITL checks (which run first in every branch) are unaffected.
  const stepUpAlreadyVerified = req.session?.stepUpVerified > Date.now();
  if (stepUpAlreadyVerified) {
    req.session.stepUpVerified = 0;
  }

  // Session-level HITL already satisfied this cycle via CIBA out-of-band
  // approval (set by routes/ciba.js alongside stepUpVerified). CIBA approval
  // is itself a human-in-the-loop event, so it discharges the HITL gate too —
  // otherwise a checkout/transfer that trips both step-up AND HITL (e.g. UC22)
  // clears step-up on retry but 428s forever on the untouched HITL statement.
  // Single-use, same pattern as stepUpAlreadyVerified above.
  //
  // Amount-bound: when this call carries a transfer amount, pass it so a CIBA
  // credit minted for $50 cannot discharge a $5000 retry. Omitting amount here
  // used to opt out of binding, then record a receipt keyed by the REQUEST
  // amount — the bearer /api/transactions path consumed that receipt and the
  // larger write went through. Non-write tools (toolAmount null) still omit
  // amount and keep the unbound discharge for tool-level HITL consent.
  const hitlAlreadyVerified = hitlCredit.isFresh(
    req.session,
    toolAmount != null && Number.isFinite(Number(toolAmount))
      ? { amount: toolAmount }
      : {},
  );
  if (hitlAlreadyVerified) {
    // Consume-on-use (services/hitlCredit.js): the credit is spent below at the
    // HITL-gate site it actually suppresses, NOT here — so an unrelated tool
    // call no longer burns it out from under a pending transaction retry.
    // This gate only covers the BFF's own pre-check (POST /api/mcp/tool). The
    // real write for banking transaction tools still lands on POST
    // /api/transactions via demo_mcp_server's BankingAPIClient, which calls
    // back in over a bearer token only (no session cookie) — so that route's
    // OWN session-based hitlVerified check can never see this approval.
    // Stash a short-lived receipt keyed by (userId, tool, amount) so it can
    // look the approval up without a session. See cibaTransactionReceipt.js.
    // Only record AFTER amount-bound isFresh — never mint a receipt for an
    // amount the CIBA credit did not cover.
    if (transactionType && toolAmount != null) {
      cibaTransactionReceipt.record(policyUserId, tool, toolAmount);
    }
  }

  // Three ways group/tier attributes get resolved and sent to Authorize:
  //   - the global flag, for a permanently-on deployment;
  //   - UC21, which additionally force-injects the premium tier group;
  //   - UC9, which uses REAL membership so the demo's in-group/out-of-group
  //     toggle actually changes the decision.
  // The per-use-case paths exist so a demo never has to flip a process-wide flag
  // and remember to put it back.
  if (groupPolicy.isEnabled(configStore)
    || shouldApplyEntitlementTierDemo(useCaseId)
    || shouldApplyGroupPolicyDemo(useCaseId)) {
    userGroups = await groupPolicy.groupsForUser(
      req.session?.user?.username,
      verticalId,
      { pingOneUserId: subjectId || req.session?.user?.oauthId || req.session?.user?.sub || null },
    );
    userGroups = resolveDemoUserGroupsForUseCase(useCaseId, userGroups);
    // Resolve the tier BEFORE any suppression check. The tier is derived from
    // the same group list but is a separate policy input that live PingOne has
    // never objected to, so it must survive a UserGroups suppression — that
    // asymmetry is the whole point of the fix.
    userTier = groupPolicy.resolveUserTier(userGroups, verticalId);
    if (groupPolicy.areGroupParamsSuppressed()) {
      // A recent live 400 named parameters.UserGroups. Sending them again would
      // just reproduce it on every request, so drop the three group inputs for
      // the suppression window while userTier keeps flowing.
      userGroups = null;
    } else {
      requiredGroup = groupPolicy.requiredGroupForTool(tool, verticalId);
      if (requiredGroup) {
        inRequiredGroup = userGroups.includes(requiredGroup);
      }
    }
  }

  // RAR enforcement (NNP-1, UC14). Extract attested authorization_details from the
  // TraT's azd field (the ONLY trusted source). Never read amount / payee from the
  // request body — a caller-supplied body value must NOT relax the granted limit.
  // azd.authorization_details is placed there by agentMcpTokenService.buildTratContext()
  // when ff_rar is on and the tool has RAR-relevant params.
  // Field contract (production names from buildRarAuthorizationDetails): `amount` is
  // the attested ceiling; `payee` is the permitted destination (single string or array).
  const azdAuthDetails = claims.azd?.authorization_details;
  const rar0 = Array.isArray(azdAuthDetails) && azdAuthDetails.length > 0 ? azdAuthDetails[0] : null;
  // `amount` is the attested ceiling (buildRarAuthorizationDetails field name).
  const rarMaxAmount = rar0?.amount != null ? parseFloat(rar0.amount) : null;
  // `payee` may be a single string or an array; normalise to array for uniform checking.
  const rarPermittedPayees = rar0?.payee != null
    ? (Array.isArray(rar0.payee) ? rar0.payee : [String(rar0.payee)])
    : null;
  // Payee is sourced from toolParams (the agent's stated destination) to check against the
  // attested payee. Normalise both camelCase and snake_case field names.
  const toAccountId = toolParams?.toAccountId ?? toolParams?.to_account_id ?? null;

  // Shared param shape for the simulated engine — used by the USE_SIMULATED
  // branch and, on a genuine PingOne failure, by the fallback path in catch.
  const simParams = {
    userId: subjectId,
    toolName: tool,
    tokenAudience,
    actClientId,
    nestedActClientId,
    mcpResourceUri,
    acr: userAcr,
    amount: toolAmount,
    transactionType,
    hitlApproved,
    hitlChallengeId: hitlApproved ? hitlChallengeId : null,
    resourceOwnerId,
    requiredGroup,
    userGroups,
    verticalId,
    rarMaxAmount,
    rarPermittedPayees,
    toAccountId,
    useCaseId,
    // F5 — role as a policy INPUT. The live PingOne path already receives this;
    // omitting it here made the two engines evaluate DIFFERENT inputs for the
    // same call, which is finding F3 (the two evaluations can legitimately
    // disagree) reproduced inside the failover path. Consumed by WS-D.
    userRole,
  };

  // Live PingOne selected but no MCP decision endpoint is configured. Honor the
  // failover policy instead of silently skipping the gate (fail-open):
  //   deny (strict, default) → fail CLOSED (503)
  //   fallback_simulated     → evaluate with the simulated engine
  //   permit (legacy)        → skip (explicit fail-open)
  let runSimulated = USE_SIMULATED;
  let notConfiguredDeny = false;
  if (!USE_SIMULATED && !pingOneAuthorizeService.isMcpDelegationDecisionReady()) {
    const { failoverMode } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);
    if (failoverMode === 'fallback_simulated') {
      runSimulated = true;
    } else if (failoverMode === 'deny') {
      notConfiguredDeny = true;
    } else {
      // Contract C4 — omission is not permission. The caller must be able to
      // tell "the gate did not run" from "the gate PERMITted", so the skip
      // carries an explicit, inspectable reason.
      console.warn(
        '[MCP Authorize] authorize_mcp_decision_endpoint_id (or worker credentials) is missing ' +
          `and failover is permit — SKIPPING the live PingOne MCP gate for tool=${tool}. ` +
          'This call is NOT authorized.',
      );
      return { earlyExit: { ran: false, reason: 'authorize_not_configured_failover_permit',
               skipReason: 'authorize_not_configured_failover_permit' } };
    }
  }

  const liveDelegationArgs = {
    userId: subjectId,
    toolName: tool,
    tokenAudience,
    actClientId,
    nestedActClientId,
    mcpResourceUri,
    acr: userAcr,
    amount: toolAmount,
    transactionType,
    hitlApproved,
    hitlChallengeId: hitlApproved ? hitlChallengeId : null,
    requiredGroup,
    userGroups,
    userTier,
    inRequiredGroup,
    resourceOwnerId,
    rarMaxAmount,
    rarPermittedPayees,
    toAccountId,
    useCaseId,
    verticalId,
    // Contract C1 (F3) + role as policy input (F5).
    clientId: subjectId || null,
    mayActSub,
    tokenScopes,
    tokenExp,
    tokenIat,
    tokenNbf,
    tokenIss,
    tokenKid,
    tokenKidKnown,
    userRole,
  };

  return {
    USE_SIMULATED,
    runSimulated,
    notConfiguredDeny,
    simParams,
    liveDelegationArgs,
    toolAmount,
    transactionType,
    policyUserId,
    subjectId,
    useCaseId,
    stepUpAlreadyVerified,
    hitlApproved,
    hitlAlreadyVerified,
  };
}

/**
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {string} opts.tool
 * @param {string} opts.agentToken
 * @param {string} [opts.userSub]
 * @param {string} [opts.userAcr] - from session user
 * @param {object} [opts.toolParams] - raw tool params (used for amount on write tools)
 * @param {string} [opts.hitlChallengeId] - On a HITL retry, the challenge id the
 *   agent echoes back. The gate verifies it against the canonical HITL service
 *   (3009) — approved + not-expired + bound to THIS user/agent/tool — and only
 *   then treats the HITL_CONSENT gate as discharged. A missing/invalid/forged id
 *   fails closed (re-challenge), never PERMIT. This is the ONLY place hitlApproved
 *   is derived; it is never accepted as a raw client flag.
 * @returns {Promise<
 *   | { ran: false }
 *   | { ran: true, permit: true, evaluation: object }
 *   | { ran: true, block: { status: number, body: object } }
 *   | { ran: true, simulatedError: Error }
 *   | { ran: true, pingoneError: Error }
 * >}
 */
async function evaluateMcpFirstToolGate(opts) {
  const { req, tool, agentToken } = opts;
  if (!agentToken || typeof agentToken !== 'string') {
    return { ran: false, reason: 'no_agent_token', skipReason: 'no_agent_token' };
  }

  const delegatedConsent = resolveConsentContext(req, tool);
  if (delegatedConsent && !delegatedConsent.sufficient) {
    return {
      ran: true,
      block: {
        status: 403,
        body: {
          error: delegatedConsent.status === 'revoked'
            ? 'delegated_agent_revoked'
            : 'delegated_consent_scope_denied',
          error_description: delegatedConsent.status === 'revoked'
            ? 'The customer revoked this delegated agent.'
            : 'The customer did not grant every scope required by this tool.',
          decisionContext: 'DelegatedConsent',
          agentId: delegatedConsent.agentId,
          consentScopes: delegatedConsent.consentScopes,
          requiredScopes: delegatedConsent.requiredScopes,
        },
      },
    };
  }

  const inputs = await buildMcpFirstToolGateInputs(opts);
  if (inputs.earlyExit) {
    return inputs.earlyExit;
  }

  const {
    USE_SIMULATED,
    runSimulated,
    notConfiguredDeny,
    simParams,
    liveDelegationArgs,
    toolAmount,
    transactionType,
    policyUserId,
    subjectId,
    useCaseId,
    stepUpAlreadyVerified,
    hitlApproved,
    hitlAlreadyVerified,
  } = inputs;
  if (delegatedConsent) {
    liveDelegationArgs.delegatedAgentId = delegatedConsent.agentId;
    liveDelegationArgs.consentScopes = delegatedConsent.consentScopes;
    liveDelegationArgs.requiredConsentScopes = delegatedConsent.requiredScopes;
    simParams.delegatedAgentId = delegatedConsent.agentId;
    simParams.consentScopes = delegatedConsent.consentScopes;
    simParams.requiredConsentScopes = delegatedConsent.requiredScopes;
  }
  const userAcr = opts.userAcr;

  const mapLivePingOneResult = (r, { autoDisabledGroupPolicy = false } = {}) => {
    const autoDisabled = autoDisabledGroupPolicy
      ? { autoDisabledGroupPolicy: true, flagId: 'ff_authorize_group_policy' }
      : null;

    // Policy not found: P1AZ evaluated fine but no policy matched — code/policy
    // drift (e.g. a new tool the deployed policy doesn't know), not a deny.
    // Must be checked before the DENY branch because _normalizeDecision collapses
    // NOT_APPLICABLE to DENY (fail-closed), and we need the distinct 503 response.
    if (r.policyNotFound) {
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'policy_not_found',
            error_description: 'Policy not found, please contact administrator.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            ...autoDisabled,
          },
        },
      };
    }

    // No PDP answer on an amount-bearing call — the Transaction policy consult
    // failed and nothing local stands in for it any more. Distinct from a policy
    // DENY: this is infrastructure, and the operator needs to see that rather
    // than a denial the policy never issued.
    if (r.transactionPolicyUnavailable) {
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'authorization_unavailable',
            error_description:
              'The transaction authorization policy could not be reached, so this call cannot be authorized. Retry once PingOne Authorize is reachable.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    // DENY takes absolute precedence — a hard deny means "no, period" regardless
    // of any HITL/step-up obligations that may also be present on the response.
    if (r.decision === 'DENY') {
      return {
        ran: true,
        block: {
          status: 403,
          body: {
            error: 'mcp_authorization_denied',
            error_description: 'PingOne Authorize denied MCP tool access for this session.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            deny_reason: r.raw?.reason || null,
            deny_parameters: r.raw?.parameters || null,
            authorize_request: r._debug?.request || null,
            authorize_response: r._debug?.response || r.raw || null,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    if (r.stepUpRequired && !stepUpAlreadyVerified) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'mcp_step_up_required',
            error_description:
              'PingOne Authorize requires additional authentication before MCP tools can run.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            // Drives the agent step-up modal: only 'p1mfa' makes it show the
            // device picker (SMS / email / passkey). Omitting the field left it
            // undefined, so every agent step-up fell back to stub OTP-only.
            step_up_method: resolveStepUpMethod(useCaseId),
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    if (r.hitlRequired && hitlApproved) {
      return {
        ran: true,
        block: {
          status: 403,
          body: {
            error: 'mcp_hitl_receipt_rejected',
            error_description:
              'HITL receipt accepted but authorization engine still requires approval — possible policy misconfiguration.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    if (r.hitlRequired && hitlAlreadyVerified) {
      // Consume-on-use: the credit discharged this HITL gate, so spend it now.
      hitlCredit.consume(req.session);
    } else if (r.hitlRequired) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'mcp_hitl_required',
            error_description:
              'PingOne Authorize requires human approval before MCP tools can run.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    return {
      ran: true,
      permit: true,
      evaluation: {
        engine: 'pingone',
        decision: r.decision,
        path: r.path,
        decisionId: r.decisionId,
        decisionContext: 'McpFirstTool',
        request: r._debug?.request || null,
        response: r._debug?.response || r.raw || null,
        gateEvaluation: r.gateEvaluation || null,
        secondaryEvaluation: r.secondaryEvaluation || null,
        ...autoDisabled,
      },
    };
  };

  try {
    if (runSimulated) {
      const r = await simulatedAuthorizeService.evaluateMcpFirstTool(simParams);

      // DENY takes absolute precedence — mirrors mapLivePingOneResult ordering
      // (DENY > step-up > HITL). Simulated gate sets stepUpRequired/hitlRequired
      // false when it returns DENY, but checking DENY first is the invariant so
      // the two paths cannot diverge regardless of future gate changes.
      if (r.decision === 'DENY') {
        return {
          ran: true,
          block: {
            status: 403,
            body: {
              error: 'mcp_authorization_denied',
              error_description:
                'MCP tool access was denied by the simulated authorization policy (education mode).',
              authorize_engine: 'simulated',
              decisionContext: 'McpFirstTool',
              decisionId: r.decisionId,
              // Prefer the machine-readable code (e.g. 'user_not_in_group',
              // 'resource_owner_mismatch') for logs/UI; fall back to the
              // human-readable reason. deny_parameters carries RequiredGroup /
              // UserGroups so the UI can show required-vs-user groups.
              deny_reason: r.raw?.deny_reason || r.raw?.reason || null,
              deny_parameters: r.raw?.parameters || null,
              authorize_request: { parameters: r.raw?.parameters || null },
              authorize_response: (() => {
                if (!r.raw) return null;
                const { parameters: _p, ...rest } = r.raw;
                return rest;
              })(),
            },
          },
        };
      }

      if (r.stepUpRequired && !stepUpAlreadyVerified) {
        return {
          ran: true,
          block: {
            status: 428,
            body: {
              error: 'mcp_step_up_required',
              error_description:
                'Simulated authorization policy requires step-up before MCP tools (education mode).',
              authorize_engine: 'simulated',
              decisionContext: 'McpFirstTool',
              decisionId: r.decisionId,
              step_up_method: resolveStepUpMethod(useCaseId),
            },
          },
        };
      }

      if (r.hitlRequired && hitlApproved) {
        return {
          ran: true,
          block: {
            status: 403,
            body: {
              error: 'mcp_hitl_receipt_rejected',
              error_description:
                'HITL receipt accepted but authorization engine still requires approval — possible policy misconfiguration.',
              authorize_engine: 'simulated',
              decisionContext: 'McpFirstTool',
              decisionId: r.decisionId,
            },
          },
        };
      }

      if (r.hitlRequired && hitlAlreadyVerified) {
        // Consume-on-use: the credit discharged this HITL gate, so spend it now.
        hitlCredit.consume(req.session);
      } else if (r.hitlRequired) {
        return {
          ran: true,
          block: {
            status: 428,
            body: {
              error: 'mcp_hitl_required',
              error_description:
                'Simulated authorization policy requires human approval before MCP tools (education mode).',
              authorize_engine: 'simulated',
              decisionContext: 'McpFirstTool',
              decisionId: r.decisionId,
            },
          },
        };
      }

      // Surface the engine's request/response for the Token Chain education
      // panel. Display-only — enforcement above is already decided.
      const { parameters: simRequestParameters, ...simResponse } = r.raw || {};
      return {
        ran: true,
        permit: true,
        evaluation: {
          engine: 'simulated',
          decision: r.decision,
          path: r.path,
          decisionId: r.decisionId,
          decisionContext: 'McpFirstTool',
          request: { parameters: simRequestParameters || null },
          response: simResponse,
        },
      };
    }

    if (notConfiguredDeny) {
      // Strict PingOne (failover=deny) but no MCP decision endpoint — fail CLOSED.
      console.error(
        '[MCP Authorize] authorize_mcp_decision_endpoint_id (or worker credentials) is missing ' +
          'and failover is deny — failing closed (mcp_authorize_unavailable).',
      );
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'mcp_authorize_unavailable',
            error_description:
              'PingOne Authorize is not configured for MCP tools (no decision endpoint) and failover is deny — failing closed.',
            decisionContext: 'McpFirstTool',
            authorizeFallback: simulatedAuthorizeService.buildAuthorizeFallbackSignal(
              'deny', new Error('not_configured'), 'mcp', { tool }),
          },
        },
      };
    }

    const r = await pingOneAuthorizeService.evaluateMcpToolDelegation(liveDelegationArgs);
    return mapLivePingOneResult(await _applyTransactionPolicy(r, {
      amount: toolAmount, transactionType, userId: policyUserId || subjectId, acr: userAcr, useCaseId,
      hitlSatisfied: hitlApproved || hitlAlreadyVerified,
    }));
  } catch (err) {
    if (USE_SIMULATED) {
      return { ran: true, simulatedError: err };
    }

    // Live PingOne rejects a JS UserGroups array (400 INVALID_VALUE). Self-heal:
    // suppress the group parameters for a few minutes and retry once without
    // them. Deliberately NOT a config write any more — the old code set
    // ff_authorize_group_policy=false, which persisted and also stopped
    // userTier being resolved at all (the flag gates the resolution block
    // above), silently disarming every tier ceiling until a human noticed.
    //
    // userTier is kept in the retry on purpose: PingOne complained about
    // parameters.UserGroups, not UserTier. Dropping the tier too made the retry
    // evaluate with UserTier absent -> 'none', so the tier ceilings did not
    // apply to the very call that was being rescued.
    if (groupPolicy.isUserGroupsAttributeError(err) && groupPolicy.isEnabled(configStore)) {
      const suppressed = groupPolicy.suppressGroupParams();
      if (suppressed) {
        try {
          const {
            requiredGroup: _rg,
            userGroups: _ug,
            inRequiredGroup: _irg,
            ...retryArgs
          } = liveDelegationArgs;
          const retry = await pingOneAuthorizeService.evaluateMcpToolDelegation(retryArgs);
          return mapLivePingOneResult(retry, { autoDisabledGroupPolicy: true });
        } catch (retryErr) {
          err = retryErr;
        }
      }
    }

    // PingOne engine failure — apply the configured failover policy, same as the
    // transaction path. failoverMode is derived from authorize_mode /
    // ff_authorize_fail_open via resolveAuthorizeMode (single source of truth).
    const { failoverMode } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);
    const authorizeFallback = simulatedAuthorizeService.buildAuthorizeFallbackSignal(
      failoverMode, err, 'mcp', {
        tool,
        ...(err.code === 'policy_not_found' ? { reason: 'policy_not_found' }
          : err.code === 'authorize_circuit_open' ? { reason: 'circuit_open' } : {}),
      });

    if (failoverMode === 'permit') {
      // Contract C4 — an unreachable PDP must not look like a PERMIT.
      console.warn(
        `[MCP Authorize] PingOne error — SKIPPING the gate (failover=permit) for tool=${tool}. ` +
          `This call is NOT authorized: ${err.message}`,
      );
      return { ran: false, reason: 'pingone_error_failover_permit',
               skipReason: 'pingone_error_failover_permit', authorizeFallback };
    }

    if (failoverMode === 'fallback_simulated') {
      // Keep the agent demo running on a GENUINE PingOne failure: evaluate the
      // same call with the in-process simulated engine and tag the result so the
      // UI shows the "PingOne fell back" debug modal.
      console.warn(`[MCP Authorize] PingOne error — falling back to simulated engine: ${err.message}`);
      try {
        const r = await simulatedAuthorizeService.evaluateMcpFirstTool(simParams);
        if (r.stepUpRequired && !stepUpAlreadyVerified) {
          return { ran: true, block: { status: 428, body: {
            error: 'mcp_step_up_required',
            error_description: 'PingOne Authorize was unreachable — simulated fallback requires step-up before MCP tools.',
            authorize_engine: 'fallback_simulated',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            // Drives the agent step-up modal: only 'p1mfa' makes it show the
            // device picker (SMS / email / passkey). Omitting the field left it
            // undefined, so every agent step-up fell back to stub OTP-only.
            step_up_method: resolveStepUpMethod(useCaseId),
            authorizeFallback,
          } } };
        }
        if (r.hitlRequired && hitlAlreadyVerified) {
          // Consume-on-use: the credit discharged this HITL gate, so spend it now.
          hitlCredit.consume(req.session);
        } else if (r.hitlRequired) {
          return { ran: true, block: { status: 428, body: {
            error: 'mcp_hitl_required',
            error_description: 'PingOne Authorize was unreachable — simulated fallback requires human approval before MCP tools.',
            authorize_engine: 'fallback_simulated',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            authorizeFallback,
          } } };
        }
        if (r.decision === 'DENY') {
          return { ran: true, block: { status: 403, body: {
            error: 'mcp_authorization_denied',
            error_description: 'PingOne Authorize was unreachable — simulated fallback denied MCP tool access.',
            authorize_engine: 'fallback_simulated',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            deny_reason: r.raw?.deny_reason || r.raw?.reason || null,
            deny_parameters: r.raw?.parameters || null,
            authorize_request: { parameters: r.raw?.parameters || null },
            authorize_response: (() => {
              if (!r.raw) return null;
              const { parameters: _p, ...rest } = r.raw;
              return rest;
            })(),
            authorizeFallback,
          } } };
        }
        const { parameters: simRequestParameters, ...simResponse } = r.raw || {};
        return { ran: true, permit: true, evaluation: {
          engine: 'fallback_simulated',
          decision: r.decision,
          path: r.path,
          decisionId: r.decisionId,
          decisionContext: 'McpFirstTool',
          request: { parameters: simRequestParameters || null },
          response: simResponse,
          authorizeFallback,
        } };
      } catch (fallbackErr) {
        // Even the fallback failed — fail closed.
        return { ran: true, pingoneError: fallbackErr, authorizeFallback };
      }
    }

    // failoverMode === 'deny' (strict pingone): fail closed, surface the signal.
    // A 404'd decision endpoint is a config bug, not an outage — name it so the
    // UI can show "Policy not found" instead of "service unavailable".
    if (err.code === 'policy_not_found') {
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'policy_not_found',
            error_description: 'Policy not found, please contact administrator.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            authorizeFallback,
          },
        },
      };
    }
    return { ran: true, pingoneError: err, authorizeFallback };
  }
}

module.exports = {
  evaluateMcpFirstToolGate,
  buildMcpFirstToolGateInputs,
  decodeMcpTokenFacts,
  getMcpFirstToolGateStatus,
  resolveExpectedMcpResourceUri,
  resolveExpectedMcpResourceSetting,
  nestedActIdFromClaim,
  resolveAmountForPolicy,
  // Exported so tests can assert the gate contract: a vertical's amount action that
  // is absent here routes fine but is NEVER amount-gated (silent authorize).
  WRITE_TOOL_TYPE_MAP,
  // Exported so UC10 / NNP-3 coverage can assert which tools populate ResourceOwnerId
  // and that the returned id is in the subjectId (oauthId) space.
  resolveResourceOwnerId,
  RESOURCE_OWNER_TOOLS,
  // Exported for direct unit testing of Transaction-policy precedence (UC6/7/8).
  _applyTransactionPolicy,
  // Exported so the pipeline can attach step_up_method to a step-up 428 that the
  // GATEWAY decided. The per-use-case method lives in the use-case catalog, which
  // the gateway has no knowledge of, so the BFF resolves it on relay.
  resolveStepUpMethod,
};
