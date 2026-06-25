/**
 * simulatedAuthorizeService.js
 *
 * Local "policy decision" that mimics PingOne Authorize **response shape** for demos and
 * user education when PingOne Authorize is not configured (or `ff_authorize_simulated` is on).
 *
 * Does **not** call PingOne. Returns the same fields as `pingOneAuthorizeService.evaluateTransaction`:
 *   { decision, stepUpRequired, path, decisionId, raw }
 *
 * UC21 Tier Enforcement (entitlement tiers):
 *   - Reads tier config from active vertical's manifest (tierResolver.js)
 *   - Denies: amount > tier.maxAmountUsd (Standard=$2000, PrivateBanking=$50000)
 *   - Denies: tool in tier.restrictedTools (Standard denies create_withdrawal)
 *   - See: docs/pingauthorize-tier-parity.md for PingOne Authorize policy parity
 *
 * Other rules:
 *   - Step-up obligation: amount >= SIMULATED_POLICY_STEPUP_USD (default 500) for withdrawal
 *   - Transfer: all transfers require human consent (HITL_CONSENT obligation)
 *   - Otherwise PERMIT
 *
 * @module services/simulatedAuthorizeService
 */

'use strict';

const configStore = require('./configStore');
const { classifyObligations } = require('./authorizeObligations');
const scopeTopology = require('./scopeTopology');

// Guard: prevent accidental use in production without an explicit opt-in.
// The feature-flag check (ff_authorize_simulated) at the caller layer is the primary gate,
// but a direct import of this module would bypass it. This secondary guard makes that impossible.
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_AUTHORIZE !== 'true') {
  throw new Error(
    '[simulatedAuthorizeService] Cannot be loaded in production without ALLOW_SIMULATED_AUTHORIZE=true. ' +
    'Use pingOneAuthorizeService instead.'
  );
}

/** Hard deny above this amount (USD) — lazy read from configStore, falls back to env, then default. */
function getDenyAmountUsd() {
  return parseFloat(
    configStore.get('SIMULATED_AUTHORIZE_DENY_AMOUNT') ||
    process.env.SIMULATED_AUTHORIZE_DENY_AMOUNT ||
    '2000'
  );
}

/**
 * Confirm threshold (USD) — requires explicit consent only (no MFA).
 *
 * `SIMULATED_AUTHORIZE_CONFIRM_AMOUNT` is the AS's CANONICAL input key. Both
 * admin surfaces fan a user-entered value into it: the dedicated Authorize
 * config (routes/authorizeConfig.js, writes it directly) AND the Setup page /
 * Demo Controls control button (routes/thresholds.js mirror-writes it
 * alongside the HITL `confirm_threshold_usd` key the consent path reads). So
 * editing EITHER surface changes this getter, and all runtime decisions flow
 * from the AS response only. `get()` (raw cache) is used deliberately — not
 * `getEffective()`, which would mask an unset key with the FIELD_DEFS default
 * and make the env fallback dead code.
 */
function getConfirmAmountUsd() {
  return parseFloat(
    configStore.get('SIMULATED_AUTHORIZE_CONFIRM_AMOUNT') ||
    process.env.SIMULATED_AUTHORIZE_CONFIRM_AMOUNT ||
    '250'
  );
}

/**
 * Step-up threshold (USD) — requires consent + MFA.
 *
 * `SIMULATED_AUTHORIZE_STEPUP_AMOUNT` is the AS's CANONICAL input key. Both
 * admin surfaces fan into it (authorizeConfig.js direct; thresholds.js
 * mirror-writes it next to the HITL `mfa_threshold_usd` key). Same
 * single-source-of-truth + raw-`get()` rationale as getConfirmAmountUsd.
 */
function getStepUpAmountUsd() {
  return parseFloat(
    configStore.get('SIMULATED_AUTHORIZE_STEPUP_AMOUNT') ||
    process.env.SIMULATED_AUTHORIZE_POLICY_STEPUP_AMOUNT ||
    '500'
  );
}

/** Transaction types that always require consent (comma-separated, e.g., "transfer,withdrawal"). */
function getConsentTypes() {
  const raw = configStore.get('SIMULATED_AUTHORIZE_CONSENT_TYPES') ||
              process.env.SIMULATED_AUTHORIZE_CONSENT_TYPES ||
              'transfer';
  return new Set(
    raw
      .split(',')
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(Boolean)
  );
}

/** Transaction types that always require step-up (comma-separated, e.g., "withdrawal"). */
function getStepUpTypes() {
  const raw = configStore.get('SIMULATED_AUTHORIZE_STEPUP_TYPES') ||
              process.env.SIMULATED_AUTHORIZE_STEPUP_TYPES ||
              '';
  return new Set(
    raw
      .split(',')
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(Boolean)
  );
}

let _seq = 0;

/** Ring buffer of recent simulated decisions (education / parity with PingOne recent decisions). */
const SIMULATED_RECENT_MAX = 50;
let _recentSimulated = [];

/**
 * Trust Framework parameters — same keys as PingOne decision endpoint POST body (Phase 2).
 * @see pingOneAuthorizeService._evaluateViaDecisionEndpoint
 */
function buildTrustFrameworkParameters(userId, amount, type, acr) {
  return {
    Amount: Number(amount),
    TransactionType: type,
    UserId: userId,
    ...(acr ? { Acr: acr } : {}),
    Timestamp: new Date().toISOString(),
  };
}

function recordSimulatedDecision(entry) {
  _recentSimulated = [{ ...entry, recordedAt: new Date().toISOString() }, ..._recentSimulated].slice(
    0,
    SIMULATED_RECENT_MAX
  );
}

/** Tools denied in simulated MCP first-tool policy (comma-separated env). */
function _simulatedMcpDenyToolSet() {
  const raw = process.env.SIMULATED_MCP_DENY_TOOLS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Tools requiring HITL approval in simulated MCP first-tool policy (comma-separated env). */
function _simulatedMcpHitlToolSet() {
  const raw = process.env.SIMULATED_MCP_HITL_TOOLS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Simulated PingOne Authorize for MCP tool calls (DecisionContext=McpToolCall).
 * Runs on every tool call. Evaluates:
 *   1. Tool-name DENY/HITL overrides (SIMULATED_MCP_DENY_TOOLS / SIMULATED_MCP_HITL_TOOLS)
 *   2. Amount-based rules for write tools (same thresholds as evaluateTransaction)
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.toolName
 * @param {string} [params.tokenAudience]
 * @param {string} [params.actClientId]
 * @param {string} [params.nestedActClientId]
 * @param {string} [params.mcpResourceUri]
 * @param {string} [params.acr]
 * @param {number|null} [params.amount] - populated for write tools (create_transfer, etc.)
 * @param {string|null} [params.transactionType] - 'transfer' | 'deposit' | 'withdrawal' | null
 * @param {string|null} [params.resourceOwnerId] - userId who owns the target resource;
 *   when set the policy DENYs if it does not match userId (resource ownership check).
 *   This is the control that catches the Meta-chatbot attack pattern: an agent asked to
 *   change the email on an account belonging to a different user.
 */
async function evaluateMcpFirstTool({
  userId,
  toolName,
  tokenAudience,
  actClientId,
  nestedActClientId,
  mcpResourceUri,
  acr,
  amount = null,
  transactionType = null,
  // HITL receipt (Phase: receipt-aware PERMIT). When the BFF/gateway has
  // verified an approved, caller-bound HITL challenge for THIS tool call, it
  // sets hitlApproved=true. A verified receipt discharges ONLY the
  // HITL_CONSENT gate — never STEP_UP (an approval is not an MFA) and never the
  // audience-mismatch / deny gates (those run first, below). This engine trusts
  // the boolean; provenance is bound by the caller's verifyHitlReceipt. The
  // live PingAuthorize path must apply the SAME rule (parity invariant).
  hitlApproved = false,
  resourceOwnerId = null,
  // Group-membership policy (Scenario 1). requiredGroup is the group the tool
  // demands; userGroups is the requesting user's membership list. Both are
  // resolved by the caller (mcpToolAuthorizationService via groupPolicy) only
  // when ff_authorize_group_policy is on; null/absent otherwise → guard skipped.
  requiredGroup = null,
  userGroups = null,
  // RAR enforcement (NNP-1, UC14). Attested values extracted from the TraT's azd
  // field by the caller (mcpToolAuthorizationService). Never sourced from the
  // request body — a caller-supplied body amount must NOT relax the granted limit.
  // Field contract (production names from buildRarAuthorizationDetails): `amount`
  // → rarMaxAmount (ceiling), `payee` → rarPermittedPayees (normalised to array).
  rarMaxAmount = null,       // granted ceiling from RAR intent (azd.authorization_details[0].amount)
  rarPermittedPayees = null, // allowed payee list from RAR intent (azd.authorization_details[0].payee, normalised to array)
  toAccountId = null,        // payee from the tool call params (checked against rarPermittedPayees)
}) {
  const decisionId = `sim-mcp-${Date.now()}-${++_seq}`;
  const parameters = {
    DecisionContext: 'McpToolCall',
    UserId: userId,
    ToolName: toolName || '',
    TokenAudience: tokenAudience != null ? String(tokenAudience) : '',
    ActClientId: actClientId || '',
    NestedActClientId: nestedActClientId || '',
    McpResourceUri: mcpResourceUri || '',
    ...(acr ? { Acr: acr } : {}),
    ...(transactionType ? { TransactionType: transactionType } : {}),
    ...(amount != null ? { Amount: amount } : {}),
    ...(hitlApproved ? { HitlApproved: true } : {}),
    ...(resourceOwnerId ? { ResourceOwnerId: resourceOwnerId } : {}),
    ...(requiredGroup ? { RequiredGroup: requiredGroup } : {}),
    ...(Array.isArray(userGroups) ? { UserGroups: userGroups } : {}),
    Timestamp: new Date().toISOString(),
  };

  const denySet = _simulatedMcpDenyToolSet();
  const denied = toolName && denySet.has(toolName);
  const hitlSet = _simulatedMcpHitlToolSet();
  const hitlRequired = toolName && hitlSet.has(toolName);

  const rawBase = {
    engine: 'simulated',
    requestShape: 'decision-endpoint',
    kind: 'mcp_tool_call',
    parameters,
    educationNote:
      'Simulated MCP tool-call policy — runs on every tool call. ' +
      'Set SIMULATED_MCP_DENY_TOOLS to force DENY; SIMULATED_MCP_HITL_TOOLS for HITL.',
  };

  // ── Audience-match guard (highest-priority deny — runs before tool-name checks).
  //
  // The bearer token's `aud` MUST equal the audience the BFF's single RFC 8693
  // exchange minted (the MCP-gateway URI when the gateway is the egress, else
  // the MCP-server URI). Caller (mcpToolAuthorizationService) resolves it via
  // the shared resolveExchangeAudience() and passes it as `mcpResourceUri`. If
  // the token aud doesn't match, an attacker may have sent an intermediate
  // (e.g. actor-CC) token directly to MCP (skipping the gateway hop).
  //
  // Both the simulated AS (this file) and the PingOne PingAuthorize policy
  // enforce this rule — they receive the same inputs and must agree on the
  // same outputs (parity is a design requirement; ff_authorize_simulated
  // picks which one runs at runtime).
  if (mcpResourceUri && tokenAudience) {
    const tokenAudList = String(tokenAudience).split(/[\s,]+/).filter(Boolean);
    const expected = String(mcpResourceUri).trim();
    if (!tokenAudList.includes(expected)) {
      const out = {
        decision: 'DENY',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId,
        raw: {
          ...rawBase,
          decision: 'DENY',
          reason:
            `Audience mismatch — token aud=${JSON.stringify(tokenAudList)} does not include expected ` +
            `${JSON.stringify(expected)}. Possible step-skipping (token not from final exchange step).`,
        },
      };
      recordSimulatedDecision(out);
      return out;
    }
  }

  // ── A2A delegation guard (act-chain decision; no may_act).
  //
  // Sensitive tools flagged a2aDelegated in the SoT are reachable ONLY via specialist
  // delegation: the token's act chain must show a specialist delegated by the generalist
  // (act:{specialist, act:{generalist}} → nestedActClientId present, depth >= 2). The
  // generalist's own token has act depth 1 (nestedActClientId absent) and is DENIED — it
  // must delegate. Mirrors demo_authz_server Rule 1c (parity invariant).
  if (toolName && scopeTopology.isA2aDelegatedTool(toolName) && !nestedActClientId) {
    const out = {
      decision: 'DENY',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'DENY',
        reason:
          `a2a_delegation_required: "${toolName}" must be delegated to a specialist agent ` +
          `(act chain shows no specialist — depth < 2). The generalist cannot call it directly.`,
      },
    };
    recordSimulatedDecision(out);
    return out;
  }

  // ── Resource ownership guard.
  //
  // When the caller provides resourceOwnerId (the userId who owns the target resource),
  // the policy DENYs if it does not match the requesting user's id. This is the control
  // that catches the Meta-chatbot attack pattern: an agent asked to change the email on
  // account X while authenticated as user Y — the account owner does not match the
  // token subject, so the request is blocked before any mutation occurs.
  if (resourceOwnerId && userId && resourceOwnerId !== userId) {
    const out = {
      decision: 'DENY',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'DENY',
        deny_reason: 'resource_owner_mismatch',
        reason:
          `Resource ownership check failed — the target resource belongs to user "${resourceOwnerId}" ` +
          `but the request was made by user "${userId}". ` +
          `This is the pattern exploited in AI support-bot account-takeover attacks (e.g. the Meta chatbot incident): ` +
          `an agent can be socially-engineered into modifying another user's account unless the authorization ` +
          `policy explicitly verifies that the requesting identity owns the target resource.`,
      },
    };
    recordSimulatedDecision(out);
    return out;
  }

  // ── Group-membership guard (Scenario 1 — Denied Access: user not in group).
  //
  // When the tool is restricted to a group and the requesting user is not a
  // member, DENY. RequiredGroup / UserGroups are supplied by the caller only
  // when ff_authorize_group_policy is on, so this guard is a no-op otherwise.
  // The live PingOne policy + demo_authz_server enforce the same rule on the
  // same parameters (parity invariant). Proves least-privilege: an authenticated
  // user with a valid token is still denied a resource their group does not grant.
  if (requiredGroup && Array.isArray(userGroups) && !userGroups.includes(requiredGroup)) {
    const out = {
      decision: 'DENY',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'DENY',
        deny_reason: 'user_not_in_group',
        reason:
          `Group membership check failed — tool "${toolName}" requires membership in ` +
          `"${requiredGroup}" but user "${userId}" is in [${userGroups.join(', ') || 'none'}]. ` +
          `Even with a valid token and the right scope, least-privilege at the authorization ` +
          `policy blocks access the user's group does not grant.`,
      },
    };
    recordSimulatedDecision(out);
    return out;
  }

  // ── Entitlement-tier capability guard (NNP-8, UC21) ──────────────────────────
  // When ff_authorize_group_policy is on, map the user's group to a capability tier
  // and enforce per-tier tool restrictions + amount ceilings.
  //
  // Fires AFTER the binary group-membership guard (UC9) so a user must first
  // pass the group gate before the tier capability is evaluated. Fires BEFORE
  // the amount-based block below so tier denials surface with a distinct reason
  // rather than the generic global-ceiling deny.
  //
  // Parity: decision.js Rule 3d mirrors this block exactly.
  const _tierFlagOn = configStore.get('ff_authorize_group_policy') === 'true'
    || configStore.get('ff_authorize_group_policy') === true;
  if (_tierFlagOn) {
    const _userTier = _resolveUserTierFromGroups(userGroups);
    const _tierConfig = NNP8_TIER_POLICY[_userTier] || NNP8_TIER_POLICY[NNP8_DEFAULT_TIER];
    // (a) Tool restriction: privateBankingOnlyTools are denied for non-PrivateBanking tiers.
    if (_tierConfig.privateBankingOnlyTools.length > 0 &&
        toolName && _tierConfig.privateBankingOnlyTools.includes(toolName)) {
      const tierToolOut = {
        decision: 'DENY',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId,
        raw: {
          ...rawBase,
          decision: 'DENY',
          deny_reason: 'tier_tool_not_allowed',
          reason:
            `UC21 entitlement-tier capability — tool "${toolName}" is restricted to PrivateBanking members. ` +
            `User tier is "${_userTier}". Positive least-privilege: group membership EXPANDS capability; ` +
            `Standard users cannot invoke high-value wire operations regardless of scope.`,
        },
      };
      recordSimulatedDecision(tierToolOut);
      return tierToolOut;
    }
    // (b) Amount ceiling: write tools over the tier's max are denied.
    if (amount !== null && amount > _tierConfig.maxAmountUsd) {
      const tierAmtOut = {
        decision: 'DENY',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId,
        raw: {
          ...rawBase,
          decision: 'DENY',
          deny_reason: 'tier_amount_exceeded',
          reason:
            `UC21 entitlement-tier capability — $${amount} exceeds the "${_userTier}" tier ceiling ` +
            `of $${_tierConfig.maxAmountUsd}. PrivateBanking members have a $50,000 ceiling; ` +
            `Standard members are capped at $${NNP8_TIER_POLICY.Standard.maxAmountUsd}.`,
        },
      };
      recordSimulatedDecision(tierAmtOut);
      return tierAmtOut;
    }
  }

  // ── UC16 guard: require act for agent-mediated tools ────────────────────────
  // When ff_require_act_for_agent_tools is ON, tools with requiresAgentMediation
  // in scope-topology.json DENY when no actClientId is present. Mirrors
  // demo_authz_server/routes/decision.js Rule 2.5 (authz-server-parity invariant).
  //
  // Parity note: decision.js Rule 2.5 guards this block with
  // `DecisionContext === 'McpToolCall'` before checking isAgentMediatedTool.
  // This function is ONLY ever called for tool-call decisions (the BFF routes
  // tools/list and chip-authorization to separate handlers), so every call here
  // is implicitly McpToolCall context. The DecisionContext guard is intentionally
  // omitted — it would always be true and would add dead-branch noise.
  const requireActFF = configStore.get('ff_require_act_for_agent_tools') === 'true'
    || configStore.get('ff_require_act_for_agent_tools') === true;
  if (requireActFF && scopeTopology.isAgentMediatedTool(toolName) && !actClientId) {
    const uc16Out = {
      decision: 'DENY',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'DENY',
        deny_reason: 'missing_act',
        reason:
          `UC16 impersonation block — tool "${toolName}" requires agent delegation (act claim). ` +
          `A no-act token erases the agent identity: only RFC 8693 OBO delegation is permitted ` +
          `for agent-mediated operations. This is the control that enforces attribution: every ` +
          `agent action must trace to both the user (sub) AND the agent (act.sub).`,
      },
    };
    recordSimulatedDecision(uc16Out);
    return uc16Out;
  }

  // ── RAR amount/payee enforcement (NNP-1, UC14) ───────────────────────────────────────────
  // Parity with demo_authz_server/routes/decision.js Rule 3c (authz-server-parity invariant).
  // Enforces the attested authorization_details from the TraT azd field. The caller
  // (mcpToolAuthorizationService) must extract rarMaxAmount / rarPermittedPayees from
  // azd.authorization_details[0] — NOT from the request body. Flag-gated; off → no-op.
  const ffRar = configStore.get('ff_rar') === 'true' || configStore.get('ff_rar') === true;
  if (ffRar) {
    if (rarMaxAmount !== null && amount !== null && !Number.isNaN(rarMaxAmount) && !Number.isNaN(amount) && amount > rarMaxAmount) {
      const rarAmountOut = {
        decision: 'DENY',
        denyReason: 'rar_amount_exceeded',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId,
        raw: {
          ...rawBase,
          decision: 'DENY',
          deny_reason: 'rar_amount_exceeded',
          engine: 'simulated',
          rule: 'NNP-1',
          reason: `RAR amount enforcement — transaction $${amount} exceeds RAR-granted ceiling $${rarMaxAmount}. ` +
            `The authorization_details in the TraT's attested azd field granted max_amount=${rarMaxAmount}. ` +
            `The agent cannot exceed the attested limit even with a valid token and correct scope.`,
          detail: `$${amount} > granted max $${rarMaxAmount}`,
        },
      };
      recordSimulatedDecision(rarAmountOut);
      return rarAmountOut;
    }
    if (rarPermittedPayees !== null && toAccountId && !rarPermittedPayees.includes(String(toAccountId))) {
      const rarPayeeOut = {
        decision: 'DENY',
        denyReason: 'rar_payee_not_permitted',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId,
        raw: {
          ...rawBase,
          decision: 'DENY',
          deny_reason: 'rar_payee_not_permitted',
          engine: 'simulated',
          rule: 'NNP-1',
          reason: `RAR payee enforcement — payee "${toAccountId}" is not in the RAR-granted permitted_payees list ` +
            `[${rarPermittedPayees.join(', ')}]. ` +
            `The authorization_details in the TraT's attested azd field restricts which payees the agent may target.`,
          detail: `payee ${toAccountId} not permitted`,
        },
      };
      recordSimulatedDecision(rarPayeeOut);
      return rarPayeeOut;
    }
  }

  let out;
  if (denied) {
    out = {
      decision: 'DENY',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'DENY',
        reason: `Simulated policy DENY: tool "${toolName}" is in SIMULATED_MCP_DENY_TOOLS.`,
      },
    };
  } else if (hitlRequired && !hitlApproved) {
    // Tool-name HITL gate, no receipt → require approval. When a verified
    // receipt is present (hitlApproved), this branch is skipped and the call
    // falls through to the shared PERMIT tail below — same candidate-suppression
    // pattern as the amount block, so the discharge logic lives in one place.
    out = {
      decision: 'INDETERMINATE',
      stepUpRequired: false,
      hitlRequired: true,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'INDETERMINATE',
        obligations: [{ type: 'HITL', detail: 'Simulated Authorize obligation — human approval required.' }],
        reason: `Simulated policy HITL: tool "${toolName}" is in SIMULATED_MCP_HITL_TOOLS.`,
      },
    };
  } else if (transactionType && amount != null) {
    // Amount-based policy for MCP write tools — highest gate wins, no stacking.
    // Type-based rules (consentTypes/stepUpTypes) do NOT apply on the MCP path.
    //   < confirmAmount   → PERMIT
    //   confirmAmount–stepUpAmount-1 → confirm only (HITL, no MFA)
    //   ≥ stepUpAmount    → step-up (MFA = consent+auth), skips confirm
    //   > denyAmount      → DENY
    const denyAmount = getDenyAmountUsd();
    const stepUpAmount = getStepUpAmountUsd();
    const confirmAmount = getConfirmAmountUsd();

    if (amount > denyAmount) {
      out = {
        decision: 'DENY',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId,
        raw: { ...rawBase, decision: 'DENY', reason: `Amount $${amount} exceeds deny limit $${denyAmount}.` },
      };
    } else {
      // Build candidate obligations from the amount thresholds, then let the
      // SHARED classifier pick the single winning gate (highest-gate-wins:
      // STEP_UP > HITL_CONSENT). This is the same classifier the PingOne path
      // and evaluateTransaction use, so the precedence rule (the H2 drift
      // point) cannot diverge between engines.
      //
      // Contract note (intentional, not drift): the classifier's canonical
      // flag for a HITL_CONSENT obligation is `consentRequired`. The MCP
      // first-tool gate's wire contract is `hitlRequired` (caller
      // mcpToolAuthorizationService returns `mcp_hitl_required`, driving the
      // BankingAgent HITL approval flow — §1 row 64). So on THIS path a
      // classifier `consentRequired` win is surfaced as `hitlRequired`. The
      // security-relevant invariant (which gate wins) is shared; only the
      // per-path flag label differs, matching each caller's expectation.
      const acrStrong = acrLooksStrong(acr);
      const mcpCandidates = [];
      // A verified HITL receipt discharges ONLY the HITL_CONSENT gate: suppress
      // the consent candidate up front so the SHARED classifier yields PERMIT
      // through the existing path. The STEP_UP candidate is still pushed and the
      // classifier's highest-gate-wins rule keeps it dominant — so a receipt can
      // NEVER satisfy MFA. This is structural (no hand-written "unreachable"
      // branch to keep true) and keeps sim/live parity on the discharge rule.
      const consentDischargedByReceipt =
        amount >= confirmAmount && !acrStrong && hitlApproved && amount < stepUpAmount;
      if (amount >= confirmAmount && !acrStrong && !hitlApproved) {
        mcpCandidates.push({ type: 'HITL_CONSENT', detail: 'Confirmation required.' });
      }
      if (amount >= stepUpAmount && !acrStrong) {
        mcpCandidates.push({ type: 'STEP_UP', detail: 'MFA required — amount exceeds step-up threshold.' });
      }
      const mcpFlags = classifyObligations(mcpCandidates);

      if (mcpFlags.stepUpRequired) {
        out = {
          decision: 'INDETERMINATE',
          stepUpRequired: true,
          hitlRequired: false,
          path: 'simulated',
          decisionId,
          raw: { ...rawBase, decision: 'INDETERMINATE', obligations: mcpCandidates, enforced: 'STEP_UP', reason: `Amount $${amount} >= step-up threshold $${stepUpAmount}.` },
        };
      } else if (mcpFlags.consentRequired) {
        out = {
          decision: 'INDETERMINATE',
          stepUpRequired: false,
          hitlRequired: true,
          path: 'simulated',
          decisionId,
          raw: { ...rawBase, decision: 'INDETERMINATE', obligations: mcpCandidates, enforced: 'HITL_CONSENT', reason: `Amount $${amount} >= confirm threshold $${confirmAmount}.` },
        };
      } else {
        out = {
          decision: 'PERMIT',
          stepUpRequired: false,
          hitlRequired: false,
          path: 'simulated',
          decisionId,
          raw: {
            ...rawBase,
            decision: 'PERMIT',
            obligations: [],
            // Audit marker: distinguish a receipt-discharged PERMIT from an
            // under-threshold PERMIT so the decision trail shows why it passed.
            ...(consentDischargedByReceipt
              ? { enforced: 'HITL_CONSENT_SATISFIED', reason: `Amount $${amount} >= confirm threshold $${confirmAmount} satisfied by approved HITL receipt.` }
              : {}),
          },
        };
      }
    }
  } else {
    out = {
      decision: 'PERMIT',
      stepUpRequired: false,
      hitlRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        ...rawBase,
        decision: 'PERMIT',
        obligations: [],
      },
    };
  }

  recordSimulatedDecision({
    decisionId: out.decisionId,
    decision: out.decision,
    stepUpRequired: out.stepUpRequired,
    hitlRequired: out.hitlRequired,
    parameters,
    path: out.path,
    kind: 'mcp_first_tool',
  });

  return out;
}

/**
 * @param {number} [limit=20]
 * @returns {object[]}
 */
function getSimulatedRecentDecisions(limit = 20) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), SIMULATED_RECENT_MAX);
  return _recentSimulated.slice(0, n);
}

/** Treat ACR as strong enough that a simulated "policy" will not ask for step-up again. */
function acrLooksStrong(acr) {
  if (acr == null || acr === '') return false;
  const s = String(acr).toLowerCase();
  return s.includes('mfa') || s.includes('multi') || s.includes('http') || s.includes('fido') || s.includes('passkey');
}

// ── NNP-8 tier policy (UC21) — entitlement-tiered capability ──────────────────
// Parity: this constant must be identical in
// demo_authz_server/routes/decision.js (Rule 3d).
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

function _resolveUserTierFromGroups(userGroups) {
  if (Array.isArray(userGroups) && userGroups.includes('PrivateBanking')) return 'PrivateBanking';
  return NNP8_DEFAULT_TIER;
}

/**
 * Evaluate transaction with simulated PingOne Authorize semantics.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {number} params.amount
 * @param {string} params.type - transfer | withdrawal | deposit
 * @param {string} [params.acr]
 * @returns {Promise<{ decision: string, stepUpRequired: boolean, path: string, decisionId: string, raw: object }>}
 */
async function evaluateTransaction({ userId, amount, type, acr }) {
  const amt = Number(amount);
  const decisionId = `sim-${Date.now()}-${++_seq}`;
  const parameters = buildTrustFrameworkParameters(userId, amt, type, acr);

  const rawBase = {
    engine: 'simulated',
    requestShape: 'decision-endpoint',
    parameters,
    educationNote:
      'This decision is produced in-process to mimic PingOne Authorize Phase 2 (parameters.*). ' +
      'Turn off Simulated Authorize in Feature Flags and configure worker + endpoint for live PingOne.',
    userId,
    amount: amt,
    type,
    acr: acr || null,
  };

  let out;

  const denyAmount = getDenyAmountUsd();
  const stepUpAmount = getStepUpAmountUsd();
  const confirmAmount = getConfirmAmountUsd();
  const consentTypes = getConsentTypes();
  const stepUpTypes = getStepUpTypes();

  var reasonParts;
  var reason;
  var typeRequiresConsent;
  var typeRequiresStepUp;
  var amountRequiresStepUp;
  var amountRequiresConsent;
  var consentApplies;
  var stepUpApplies;
  var candidateObligations;
  var flags;

  // DENY: amounts exceeding deny threshold (always checked first)
  if (amt > denyAmount) {
    out = {
      decision: 'DENY',
      stepUpRequired: false,
      consentRequired: false,
      path: 'simulated',
      decisionId,
      raw: {
        engine: 'simulated',
        decision: 'DENY',
        reason: 'Simulated policy DENY: amount exceeds $' + denyAmount.toLocaleString() + ' limit.',
      },
    };
  } else {
    // Type-based rules: check if transaction type requires consent or step-up
    typeRequiresConsent = consentTypes.has(type.toLowerCase());
    typeRequiresStepUp = stepUpTypes.has(type.toLowerCase()) && !acrLooksStrong(acr);

    // Amount-based rules: check thresholds
    amountRequiresStepUp = amt >= stepUpAmount && !acrLooksStrong(acr);
    amountRequiresConsent = amt >= confirmAmount;

    // Which obligations the rules produce (may be more than one — e.g. a
    // $600 transfer matches both consent and step-up thresholds).
    consentApplies = typeRequiresConsent || amountRequiresConsent;
    stepUpApplies = typeRequiresStepUp || amountRequiresStepUp;

    // Build the full candidate obligation list (recorded in raw for
    // education), then let the shared classifier pick the single winning
    // enforcement flag (highest-gate-wins: STEP_UP > HITL_CONSENT). This is
    // the SAME classifier the PingOne path uses — the two engines can no
    // longer disagree on what a given obligation means or which one wins.
    candidateObligations = [];
    if (consentApplies) {
      candidateObligations.push({ type: 'HITL_CONSENT', detail: 'Human approval required.' });
    }
    if (stepUpApplies) {
      candidateObligations.push({ type: 'STEP_UP', detail: 'Elevated authentication (MFA) required.' });
    }

    flags = classifyObligations(candidateObligations);

    if (flags.stepUpRequired || flags.consentRequired) {
      // Build reason message — describes every rule that fired, even though
      // only the highest gate is enforced (educational transparency).
      reasonParts = [];
      if (typeRequiresConsent) reasonParts.push('transaction type requires consent');
      if (typeRequiresStepUp) reasonParts.push('transaction type requires step-up');
      if (amountRequiresConsent && !typeRequiresConsent) reasonParts.push('amount exceeds $' + confirmAmount.toLocaleString());
      if (amountRequiresStepUp && !typeRequiresStepUp) reasonParts.push('amount exceeds $' + stepUpAmount.toLocaleString());
      reason = 'Simulated policy: ' + reasonParts.join('; ') + '.';

      out = {
        decision: 'INDETERMINATE',
        stepUpRequired: flags.stepUpRequired,
        consentRequired: flags.consentRequired,
        path: 'simulated',
        decisionId,
        raw: {
          engine: 'simulated',
          decision: 'INDETERMINATE',
          obligations: candidateObligations,
          enforced: flags.stepUpRequired ? 'STEP_UP' : 'HITL_CONSENT',
          reason: reason,
        },
      };
    } else {
      // PERMIT: no type or amount requirements
      out = {
        decision: 'PERMIT',
        stepUpRequired: false,
        consentRequired: false,
        path: 'simulated',
        decisionId,
        raw: {
          ...rawBase,
          decision: 'PERMIT',
          obligations: [],
        },
      };
    }
  }

  recordSimulatedDecision({
    decisionId: out.decisionId,
    decision: out.decision,
    stepUpRequired: out.stepUpRequired,
    consentRequired: out.consentRequired,
    parameters,
    path: out.path,
  });

  return out;
}

/**
 * Evaluate a transaction and return a response envelope byte-for-byte identical to
 * PingOne Authorize (https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-decision).
 *
 * Accepts PingOne-style body: `{ parameters: { transactionAmount, userId, transactionType } }`
 *
 * @param {{ parameters: { transactionAmount: number, userId: string, transactionType: string, acr?: string } }} body
 * @returns {Promise<object>} PingOne Authorize response envelope
 */
async function evaluate({ parameters = {} } = {}) {
  const { transactionAmount, userId, transactionType, acr } = parameters;
  const createdAt = new Date().toISOString();
  const startMs = Date.now();

  const inner = await evaluateTransaction({
    userId: userId || 'unknown',
    amount: transactionAmount || 0,
    type: transactionType || 'transfer',
    acr,
  });

  const completedAt = new Date().toISOString();
  const duration = Date.now() - startMs;

  const id = inner.decisionId || `sim-${Date.now()}`;

  if (inner.decision === 'DENY') {
    return {
      id, createdAt, completedAt, duration,
      status: 'SUCCESS',
      result: { decision: 'DENY', weight: 1.0 },
      statements: [],
      obligations: [],
    };
  }

  if (inner.stepUpRequired) {
    return {
      id, createdAt, completedAt, duration,
      status: 'SUCCESS',
      result: { decision: 'PERMIT', weight: 1.0 },
      statements: [],
      obligations: [
        { id: 'step_up_mfa', type: 'IDENTITY_REQUIREMENT', detail: { acr: 'Multi_Factor' } },
      ],
    };
  }

  return {
    id, createdAt, completedAt, duration,
    status: 'SUCCESS',
    result: { decision: 'PERMIT', weight: 1.0 },
    statements: [],
    obligations: [],
  };
}

// The three engine modes selectable via the `authorize_mode` configStore key.
const AUTHORIZE_MODES = Object.freeze(['pingone', 'simulated', 'pingone_fallback_simulated']);

// configStore is injected rather than imported at module top so callers (e.g. mcpToolAuthorizationService)
// can pass a fresh reference. This avoids a circular-require when the module is loaded early in the chain.

/**
 * Resolve the active authorization engine mode — the single source of truth for
 * "which engine evaluates" and "what to do when PingOne is unreachable".
 *
 * `authorize_mode` (when explicitly set to one of AUTHORIZE_MODES) wins. When it
 * is unset, the mode is derived from the legacy ff_authorize_simulated +
 * authorize_failover_mode flags so existing deployments keep their behaviour.
 *
 * @param {object} configStore
 * @returns {{ mode: string, useSimulated: boolean, failoverMode: 'fallback_simulated'|'deny'|'permit' }}
 */
function resolveAuthorizeMode(configStore) {
  const read = (k) => (configStore.getEffective ? configStore.getEffective(k) : configStore.get(k));
  // Legacy ff_authorize_fail_open=true maps to failover_mode=permit (back-compat).
  const legacyFailOpen = read('ff_authorize_fail_open') === 'true' || read('ff_authorize_fail_open') === true;

  const explicit = String(read('authorize_mode') || '').trim();
  if (AUTHORIZE_MODES.includes(explicit)) {
    let failoverMode;
    if (legacyFailOpen) failoverMode = 'permit';
    else if (explicit === 'pingone') failoverMode = 'deny';                       // P1 only — no demo fallback
    else if (explicit === 'pingone_fallback_simulated') failoverMode = 'fallback_simulated';
    else failoverMode = 'fallback_simulated';                                     // simulated — failover unused
    return { mode: explicit, useSimulated: explicit === 'simulated', failoverMode };
  }

  // Legacy derivation — reached only when authorize_mode resolves to a value NOT
  // in AUTHORIZE_MODES (a test store double, a bogus stored value, or a caller
  // that still drives ff_authorize_simulated directly). Against the real
  // configStore this branch is effectively dead: FIELD_DEFS defaults authorize_mode
  // to 'pingone', so getEffective() returns 'pingone' on a fresh/unset config and
  // the explicit branch above wins.
  //
  // Even via this path the steady state is strict 'pingone' (PingOne-ONLY): both
  // FIELD_DEFS defaults reinforce it — ff_authorize_simulated defaults 'false' and
  // authorize_failover_mode defaults 'deny', so an unreachable OR unconfigured
  // PingOne FAILS CLOSED (503), it does not fall back to the mock. Callers also
  // fail closed on the not-configured path (transactionAuthorizationService /
  // mcpToolAuthorizationService) so this never silently degrades to ungated. Flip
  // ff_authorize_simulated='true' (or store authorize_mode='simulated') for the
  // demo engine, or set authorize_failover_mode='fallback_simulated' to allow mock
  // fallback on a genuine outage.
  const sim = read('ff_authorize_simulated');
  const useSimulated = sim === true || sim === 'true';
  const failoverMode = legacyFailOpen ? 'permit' : (read('authorize_failover_mode') || 'fallback_simulated');
  const mode = useSimulated
    ? 'simulated'
    : (failoverMode === 'fallback_simulated' ? 'pingone_fallback_simulated' : 'pingone');
  return { mode, useSimulated, failoverMode };
}

function isSimulatedModeEnabled(configStore) {
  return resolveAuthorizeMode(configStore).useSimulated;
}

/**
 * Structured signal for the debug "PingOne Authorize fell back" modal, shared by
 * the transaction and MCP authorize services so the shape stays identical.
 * @param {string} failoverMode  resolveAuthorizeMode().failoverMode
 * @param {Error}  err           the PingOne error that triggered failover
 * @param {string} path          'transaction' | 'mcp'
 * @param {object} [extra]       extra fields to merge (e.g. { tool })
 */
function buildAuthorizeFallbackSignal(failoverMode, err, path, extra = {}) {
  return {
    occurred: true,
    attemptedEngine: 'pingone',
    failoverMode,
    effectiveAction:
      failoverMode === 'permit' ? 'permitted'
        : failoverMode === 'deny' ? 'denied'
          : 'fell_back_to_simulated',
    error: err && err.message ? err.message : String(err),
    path,
    ...extra,
  };
}

/**
 * Simulated P1AZ evaluation for AgentRestrictions gate.
 * Mirrors the policy rule: DENY if none, DENY if read+write, PERMIT otherwise.
 */
function evaluateAgentRestrictions({ agentRestrictions, requiredTier, userId, agentSub, tool }) {
  const decisionId = `sim-ar-${Date.now()}`;
  const path = 'simulated';

  if (agentRestrictions === 'none') {
    return { decision: 'DENY', reason: 'agent_restrictions_none', path, decisionId };
  }
  if (agentRestrictions === 'read' && requiredTier === 'write') {
    return { decision: 'DENY', reason: 'agent_restrictions_write_blocked', path, decisionId };
  }
  return { decision: 'PERMIT', reason: 'agent_restrictions_permitted', path, decisionId };
}

module.exports = {
  evaluate,
  evaluateTransaction,
  evaluateMcpFirstTool,
  isSimulatedModeEnabled,
  resolveAuthorizeMode,
  buildAuthorizeFallbackSignal,
  AUTHORIZE_MODES,
  getSimulatedRecentDecisions,
  buildTrustFrameworkParameters,
  getDenyAmountUsd,
  getStepUpAmountUsd,
  getConfirmAmountUsd,
  getConsentTypes,
  getStepUpTypes,
  evaluateAgentRestrictions,
  // Constant aliases for tests — read defaults so test assertions use the same values as the service.
  get SIMULATED_DENY_AMOUNT_USD() { return getDenyAmountUsd(); },
  get SIMULATED_POLICY_STEPUP_USD() { return getStepUpAmountUsd(); },
  get SIMULATED_CONFIRM_AMOUNT_USD() { return getConfirmAmountUsd(); },
};
