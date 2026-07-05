/**
 * mcpToolAuthorizationService.js
 *
 * PingOne Authorize (or simulated) on **first MCP tool use** per browser session — see
 * docs/PINGONE_AUTHORIZE_PLAN.md §7. Invoked from POST /api/mcp/tool after MCP access
 * token resolution, before the WebSocket tool call.
 */

'use strict';

const configStore = require('./configStore');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const simulatedAuthorizeService = require('./simulatedAuthorizeService');
const { decodeJwtClaims } = require('./agentMcpTokenService');
const { buildActorBridgeHeaders } = require('./mcpActorBridge');
const hitlServiceClient = require('./hitlServiceClient');
const dataStore = require('../data/store');
const groupPolicy = require('./groupPolicy');

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
 *   Two-Exchange (ff_two_exchange_delegation)     → pingone_resource_two_exchange_uri || mcp_resource_uri
 *   Single-Exchange (default)                     → mcp_resource_uri
 *
 * @returns {string} resolved resource URI, or '' when nothing is configured.
 */
function resolveExpectedMcpResourceUri() {
  // useGateway: only true when explicitly configured (env var or persisted SQLite value).
  // Intentionally excludes FIELD_DEFS defaults — a default gateway URL doesn't mean the
  // gateway is deployed, so we must not switch audience resolution based on it.
  const useGateway = !!(process.env.MCP_GATEWAY_HTTP_URL || configStore.get('mcp_gateway_http_url'));
  const usePingGateway = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
  const twoExchangeOn = configStore.getEffective('ff_two_exchange_delegation') !== 'false';

  // When routing through PingGateway (IG), the final token audience is the
  // PingGateway resource URI (https://api.ping.demo:3036/mcp), not the Node
  // gateway audience (mcpgateway.ping.demo).
  if (usePingGateway) {
    return configStore.getEffective('pingone_resource_pinggateway_uri') || process.env.PINGONE_RESOURCE_PINGGATEWAY_URI || 'https://api.ping.demo:3036/mcp';
  }
  if (useGateway) {
    return configStore.getEffective('pingone_resource_mcp_gateway_uri') || 'https://api.ping.demo:3000/mcp';
  }
  if (twoExchangeOn) {
    return configStore.getEffective('pingone_resource_two_exchange_uri') || configStore.getEffective('mcp_resource_uri') || 'https://api.ping.demo:3000/mcp';
  }
  return configStore.getEffective('mcp_resource_uri') || 'https://api.ping.demo:3000/mcp';
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
 */
function isActorBridgedMode() {
  const useGateway = !!(process.env.MCP_GATEWAY_HTTP_URL || configStore.get('mcp_gateway_http_url'));
  const usePingGateway = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
  const twoExchangeOn = configStore.getEffective('ff_two_exchange_delegation') !== 'false';
  return useGateway || usePingGateway || twoExchangeOn;
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
  create_deposit: 'deposit',
  create_withdrawal: 'withdrawal',
};

/**
 * Tools that carry a target resource identifier in their params. Returns the userId
 * who owns that resource, or null if the account cannot be found / tool does not apply.
 * Used to populate ResourceOwnerId in the authorization call so the policy can enforce
 * ownership (the Meta-chatbot attack prevention pattern).
 */
function resolveResourceOwnerId(tool, toolParams) {
  if (tool === 'update_contact_email' && toolParams && toolParams.account_id) {
    const account = dataStore.getAccountById(toolParams.account_id);
    return account ? account.userId : null;
  }
  return null;
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
async function evaluateMcpFirstToolGate({ req, tool, agentToken, userSub, userAcr, toolParams, hitlChallengeId = null }) {
  if (!agentToken || typeof agentToken !== 'string') {
    return { ran: false, reason: 'no_agent_token' };
  }

  if (req.session?.user?.role === 'admin') {
    return { ran: false, reason: 'admin_role_exempt' };
  }

  // Extract amount and transaction type from params for write-tool policy evaluation
  const transactionType = WRITE_TOOL_TYPE_MAP[tool] || null;
  const toolAmount = transactionType && toolParams
    ? parseFloat(toolParams.amount || 0)
    : null;

  const USE_SIMULATED = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);

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
  // UC21 tier (UserTier) + UC9 membership (InRequiredGroup) scalars for the live
  // PingOne path. The snapshot DSL has no array-contains, so the BFF pre-resolves
  // them here; the simulated engine still derives tier from the raw UserGroups
  // array (parity preserved by matching the resolution rule).
  let userTier = null;
  let inRequiredGroup = null;
  if (groupPolicy.isEnabled(configStore)) {
    // Resolve the user's groups whenever the policy is on (not only for
    // group-restricted tools) so the tier check can run for any tool.
    userGroups = groupPolicy.groupsForUser(req.session?.user?.username);
    // Must match simulatedAuthorizeService _resolveUserTierFromGroups:
    // PrivateBanking when a member, else the default Standard tier.
    userTier = userGroups.includes('PrivateBanking') ? 'PrivateBanking' : 'Standard';
    requiredGroup = groupPolicy.requiredGroupForTool(tool);
    if (requiredGroup) {
      inRequiredGroup = userGroups.includes(requiredGroup);
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
    resourceOwnerId,
    requiredGroup,
    userGroups,
    rarMaxAmount,
    rarPermittedPayees,
    toAccountId,
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
      console.warn(
        '[MCP Authorize] authorize_mcp_decision_endpoint_id (or worker credentials) is missing ' +
          'and failover is permit — skipping the live PingOne MCP gate.',
      );
      return { ran: false };
    }
  }

  try {
    if (runSimulated) {
      const r = await simulatedAuthorizeService.evaluateMcpFirstTool(simParams);

      if (r.stepUpRequired) {
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

      if (r.hitlRequired) {
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

    const r = await pingOneAuthorizeService.evaluateMcpToolDelegation({
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
      requiredGroup,
      userGroups,
      userTier,
      inRequiredGroup,
      // Resource-owner binding — parity with the simulated engine (simParams),
      // which enforces resource_owner_mismatch. Without this the live PingOne
      // path cannot deny a caller acting on another user's resource.
      resourceOwnerId,
      // RAR (NNP-1) parity: the simulated engine enforces rar_amount_exceeded /
      // rar_payee_not_permitted, but the live call previously omitted these inputs,
      // so the two engines disagreed. Forward the attested ceiling + permitted
      // payees + stated destination so the live PingOne policy receives identical
      // inputs (inert if the deployed policy has no RAR rule; enforced if it does).
      rarMaxAmount,
      rarPermittedPayees,
      toAccountId,
    });

    if (r.stepUpRequired) {
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
          },
        },
      };
    }

    if (r.hitlRequired) {
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
          },
        },
      };
    }

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
        // _debug.request carries method/url/body only (no worker bearer).
        request: r._debug?.request || null,
        response: r._debug?.response || r.raw || null,
      },
    };
  } catch (err) {
    if (USE_SIMULATED) {
      return { ran: true, simulatedError: err };
    }

    // PingOne engine failure — apply the configured failover policy, same as the
    // transaction path. failoverMode is derived from authorize_mode /
    // ff_authorize_fail_open via resolveAuthorizeMode (single source of truth).
    const { failoverMode } = simulatedAuthorizeService.resolveAuthorizeMode(configStore);
    const authorizeFallback = simulatedAuthorizeService.buildAuthorizeFallbackSignal(
      failoverMode, err, 'mcp', { tool });

    if (failoverMode === 'permit') {
      console.warn(`[MCP Authorize] PingOne error — fail open (failover=permit): ${err.message}`);
      return { ran: false };
    }

    if (failoverMode === 'fallback_simulated') {
      // Keep the agent demo running on a GENUINE PingOne failure: evaluate the
      // same call with the in-process simulated engine and tag the result so the
      // UI shows the "PingOne fell back" debug modal.
      console.warn(`[MCP Authorize] PingOne error — falling back to simulated engine: ${err.message}`);
      try {
        const r = await simulatedAuthorizeService.evaluateMcpFirstTool(simParams);
        if (r.stepUpRequired) {
          return { ran: true, block: { status: 428, body: {
            error: 'mcp_step_up_required',
            error_description: 'PingOne Authorize was unreachable — simulated fallback requires step-up before MCP tools.',
            authorize_engine: 'fallback_simulated',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            authorizeFallback,
          } } };
        }
        if (r.hitlRequired) {
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
    return { ran: true, pingoneError: err, authorizeFallback };
  }
}

module.exports = {
  evaluateMcpFirstToolGate,
  getMcpFirstToolGateStatus,
  resolveExpectedMcpResourceUri,
  nestedActIdFromClaim,
};
