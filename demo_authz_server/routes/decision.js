'use strict';

/**
 * PingOne Authorize Decision — POST /governance/pap/alpha/policy/:workerId/decision
 *
 * Evaluates an MCP request and returns PERMIT, DENY, or INDETERMINATE.
 * This is the exact endpoint the MCP Gateway calls when MCP_GW_P1AZ_ENABLED=true.
 *
 * Request body (matches what buildAuthorizeParameters() sends):
 *   {
 *     parameters: {
 *       DecisionContext:   'McpToolCall' | 'McpRequest' | 'McpToolsList'
 *       McpMethod:         'tools/call' | 'tools/list' | ...
 *       ToolName:          string
 *       ClientId:          string   — token's sub (the user)
 *       ActClientId:       string   — token's act.sub (the actor / AI Agent) — this,
 *                                     not may_act, is what authorization decisions key on
 *       TokenScopes:       string   — space-separated scopes from token
 *       TokenAudience:     string   — audience claim
 *       TransactionAmount: string   — numeric, '' if not applicable
 *       TransactionType:   string   — tool name or type
 *       ToAccountId:       string
 *       HitlApproved:      'true' | '' — set when user approved via HITL
 *       IntentTokenValid:  'true' | 'false' | ''  — IT validated by gateway ('' = absent/disabled)
 *       IntentMatchesTool: 'true' | 'false' | ''  — tool is in IT permitted_tools
 *       IntentJti:         string                  — JWT ID from intent token
 *       IntentIntent:      string                  — intent label (e.g. 'transfer')
 *       IntentConfidence:  string                  — numeric confidence score
 *     }
 *   }
 *
 * Response (matches PingOne Authorize format):
 *   { decision: 'PERMIT' | 'DENY' | 'INDETERMINATE', reason?: string,
 *     decision_id: string, policy_version: string }
 */

const scopeTopology = require('../scopeTopology');
const pingOneUserLookup = require('../pingOneUserLookup');
const ruleStore = require('../ruleStore');
const { setDecisionContext } = require('../correlationContext');
const { log, warn, auditDecision } = require('../logger');

// Rule 2 (actor identity), Rule 4 (HITL threshold), the tool-discovery decision, and the
// scope->tool / write-tool classification are EDITABLE at runtime via ruleStore (admin
// round-trip editor). The ruleStore getters are read at REQUEST time so an admin edit
// changes live decisions. ENFORCE_MAY_ACT still controls per-user may_act vs the legacy
// static authorized-actor check; both values now come from ruleStore. Token-validity
// guards (aud/exp/iat/nbf/iss, user lookup, intent) stay env/SoT driven and are NOT
// editable. See docs/ACT_CLAIM_VERIFICATION.md for the may_act semantics.

// Env override first (deployment can pin it), else the SoT (scope-topology.json
// gateway resource uri), else the canonical demo literal as a last resort.
// Comma-separated list is supported so Path B (dual_token) can land on the Node
// gateway with a PingGateway-minted aud while MCP_GW_RESOURCE_URI lists both.
const EXPECTED_AUD_RAW = process.env.MCP_GATEWAY_RESOURCE_URI ||
  process.env.MCP_GW_RESOURCE_URI ||
  process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI ||
  scopeTopology.gatewayAudience() ||
  'mcpgateway.ping.demo';
const EXPECTED_AUDS = String(EXPECTED_AUD_RAW)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const EXPECTED_AUD = EXPECTED_AUDS[0];

const _issEnvId  = process.env.PINGONE_ENVIRONMENT_ID || '';
const _issRegion = process.env.PINGONE_REGION || 'com';
const EXPECTED_ISS = _issEnvId
  ? `https://auth.pingone.${_issRegion}/${_issEnvId}/as`
  : null;

const IAT_MAX_AGE_SECONDS = parseInt(
  process.env.AUTHZ_IAT_MAX_AGE_SECONDS || '7200', 10
);

// ── NNP-8 tier policy (UC21) — entitlement-tiered capability ──────────────────
// Parity: this constant must be identical in
// demo_api_server/services/simulatedAuthorizeService.js (tier guard after group guard).
const NNP8_TIER_POLICY = {
  PrivateBanking: {
    maxAmountUsd: 50000,
    // No tool restrictions — all write tools permitted at elevated limits.
    privateBankingOnlyTools: [],
  },
  Standard: {
    maxAmountUsd: 2000,
    // These tools are only available to PrivateBanking members.
    privateBankingOnlyTools: ['create_withdrawal', 'withdraw'],
  },
};
const NNP8_DEFAULT_TIER = 'Standard';

function _resolveUserTier(userGroupsParam) {
  let groups = [];
  if (userGroupsParam) {
    if (Array.isArray(userGroupsParam)) {
      groups = userGroupsParam;
    } else {
      try { groups = JSON.parse(userGroupsParam); } catch (_e) { groups = []; }
    }
  }
  if (Array.isArray(groups) && groups.includes('PrivateBanking')) return 'PrivateBanking';
  return NNP8_DEFAULT_TIER;
}

// ── Mock/cloud contract (F9) ──────────────────────────────────────────────────
// The cloud PDP returns applied rule effects as `statements[].code`; this mock
// used to return only `reason`, so consumers merged six response shapes to cover
// both (pingOneAuthorizeService._classifyRawObligations). The mock now emits the
// SAME codes the cloud snapshot defines
// (snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json) while
// KEEPING `reason` for back-compat.
//
// Codes are looked up from the deny reason's prefix (the token before ':'), so a
// new deny reason inherits the shared code rather than emitting an unknown one.
// Reasons whose cloud equivalent is not prefix-derivable pass an explicit code.
const DENY_CODE_BY_REASON_PREFIX = {
  missing_sub: 'mcp-missing-user-id',
  invalid_aud: 'mcp-invalid-audience',
  a2a_delegation_required: 'mcp-invalid-a2a-generalist',
  invalid_a2a_generalist: 'mcp-invalid-a2a-generalist',
  missing_act: 'mcp-invalid-actor',
  missing_user_groups: 'mcp-user-not-in-group',
  malformed_user_groups: 'mcp-user-not-in-group',
  user_not_in_group: 'mcp-user-not-in-group',
  amount_exceeds_ceiling: 'transaction-denied',
  tier_tool_not_allowed: 'mcp-tier-tool-not-allowed',
  tier_amount_exceeded: 'mcp-tier-amount-exceeded',
};
// Every deny without a specific cloud rule maps to the shared MCP deny statement
// (the cloud snapshot multi-parents this one across all seven MCP deny rules).
const DEFAULT_DENY_CODE = 'mcp-authorization-denied';

// C2 — decision provenance. Every response this module returns is labelled.
const POLICY_SOURCE = 'p1az-mock';

// Contexts that represent a single MCP tool invocation. The gateways send
// 'McpToolCall'; the BFF sends 'McpFirstTool'. Rules gated on only the former
// were skipped for every BFF-originated call (docs §5.5).
const MCP_TOOL_CALL_CONTEXTS = new Set(['McpToolCall', 'McpFirstTool']);

// Scopes that authorize the gateway hop itself rather than a specific tool. A
// token carrying only these cannot express per-tool scopes (Rule 3).
const GATEWAY_HOP_SCOPES = ['gateway:mcp:invoke', 'pinggateway:invoke'];

/**
 * Parse an audience-ish value that may be a JSON array string, a
 * comma-separated list, or a whitespace-separated list.
 */
function parseAudList(value) {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return raw.split(/[\s,]+/).filter(Boolean);
  }
}

function randomId() {
  try { return require('crypto').randomUUID(); } catch { return `id-${Date.now()}`; }
}

module.exports = async function decisionHandler(req, res) {
  const { workerId } = req.params;
  const params = req.body?.parameters || {};

  const {
    DecisionContext = '',
    ToolName = '',
    ClientId = '',
    ActClientId = '',
    TokenScopes = '',
    TokenAudience = '',
    TokenAudActual = '',
    McpResourceUri = '',
    TokenExp = '',
    TokenIat = '',
    TokenNbf = '',
    TokenIss = '',
    TransactionAmount = '',
    HitlApproved = '',
    HitlChallengeId = '',
    IntentTokenValid = '',
    IntentMatchesTool = '',
    IntentTokenError = '',   // why gateway validation failed (empty when valid/absent)
    IntentJti = '',
    IntentIntent = '',
    IntentConfidence = '',
    ActChainDepth = '',
    NestedActClientId = '',
    RarAuthorizationDetails = '',
    ResourceOwnerId = '',
    RequiredGroup = '',
    UserGroups = '',   // JS array or JSON array string, e.g. ['Premium','Standard'] or '["Premium","Standard"]'
    ToAccountId = '',
  } = params;

  // Callers may send a non-string for a field we treat as a string (a JSON
  // number/object in `parameters`). Coerce before any .split()/.trim() so a
  // malformed body yields a normal DENY, not a thrown request. Defaults are ''.
  const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

  const grantedScopes = new Set(asStr(TokenScopes).split(/\s+/).filter(Boolean));
  // Bare HitlApproved=true is not enough — require a UUID challenge id. When
  // HITL_SERVICE_URL is set, also confirm the challenge is approved in the HITL
  // store (defense-in-depth for direct mock-authz callers). Without the URL,
  // UUID format alone is required (unit tests / local without HITL).
  const challengeIdRaw = asStr(HitlChallengeId).trim();
  const challengeIdLooksValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeIdRaw);
  let hitlApproved = HitlApproved === 'true' && challengeIdLooksValid;
  if (hitlApproved && process.env.HITL_SERVICE_URL) {
    try {
      const base = String(process.env.HITL_SERVICE_URL).replace(/\/$/, '');
      const secret = process.env.HITL_INTERNAL_SECRET || '';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const hr = await fetch(`${base}/challenges/${encodeURIComponent(challengeIdRaw)}`, {
        signal: ctrl.signal,
        headers: secret ? { 'X-HITL-Internal-Secret': secret } : {},
      });
      clearTimeout(timer);
      if (!hr.ok) {
        hitlApproved = false;
        warn(`[AuthzServer/decision] HITL lookup failed status=${hr.status} id=${challengeIdRaw}`);
      } else {
        const body = await hr.json();
        if (body?.status !== 'approved') {
          hitlApproved = false;
          warn(`[AuthzServer/decision] HITL challenge not approved status=${body?.status} id=${challengeIdRaw}`);
        }
      }
    } catch (err) {
      hitlApproved = false;
      warn(`[AuthzServer/decision] HITL lookup error (fail-closed): ${err.message}`);
    }
  }
  const nowSec = Math.floor(Date.now() / 1000);

  // Bind the structured decision inputs so deny()/indeterminate() can emit a
  // complete authz-decision audit record (read from the correlation context).
  setDecisionContext({
    decisionContext: DecisionContext || null,
    tool: ToolName || null,
    sub: ClientId || null,
    actor: ActClientId || null,
    workerId: workerId || null,
  });

  log(`[AuthzServer/decision] policy=${workerId} ctx=${DecisionContext} tool=${ToolName || '(none)'} sub=${ClientId || '(none)'} actor=${ActClientId || '(none)'} aud=${TokenAudActual || TokenAudience || '(none)'} exp=${TokenExp || '(none)'} scopes=[${TokenScopes}] hitlApproved=${hitlApproved} intentValid=${IntentTokenValid || 'absent'} intentMatch=${IntentMatchesTool || 'absent'} intent=${IntentIntent || '(none)'} rar=${RarAuthorizationDetails ? 'present' : 'absent'}`);

  // ── Rule 0a: sub (user identity) must be present ──────────────────────────
  if (!ClientId || !asStr(ClientId).trim()) {
    warn(`[AuthzServer/decision] DENY — missing sub`);
    return deny(res, 'missing_sub: token must carry a non-empty sub claim');
  }

  // ── Rule 0b: aud must include the gateway resource URI ────────────────────
  // Parse aud as space- or comma-separated string or a JSON array string
  // (e.g. '["a","b"]') — handle all three to avoid spurious DENYs. The Node
  // gateway passes its GATEWAY_RESOURCE_URI verbatim as TokenAudience, and on
  // k8s that env is comma-joined ("mcpgateway.ping.demo,https://…/mcp"), which
  // the old whitespace-only split treated as ONE bogus aud → every tools/list
  // DENYed with "aud mismatch" even though the expected aud was present.
  const rawAud = asStr(TokenAudActual) || asStr(TokenAudience);
  let audList;
  try {
    const parsed = JSON.parse(rawAud);
    audList = Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    audList = rawAud.split(/[\s,]+/).filter(Boolean);
  }
  if (!EXPECTED_AUDS.some((a) => audList.includes(a))) {
    warn(`[AuthzServer/decision] DENY — aud mismatch: [${audList.join(',')}] expected ${EXPECTED_AUDS.join(' | ')}`);
    return deny(res, `invalid_aud: audience does not include ${EXPECTED_AUDS.join(' | ')}`);
  }

  // ── Rule 0b-2: anti-bypass (D-05) — actual aud must NOT target an upstream ──
  // Parity with the Node gateway's GatewayTokenPolicy (bypass_attempt). A token
  // whose ACTUAL introspected aud already carries a backend/RS audience — even
  // alongside the gateway URI in a multi-aud token — is a confused-deputy
  // bypass: the client must obtain a gateway-targeted token and let the gateway
  // exchange it for the next hop. Only TokenAudActual (the real introspected
  // aud) is authoritative; older callers that omit it keep the legacy behaviour.
  if (TokenAudActual) {
    let actualList;
    try {
      const parsed = JSON.parse(TokenAudActual);
      actualList = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      actualList = TokenAudActual.split(/\s+/).filter(Boolean);
    }
    const upstreamHit = scopeTopology.upstreamAudiences().find((u) => actualList.includes(u));
    if (upstreamHit) {
      warn(`[AuthzServer/decision] DENY — bypass_attempt: aud [${actualList.join(',')}] targets upstream ${upstreamHit}`);
      return deny(res, `bypass_attempt: token aud targets upstream ${upstreamHit} — cannot bypass gateway (D-05)`);
    }
  }

  // ── Rule 0c: TokenAudience must name the expected MCP resource ────────────
  // Mirrors the cloud policy's HasValidMcpAudience condition (TokenAudience ==
  // McpResourceUri). This USED to be a tautology: both gateways sent the same
  // gatewayResourceUri for both keys, so the comparison could never fail.
  // Under contract C1 TokenAudience becomes the token's REAL `aud`, which makes
  // the rule meaningful — a token minted for a different MCP server now DENYs.
  //
  // Compared as SETS, not raw strings: post-C1 the caller sends the token's
  // single actual aud while McpResourceUri still lists every accepted audience
  // (k8s comma-joins them), so string equality would spuriously DENY the normal
  // flow. Only enforced when the gateway supplies McpResourceUri — older callers
  // that omit it keep the legacy behaviour.
  if (McpResourceUri && TokenAudience) {
    const tokenAudList = parseAudList(TokenAudience);
    const resourceUriList = parseAudList(McpResourceUri);
    if (!tokenAudList.some((a) => resourceUriList.includes(a))) {
      warn(`[AuthzServer/decision] DENY — TokenAudience [${tokenAudList.join(',')}] does not name McpResourceUri [${resourceUriList.join(',')}]`);
      return deny(res, `invalid_aud: TokenAudience "${TokenAudience}" does not match McpResourceUri "${McpResourceUri}"`);
    }
  }

  // ── Rule 0c: exp must be in the future ────────────────────────────────────
  if (TokenExp) {
    const exp = parseInt(TokenExp, 10);
    if (!isNaN(exp) && nowSec >= exp) {
      warn(`[AuthzServer/decision] DENY — token expired: exp=${exp} now=${nowSec}`);
      return deny(res, `token_expired: exp=${exp}`);
    }
  }

  // ── Rule 0d: iat must not be future and not older than IAT_MAX_AGE_SECONDS ─
  if (TokenIat) {
    const iat = parseInt(TokenIat, 10);
    if (!isNaN(iat)) {
      if (iat > nowSec + 30) {
        warn(`[AuthzServer/decision] DENY — iat in future: iat=${iat} now=${nowSec}`);
        return deny(res, `invalid_iat: token issued in the future`);
      }
      if (nowSec - iat > IAT_MAX_AGE_SECONDS) {
        warn(`[AuthzServer/decision] DENY — token too old: age=${nowSec - iat}s`);
        return deny(res, `token_too_old: issued ${nowSec - iat}s ago (max ${IAT_MAX_AGE_SECONDS}s)`);
      }
    }
  }

  // ── Rule 0e: nbf (not-before) must not be in the future ──────────────────
  if (TokenNbf) {
    const nbf = parseInt(TokenNbf, 10);
    if (!isNaN(nbf) && nowSec < nbf) {
      warn(`[AuthzServer/decision] DENY — token not yet valid: nbf=${nbf} now=${nowSec}`);
      return deny(res, `token_not_yet_valid: nbf=${nbf}`);
    }
  }

  // ── Rule 0f: iss (issuer) must match the expected identity provider ───────
  if (TokenIss && EXPECTED_ISS && TokenIss !== EXPECTED_ISS) {
    warn(`[AuthzServer/decision] DENY — iss mismatch: "${TokenIss}" expected "${EXPECTED_ISS}"`);
    return deny(res, `invalid_iss: unexpected token issuer`);
  }

  // ── Rule 1 (early): tools/list ────────────────────────────────────────────
  // Token validity checks are complete; now check user status for all contexts.
  // Tool discovery is permitted by default; an admin can flip it to DENY via ruleStore.
  if (DecisionContext === 'McpToolsList') {
    if (ruleStore.getToolDiscoveryDecision() === 'DENY') {
      return deny(res, 'tool discovery denied by policy');
    }
    // Still enforce user existence/enabled for tool discovery — a disabled user
    // must not be able to enumerate available tools.
    let userInfoList;
    try {
      userInfoList = await pingOneUserLookup.lookupUser(ClientId);
    } catch (err) {
      warn(`[AuthzServer/decision] PingOne lookup failed for tool discovery: ${err.message} — failing closed`);
      return deny(res, 'user_lookup_failed: unable to verify user status');
    }
    if (userInfoList.status === 'NOT_FOUND') {
      return deny(res, 'unknown_sub: user not found in identity provider');
    }
    if (userInfoList.status === 'LOOKUP_FAILED') {
      return deny(res, 'user_lookup_failed: unable to verify user status');
    }
    if (userInfoList.found && !userInfoList.enabled) {
      return deny(res, `user_disabled: sub=${ClientId} status=${userInfoList.status}`);
    }
    if (userInfoList.found && userInfoList.status && !['ACTIVE', 'UNKNOWN'].includes(userInfoList.status)) {
      return deny(res, `user_not_active: status=${userInfoList.status}`);
    }
    // Per-tool evaluation: when the gateway sends CandidateTools, return advice
    // listing which are permitted/denied for the token's scopes + the vertical.
    // Drives the greyed-chip UI. Absent CandidateTools → legacy single-PERMIT.
    const { Vertical = '', CandidateTools = '' } = params;
    if (CandidateTools) {
      let candidates = [];
      try { candidates = JSON.parse(CandidateTools); } catch { candidates = []; }
      const permittedTools = [];
      const deniedTools = [];
      for (const name of candidates) {
        const req = ruleStore.requiredScopesForTool(name); // null = unknown tool
        if (req === null) { deniedTools.push({ name, reason: `unknown_tool: no policy for "${name}"` }); continue; }
        const missing = req.filter(s => !grantedScopes.has(s));
        if (missing.length) deniedTools.push({ name, reason: `insufficient_scope: requires ${missing.join(', ')}` });
        else permittedTools.push(name);
      }
      return permitWithAdvice(res, 'tool discovery permitted (per-tool)', [
        { name: 'AllowedVertical', value: Vertical || '' },
        { name: 'PermittedTools', value: JSON.stringify(permittedTools) },
        { name: 'DeniedTools', value: JSON.stringify(deniedTools) },
      ]);
    }
    return permit(res, 'tool discovery permitted');
  }

  // ── Rule 0a2: sub must be a known, active PingOne user (contextual binding)
  // User lookup runs AFTER token-validity checks to avoid burning PingOne API
  // quota on tokens that would be rejected anyway (prevents user enumeration).
  // Fails closed on network error to prevent crash; logs warning and denies.
  let userInfo;
  try {
    userInfo = await pingOneUserLookup.lookupUser(ClientId);
    log(`[AuthzServer/decision] user lookup: sub=${ClientId} enabled=${userInfo.enabled} status=${userInfo.status} found=${userInfo.found}`);
  } catch (err) {
    warn(`[AuthzServer/decision] CRITICAL: PingOne user lookup failed: ${err.message} — failing closed to prevent unhandled rejection`);
    return deny(res, 'user_lookup_failed: unable to verify user status');
  }
  // Explicit NOT_FOUND (404) or LOOKUP_FAILED (API/network error) → DENY (fail closed).
  if (userInfo.status === 'NOT_FOUND') {
    warn(`[AuthzServer/decision] DENY — sub not found in PingOne: sub=${ClientId}`);
    return deny(res, `unknown_sub: user not found in identity provider`);
  }
  if (userInfo.status === 'LOOKUP_FAILED') {
    warn(`[AuthzServer/decision] DENY — PingOne user lookup failed: sub=${ClientId}`);
    return deny(res, 'user_lookup_failed: unable to verify user status');
  }
  if (userInfo.found && !userInfo.enabled) {
    warn(`[AuthzServer/decision] DENY — user disabled: sub=${ClientId} status=${userInfo.status}`);
    return deny(res, `user_disabled: sub=${ClientId} status=${userInfo.status}`);
  }
  if (userInfo.found && userInfo.status && !['ACTIVE', 'UNKNOWN'].includes(userInfo.status)) {
    warn(`[AuthzServer/decision] DENY — user not active: sub=${ClientId} status=${userInfo.status}`);
    return deny(res, `user_not_active: status=${userInfo.status}`);
  }

  // ── Rule 1b: ChipAuthorization — validate user can use a specific chip ───
  // Called from the setup page pipeline map to show PERMIT/DENY per chip.
  // Parameters used: ToolName (chip action), TokenScopes, Vertical, ClientId.
  // Same scope logic as McpToolCall but no act-claim check (user context only).
  if (DecisionContext === 'ChipAuthorization') {
    const { Vertical = '' } = params;
    const requiredScopes = ruleStore.requiredScopesForTool(ToolName);
    // Unknown tool (no policy) → DENY, matching McpToolCall (Rule 3) and the
    // McpToolsList per-tool eval. Previously this branch skipped the check and
    // PERMITted unknown tools, so the same tool could be PERMIT here but DENY at
    // call time — a parity gap between greyed-chip UI and actual enforcement.
    if (requiredScopes === null) {
      warn(`[AuthzServer/ChipAuthorization] DENY — unknown tool: "${ToolName}"`);
      return deny(res, `unknown_tool: no policy defined for tool "${ToolName}"`);
    }
    if (requiredScopes.length > 0) {
      const missing = requiredScopes.filter(s => !grantedScopes.has(s));
      if (missing.length > 0) {
        log(`[AuthzServer/ChipAuthorization] DENY — ${Vertical}/${ToolName} missing scopes: ${missing.join(', ')}`);
        return deny(res, `insufficient_scope: missing ${missing.join(', ')}`);
      }
    }
    log(`[AuthzServer/ChipAuthorization] PERMIT — ${Vertical}/${ToolName}`);
    return permit(res, `chip authorized for ${Vertical}/${ToolName}`);
  }

  // ── Rule 1c: A2A delegation — act-chain decision (no may_act) ─────────────
  // Sensitive tools flagged a2aDelegated in the SoT are reachable ONLY when the
  // token's act chain shows a specialist delegated by the generalist (depth >= 2:
  // act:{specialist, act:{generalist}}). The generalist's own token has act depth 1
  // (act:{generalist}) and is DENIED — it must delegate. This is the "Authorize
  // decides over the act chain" semantic; it REPLACES the may_act check below for
  // these tools (A2A intentionally carries no may_act).
  const a2aDelegated = scopeTopology.isA2aDelegatedTool(ToolName);
  if (a2aDelegated) {
    const depth = parseInt(ActChainDepth, 10);
    const chainDepth = Number.isNaN(depth) ? 0 : depth;
    if (chainDepth < 2) {
      warn(`[AuthzServer/decision] DENY — a2a_delegation_required: "${ToolName}" needs a specialist delegation (act chain depth ${chainDepth} < 2)`);
      return deny(res, `a2a_delegation_required: "${ToolName}" must be delegated to a specialist agent (act chain depth ${chainDepth} < 2)`);
    }
    const authorizedGeneralist = process.env.PINGONE_AI_AGENT_CLIENT_ID || '';
    if (authorizedGeneralist && NestedActClientId !== authorizedGeneralist) {
      warn(`[AuthzServer/decision] DENY — invalid_a2a_generalist: nested act.sub "${NestedActClientId}" is not the registered AI Agent "${authorizedGeneralist}"`);
      return deny(res, `invalid_a2a_generalist: nested act.sub "${NestedActClientId}" is not the authorized generalist`);
    }
    log(`[AuthzServer/decision] A2A OK — "${ToolName}" reached via specialist delegation (depth ${chainDepth}, generalist ${NestedActClientId})`);
  }

  // ── Rule 2: act claim validation (act-only — no may_act) ──────────────────
  // The actor MUST be one of the registered chain identities: the MCP
  // Exchanger (the terminal actor of the standard two-exchange flow) or the
  // AI Agent (a single-hop terminal actor). When neither is configured, any
  // delegation is denied (fail-closed). Empty ActClientId means no
  // delegation (simple exchange) — allowed. This used to have a second mode
  // (ENFORCE_MAY_ACT) that cross-referenced the user's may_act.sub instead of
  // checking the actor identity directly — removed in favor of act-only
  // validation; the permitted identity set is unchanged (same two client ids
  // the old may_act branch's "single-hop" and "2-exchange" cases allowed).
  // Rule 2.5 below is what actually requires an act claim to be present at
  // all for agent-mediated tools.
  const authorizedActor = ruleStore.getAuthorizedActorClientId();
  const authorizedAiAgent = process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID || '';
  if (a2aDelegated) {
    // A2A tools are authorized by the act chain (Rule 1c). Skip Rule 2.
  } else if (ActClientId) {
    const isAuthorizedActor = !!authorizedActor && ActClientId === authorizedActor;
    const isAuthorizedAiAgent = !!authorizedAiAgent && ActClientId === authorizedAiAgent;
    if (!isAuthorizedActor && !isAuthorizedAiAgent) {
      warn(`[AuthzServer/decision] DENY — act.sub "${ActClientId}" != authorized actor "${authorizedActor || '(none configured)'}" or AI Agent "${authorizedAiAgent || '(none configured)'}"`);
      // Explicit code: this reason has no "prefix:" shape to derive from.
      return deny(res, `act.sub "${ActClientId}" is not an authorized actor`, 'mcp-invalid-actor');
    }
  }

  // ── Rule 2.5: UC16 — Require-act for agent-mediated tools ─────────────────
  // Tools flagged requiresAgentMediation in scope-topology.json MUST carry an
  // ActClientId (act claim). A no-act call to these tools is impersonation —
  // the agent identity is erased from the token. Default ON — this is now the
  // primary act-based replacement for the may_act-based Rule 2 check removed
  // above (set REQUIRE_ACT_FOR_AGENT_TOOLS=false to opt out).
  // Parity: simulatedAuthorizeService.js evaluateMcpFirstTool mirrors this rule.
  // Accepts BOTH tool-call contexts: the gateways send 'McpToolCall' and the BFF
  // sends 'McpFirstTool'. Gating on 'McpToolCall' alone skipped this rule for
  // every BFF-originated call (docs §5.5).
  const requireActForAgentTools = process.env.REQUIRE_ACT_FOR_AGENT_TOOLS !== 'false';
  if (requireActForAgentTools && MCP_TOOL_CALL_CONTEXTS.has(DecisionContext)) {
    if (scopeTopology.isAgentMediatedTool(ToolName) && !ActClientId) {
      warn(`[AuthzServer/decision] DENY — missing_act: tool "${ToolName}" requires agent delegation`);
      return deny(res, `missing_act: tool "${ToolName}" requires an act claim (agent delegation). Impersonation is not permitted.`);
    }
  }

  // ── Rule 3: scope check ───────────────────────────────────────────────────
  // Unknown tool names (requiredScopes === null) are denied — there is no policy
  // for an unrecognised tool, so the safe default is DENY.
  const requiredScopes = ruleStore.requiredScopesForTool(ToolName);
  if (requiredScopes === null) {
    warn(`[AuthzServer/decision] DENY — unknown tool: "${ToolName}"`);
    return deny(res, `unknown_tool: no policy defined for tool "${ToolName}"`);
  }
  // F11: this rule used to disable itself. Any token carrying the gateway-hop
  // scope (gateway:mcp:invoke — the BFF's Exchange #2 default since the
  // pinggateway:invoke rename; the old name is still honored) skipped the
  // per-tool scope check entirely. On the default topology the final token
  // carries ONLY that scope, so per-tool scope was enforced NOWHERE in the
  // system — least privilege was asserted in scope-topology.json and applied by
  // nobody.
  //
  // The bypass now survives only for the case it was actually meant to cover: a
  // caller that genuinely CANNOT express per-tool scopes because its token holds
  // the gateway-hop scope and nothing else. As soon as the token carries a real
  // per-tool scope (contract C1 makes these reachable as TokenScopes), the check
  // enforces against TokenScopes.
  //
  // "Real per-tool scope" means a scope scope-topology.json actually defines —
  // so unrelated OIDC scopes (openid/profile) neither satisfy nor trigger the
  // check, and a token with no gateway-hop scope is enforced exactly as before.
  const hasGatewayHopScope = GATEWAY_HOP_SCOPES.some((s) => grantedScopes.has(s));
  const topologyScopes = new Set(scopeTopology.allowedScopes());
  const suppliesPerToolScopes = [...grantedScopes].some(
    (s) => topologyScopes.has(s) && !GATEWAY_HOP_SCOPES.includes(s)
  );
  const skipPerToolScopeCheck = hasGatewayHopScope && !suppliesPerToolScopes;
  if (skipPerToolScopeCheck) {
    log(`[AuthzServer/decision] Rule 3 bypass — gateway-hop scope only, no per-tool scopes to enforce (tool="${ToolName}")`);
  }
  if (!skipPerToolScopeCheck && requiredScopes.length > 0) {
    const missing = requiredScopes.filter(s => !grantedScopes.has(s));
    if (missing.length > 0) {
      warn(`[AuthzServer/decision] DENY — missing scopes: ${missing.join(', ')}`);
      return deny(res, `insufficient_scope: missing ${missing.join(', ')}`);
    }
  }

  // ── Rule 3.5a: resource-ownership check (NNP-3, UC10) ────────────────────
  // When the caller provides ResourceOwnerId (the userId who owns the target
  // resource), the policy DENYs if it does not match the requesting user (ClientId).
  // This is the control that catches the Meta-chatbot attack: an agent asked to
  // modify account X while authenticated as user Y is blocked.
  // Parity with simulatedAuthorizeService.js evaluateMcpFirstTool:307-328.
  if (ResourceOwnerId && ClientId && ResourceOwnerId !== ClientId) {
    warn(`[AuthzServer/decision] DENY — resource_owner_mismatch: owner="${ResourceOwnerId}" requester="${ClientId}"`);
    return deny(res,
      `resource_owner_mismatch: target resource belongs to "${ResourceOwnerId}" but request made by "${ClientId}". ` +
      `Possible cross-user resource access (account-takeover pattern).`
    );
  }

  // ── Rule 3.5b: group-membership check (NNP-2, UC9) ───────────────────────
  // When RequiredGroup is set, UserGroups must be present and include the group.
  // Absent/empty UserGroups with RequiredGroup set → DENY (fail closed).
  // Malformed JSON → DENY. Parity with simulatedAuthorizeService when the BFF
  // always supplies both parameters together under ff_authorize_group_policy.
  if (RequiredGroup) {
    let parsedGroups = null;
    if (!UserGroups && UserGroups !== 0) {
      warn(`[AuthzServer/decision] DENY — missing_user_groups: RequiredGroup="${RequiredGroup}" sub="${ClientId}"`);
      return deny(res,
        `missing_user_groups: RequiredGroup "${RequiredGroup}" was set but UserGroups is absent`
      );
    }
    if (Array.isArray(UserGroups)) {
      parsedGroups = UserGroups;
    } else {
      try {
        parsedGroups = JSON.parse(UserGroups);
      } catch {
        warn(`[AuthzServer/decision] DENY — malformed_user_groups: RequiredGroup="${RequiredGroup}" sub="${ClientId}"`);
        return deny(res,
          `malformed_user_groups: RequiredGroup "${RequiredGroup}" was set but UserGroups is not valid JSON`
        );
      }
    }
    if (!Array.isArray(parsedGroups)) {
      warn(`[AuthzServer/decision] DENY — malformed_user_groups: RequiredGroup="${RequiredGroup}" sub="${ClientId}"`);
      return deny(res,
        `malformed_user_groups: RequiredGroup "${RequiredGroup}" was set but UserGroups is not an array`
      );
    }
    if (!parsedGroups.includes(RequiredGroup)) {
      warn(`[AuthzServer/decision] DENY — user_not_in_group: required="${RequiredGroup}" userGroups=[${parsedGroups.join(',')}] sub="${ClientId}"`);
      return deny(res,
        `user_not_in_group: tool "${ToolName}" requires membership in "${RequiredGroup}" ` +
        `but user "${ClientId}" is in [${parsedGroups.join(', ') || 'none'}].`
      );
    }
  }

  // ── Rule 3b: Hard-DENY amount ceiling (NNP-5 parity fix) ────────────────────────────────────────
  // Parity with simulatedAuthorizeService.js evaluateMcpFirstTool (line 403):
  // amounts above the absolute deny ceiling are always DENY, regardless of
  // HITL approval or step-up. This is NNP-5 — the mock was missing this rule.
  // Reads the same env var the simulated engine uses (default 2000).
  const isWriteTool = ruleStore.isWriteTool(ToolName);
  if (TransactionAmount !== '' && isWriteTool) {
    const DENY_CEILING_USD = parseFloat(process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT || '2000');
    const txAmount = parseFloat(TransactionAmount);
    if (!isNaN(txAmount) && txAmount > DENY_CEILING_USD) {
      warn(`[AuthzServer/decision] DENY — amount_exceeds_ceiling: $${txAmount} > $${DENY_CEILING_USD}`);
      return deny(res, `amount_exceeds_ceiling: $${txAmount} exceeds the absolute deny limit of $${DENY_CEILING_USD}`);
    }
  }

  // ── Rule 3c: RAR amount/payee enforcement (NNP-1, UC14) ─────────────────────────────────────────
  // When ff_rar is on, enforce the attested authorization_details from the TraT's azd field.
  // RarAuthorizationDetails arrives as a JSON string (serialised by the BFF before placing it
  // into the PingOne Authorize params map). Parse it and enforce the attested amount / payee
  // from the FIRST element (the governing intent). The enforced values come from this attested
  // param — NOT from the caller's request body (a caller-supplied body amount must never
  // relax the granted limit). Parity: same logic as simulatedAuthorizeService.js RAR guard.
  // Field contract (production names from buildRarAuthorizationDetails): `amount` is the
  // granted ceiling; `payee` is the permitted destination (single string or array).
  if (process.env.FF_RAR === 'true' && RarAuthorizationDetails) {
    let rarArr;
    try { rarArr = JSON.parse(RarAuthorizationDetails); } catch (_) { rarArr = null; }
    if (Array.isArray(rarArr) && rarArr.length > 0) {
      const rar = rarArr[0]; // first detail is the governing intent
      // `amount` is the attested ceiling (production field name from buildRarAuthorizationDetails).
      const grantedMax = rar.amount != null ? parseFloat(rar.amount) : null;
      // `payee` may be a single string or array; normalise to array for uniform checking.
      const permittedPayees = rar.payee != null
        ? (Array.isArray(rar.payee) ? rar.payee : [String(rar.payee)])
        : null;
      const txAmount = TransactionAmount !== '' ? parseFloat(TransactionAmount) : null;
      // Fail closed: when the grant caps amount, an absent/NaN actual amount is REJECTED.
      // Parity with rarEnforce.ts enforceRarSubset (gateway).
      if (grantedMax !== null && (txAmount === null || Number.isNaN(txAmount) || txAmount > grantedMax)) {
        const displayAmount = (txAmount === null || Number.isNaN(txAmount)) ? '(missing/invalid)' : `$${txAmount}`;
        warn(`[AuthzServer/decision] DENY — rar_amount_exceeded: ${displayAmount} > granted max $${grantedMax}`);
        return deny(res, `rar_amount_exceeded: transaction ${displayAmount} exceeds RAR-granted ceiling $${grantedMax}`);
      }
      // Fail closed: when the grant restricts payee, an absent/empty payee is REJECTED.
      // Parity with rarEnforce.ts enforceRarSubset (gateway).
      if (permittedPayees !== null && (!ToAccountId || !permittedPayees.includes(String(ToAccountId)))) {
        warn(`[AuthzServer/decision] DENY — rar_payee_not_permitted: payee ${ToAccountId || '(missing)'} not in [${permittedPayees.join(',')}]`);
        return deny(res, `rar_payee_not_permitted: payee ${ToAccountId || '(missing)'} not in permitted list`);
      }
    }
  }

  // ── Rule 3d: Entitlement-tier capability (NNP-8, UC21) ──────────────────────────────────────────
  // When ff_authorize_group_policy is on, the user's PingOne group determines their
  // capability tier: PrivateBanking members get a $50k ceiling and all tools; Standard
  // members are blocked from privateBankingOnlyTools and capped at $2k.
  //
  // Rule ordering: fires AFTER Rule 3b (global hard-deny ceiling) and Rule 3c (RAR).
  // The global ceiling always takes precedence — a $2,001 transaction hits Rule 3b first
  // (amount_exceeds_ceiling) regardless of tier. The tier limit fires when the amount is
  // above the TIER ceiling but below the GLOBAL ceiling — the distinct deny reason teaches
  // the viewer about per-tier limits.
  //
  // Parity: simulatedAuthorizeService.js tier guard (after group guard, before UC16 guard)
  // mirrors this block exactly.
  // Accepts BOTH tool-call contexts (see Rule 2.5) — the BFF's 'McpFirstTool'
  // calls previously skipped the entire tier check.
  if (process.env.FF_AUTHORIZE_GROUP_POLICY === 'true' && MCP_TOOL_CALL_CONTEXTS.has(DecisionContext)) {
    const userTier = _resolveUserTier(UserGroups);
    const tierConfig = NNP8_TIER_POLICY[userTier] || NNP8_TIER_POLICY[NNP8_DEFAULT_TIER];
    // (a) Tool restriction: privateBankingOnlyTools are denied for non-PrivateBanking tiers.
    if (tierConfig.privateBankingOnlyTools.length > 0 &&
        tierConfig.privateBankingOnlyTools.includes(ToolName)) {
      warn(`[AuthzServer/decision] DENY — tier_tool_not_allowed: tool "${ToolName}" requires PrivateBanking tier (user tier=${userTier})`);
      return deny(res, `tier_tool_not_allowed: tool "${ToolName}" is restricted to PrivateBanking members (user tier: ${userTier})`);
    }
    // (b) Amount ceiling: write tools over the tier's max are denied.
    if (isWriteTool && TransactionAmount !== '') {
      const txAmt = parseFloat(TransactionAmount);
      if (!Number.isNaN(txAmt) && txAmt > tierConfig.maxAmountUsd) {
        warn(`[AuthzServer/decision] DENY — tier_amount_exceeded: $${txAmt} > tier "${userTier}" ceiling $${tierConfig.maxAmountUsd}`);
        return deny(res, `tier_amount_exceeded: $${txAmt} exceeds the "${userTier}" tier ceiling of $${tierConfig.maxAmountUsd}`);
      }
    }
  }

  // ── Rule 4: HITL — STEP_UP vs HITL_CONSENT (NNP-6 parity fix) ───────────────────────
  // Parity with simulatedAuthorizeService.js (evaluateMcpFirstTool:427-461).
  // Two-tier: STEP_UP wins over HITL_CONSENT (highest-gate-wins).
  //
  // IMP-3 (SECURITY): STEP_UP fires regardless of hitlApproved — a HITL receipt
  // can NEVER satisfy MFA. Only HITL_CONSENT is dischargeable by the receipt.
  // Matches sim engine: STEP_UP candidate pushed with no hitlApproved guard
  // (line 440: `if (amount >= stepUpAmount && !acrStrong)`).
  //
  // IMP-1 (ACR bypass): read Acr from params and skip both candidates when the
  // session ACR is already strong — matches sim engine line 427 acrLooksStrong.
  //
  // IMP-2 (legacy env alias): step-up threshold falls back to the legacy alias
  // SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT — matches sim engine getStepUpAmountUsd.
  {
    const Acr = params.Acr || '';
    const acrStrong = acrLooksStrong(Acr);
    const amount = parseFloat(TransactionAmount) || 0;
    const hasAmount = TransactionAmount !== '';
    // IMP-2: canonical var first, legacy alias second — mirrors getStepUpAmountUsd()
    const STEP_UP_AMOUNT = parseFloat(
      process.env.SIMULATED_AUTHORIZE_STEPUP_AMOUNT ||
      process.env.SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT ||
      '500'
    );
    const CONFIRM_AMOUNT = parseFloat(process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT || '250');
    // Amount-bearing write tool over step-up threshold -> STEP_UP (MFA required).
    // IMP-3: NOT guarded by hitlApproved; IMP-1: guarded by !acrStrong.
    const overStepUp = isWriteTool && hasAmount && amount >= STEP_UP_AMOUNT && !acrStrong;
    // Amount-bearing write tool over confirm threshold but under step-up -> HITL_CONSENT.
    // IMP-1: guarded by !acrStrong (ACR bypass); IMP-3: guarded by !hitlApproved (receipt discharge).
    const overConfirm = isWriteTool && hasAmount && amount >= CONFIRM_AMOUNT && amount < STEP_UP_AMOUNT && !acrStrong && !hitlApproved;
    // No-amount tool that DECLARES a challengeType in the SoT. The P1AZ snapshot
    // distinguishes RequiresMcpStepUp (step_up tools) from RequiresHitlConsent
    // (consent tools) by tool NAME — so this branch must NOT collapse both into
    // HITL_CONSENT (was: single `declaresChallenge`).
    //   - step_up tool: STEP_UP, discharged only by a strong ACR. A HITL receipt
    //     can NEVER satisfy MFA (IMP-3), so it is NOT guarded by hitlApproved.
    //   - consent tool: HITL_CONSENT, dischargeable by a verified receipt.
    const declaresStepUp = !hasAmount && scopeTopology.isStepUpTool(ToolName) && !acrStrong;
    const declaresConsent =
      !hasAmount && !scopeTopology.isStepUpTool(ToolName) &&
      ruleStore.hasChallengeType(ToolName) && !acrStrong && !hitlApproved;
    if (overStepUp || declaresStepUp) {
      log(`[AuthzServer/decision] INDETERMINATE — STEP_UP: "${ToolName}" amount=$${amount} declaresStepUp=${declaresStepUp}`);
      return indeterminate(res, 'STEP_UP', 'step-up-required');
    }
    if (overConfirm || declaresConsent) {
      log(`[AuthzServer/decision] INDETERMINATE — HITL_CONSENT: "${ToolName}" amount=$${amount} confirm=$${CONFIRM_AMOUNT} declaresConsent=${declaresConsent}`);
      // Cloud parity: the snapshot splits these into two statements —
      // tool-name-driven consent ("MCP Require HITL Consent for sensitive tools")
      // emits HITL, while the amount-threshold rule ("Require Consent for
      // Mid-Value Transactions") emits HITL_CONSENT. `reason` stays HITL_CONSENT
      // for both, unchanged. The two branches are mutually exclusive:
      // declaresConsent requires !hasAmount, overConfirm requires hasAmount.
      return indeterminate(res, 'HITL_CONSENT', declaresConsent ? 'HITL' : 'HITL_CONSENT');
    }
  }

  // ── Rule 4a: Intent token — deny if a token was PRESENTED but is TAMPERED ──────
  // IntentTokenValid='false' means the gateway received an intent token and
  // validation failed. A tampered/forged token (bad signature, malformed) must
  // fail CLOSED — otherwise an attacker strips intent binding by corrupting the
  // token (valid+enforced downgraded to invalid+ignored), defeating the whole
  // control. A BENIGN 'expired' failure (the 5-min TTL lapsed mid agent-run) and
  // an absent token (IntentTokenValid='') are allowed through — IT is opt-in and
  // the mock cannot re-mint an expired token. Only present-and-tampered denies.
  const INTENT_TAMPER_ERRORS = new Set(['malformed', 'invalid_signature', 'malformed_payload']);
  if (IntentTokenValid === 'false' && INTENT_TAMPER_ERRORS.has(asStr(IntentTokenError))) {
    warn(`[AuthzServer/decision] DENY — intent token tampered: error="${IntentTokenError}" tool="${ToolName}" jti=${IntentJti}`);
    return deny(res, `intent_token_invalid: presented intent token failed validation (${IntentTokenError})`);
  }

  // ── Rule 4b: Intent token — deny if token is present but tool is not permitted ─
  // IntentTokenValid=true means a signed IT was validated by the gateway.
  // If the token is valid but the tool is NOT in permitted_tools, deny immediately.
  // An absent token (IntentTokenValid='') is allowed — IT is opt-in via FF.
  if (IntentTokenValid === 'true' && IntentMatchesTool === 'false') {
    warn(`[AuthzServer/decision] DENY — intent mismatch: tool="${ToolName}" not in permitted_tools for intent="${IntentIntent}" jti=${IntentJti}`);
    return deny(res, `intent_mismatch: tool "${ToolName}" not permitted for intent "${IntentIntent}"`);
  }

  // ── PERMIT ────────────────────────────────────────────────────────────────
  log(`[AuthzServer/decision] PERMIT — tool="${ToolName}" actor="${ActClientId}"`);
  return permit(res, 'all policy rules passed');
};

/**
 * Returns true when the session ACR value indicates the user has already
 * completed a strong authentication factor (MFA / passkey / FIDO2).
 * Copied verbatim from simulatedAuthorizeService.js:acrLooksStrong so the
 * mock and live engine share identical ACR bypass semantics (IMP-1 parity).
 */
function acrLooksStrong(acr) {
  if (acr == null || acr === '') return false;
  const s = String(acr).toLowerCase();
  // Do NOT treat bare "http" as strong — URI-shaped ACRs like "http-only" would
  // otherwise bypass STEP_UP / HITL_CONSENT. Match MFA / FIDO / passkey only.
  return s.includes('mfa') || s.includes('multi') || s.includes('fido') || s.includes('passkey');
}

/**
 * Build the cloud-shaped `statements` array for a decision.
 *
 * IMPORTANT: the entries carry ONLY `code`. The shared classifier
 * (demo_api_server/services/authorizeObligations.js classifyObligation) reads
 * `String(ob.type || ob.id || ob.code)` — an `id` or `type` field would SHADOW
 * the code, classify to null, and silently defeat every step-up/HITL gate.
 */
function statementsFor(code) {
  return [{ code }];
}

/** Map a deny reason to its cloud statement code (prefix lookup, shared default). */
function denyCodeFor(reason) {
  const prefix = String(reason || '').split(':')[0].trim();
  return DENY_CODE_BY_REASON_PREFIX[prefix] || DEFAULT_DENY_CODE;
}

function permit(res, reason) {
  res.json({
    decision: 'PERMIT', reason,
    statements: statementsFor('mcp-tool-authorized'),
    policy_source: POLICY_SOURCE,
    decision_id: randomId(), policy_version: 'mock-v1',
  });
}

function permitWithAdvice(res, reason, advice) {
  res.json({
    decision: 'PERMIT', reason, advice,
    statements: statementsFor('mcp-tool-authorized'),
    policy_source: POLICY_SOURCE,
    decision_id: randomId(), policy_version: 'mock-v1',
  });
}

function deny(res, reason, code) {
  auditDecision('DENY', reason);
  res.json({
    decision: 'DENY', reason,
    statements: statementsFor(code || denyCodeFor(reason)),
    policy_source: POLICY_SOURCE,
    decision_id: randomId(), policy_version: 'mock-v1',
  });
}

function indeterminate(res, reason, code) {
  auditDecision('INDETERMINATE', reason);
  res.json({
    decision: 'INDETERMINATE', reason,
    statements: statementsFor(code),
    policy_source: POLICY_SOURCE,
    decision_id: randomId(), policy_version: 'mock-v1',
  });
}
