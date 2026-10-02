'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');
const oauthService = require('./oauthService');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const { resolveExpectedMcpResourceUri } = require('./mcpToolAuthorizationService');
const { decodeJwt } = require('../utils/tokenUtils');
const configStore = require('./configStore');
const pfExchange = require('./pfStandardTokenExchangeService');
const { fetchPingOneUserByUsername } = require('./pingOneUserLookupService');

const VERTICAL_ID = 'pingone-admin';
const GROUP_CATEGORY = 'privileged';

/**
 * @param {Array} [p.trace] Filled with { id, label, status, decoded, explanation, extra }
 *   for each step the gate really ran, using the token-chain event ids, so the
 *   caller can show the exchange and the decision instead of leaving them blank.
 */
async function checkAccess({ username, pingOneUserId, accessToken, oauthProvider, trace = [] }) {
  const note = (id, label, status, token, explanation, extra = {}) => trace.push({
    id, label, status, decoded: token ? decodeJwt(token) : null, explanation, extra,
  });
  const viaPingFederate = oauthProvider === 'pingfederate';
  // The session token's own subject; under PingFederate that is a PingFederate
  // username, which the exchanged token must still carry.
  const tokenSubject = pingOneUserId;
  const requiredGroup = groupPolicy.groupNameForCategory(VERTICAL_ID, GROUP_CATEGORY);
  if (!requiredGroup) {
    return {
      allowed: false,
      error: 'pingone_admin_group_not_configured',
      status: 500,
      requiredGroup: null,
    };
  }
  if (!pingOneUserId || !membershipService.isReady()) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  // The group and the policy are PingOne's. A PingFederate session's subject is
  // not a PingOne user id, so the PingOne account with the same username is the
  // one checked. No such account is a denial, never a fallback to the
  // PingFederate subject.
  if (viaPingFederate) {
    const { user: linked, error: lookupError } = await fetchPingOneUserByUsername(username);
    if (!linked?.id) {
      const notFound = lookupError === 'not_found';
      return {
        allowed: false,
        error: notFound ? 'pingone_admin_user_not_linked' : 'pingone_admin_group_lookup_unavailable',
        status: notFound ? 403 : 503,
        requiredGroup,
        username,
      };
    }
    pingOneUserId = linked.id;
  }

  const groups = await membershipService.listUserGroupNamesForVertical(
    pingOneUserId,
    VERTICAL_ID,
  );
  if (!Array.isArray(groups)) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const inRequiredGroup = groups.includes(requiredGroup);

  if (!accessToken) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  // Two-hop RFC 8693 exchange — banking's own pattern, confirmed live via
  // the involved resources' actual attribute mappings (not just their code).
  // Hop 1's resource (agentgateway.ping.demo) constructs `act` from the
  // SUBJECT token's `may_act` claim; the admin's own PingOne user record
  // names the AI Agent Actor client as its permitted actor. Hop 2's
  // resource (mcpgateway.ping.demo) only PROPAGATES an existing `act` — it
  // never constructs one from a request-supplied actor_token, which is why
  // a single hop with an actor token attached (tried first, live-tested,
  // did not work) never populates `act`. See
  // docs/superpowers/specs/2026-08-10-pingone-admin-real-p1az-design.md.
  const intermediateAud = configStore.getEffective('ai_agent_intermediate_audience');
  const mcpResourceUri = resolveExpectedMcpResourceUri();
  const issuer = viaPingFederate ? 'PingFederate' : 'PingOne';
  note('user-token', 'User access token', 'active', accessToken,
    `The admin's own ${issuer} session token — the subject of exchange #1.`);
  let hop1Token;
  let finalToken;
  try {
    if (viaPingFederate) {
      // PingFederate issued the session token, so PingFederate runs both hops:
      // the same exchanger and actor clients, in the same order and with the
      // same scopes, as the agent's own tool calls (agentMcpTokenService).
      const pf = pfExchange.resolveConfig();
      const finalScopes = [configStore.getEffective('gateway_mcp_invoke_scope')
        || configStore.getEffective('pinggateway_invoke_scope')
        || 'gateway:mcp:invoke'];
      const agentActorToken = await pfExchange.getActorToken(pf, 'agent');
      note('two-ex-agent-actor', '2-Exchange #1 — AI Agent Actor Token (CC)', 'active', agentActorToken,
        'The AI Agent client\'s own client-credentials token, used as actor_token in exchange #1.');
      hop1Token = await pfExchange.performExchange(
        pf, 'agent', accessToken, agentActorToken, pf.intermediateAudience, [pf.agentActorScope],
      );
      const mcpActorToken = await pfExchange.getActorToken(pf, 'mcp');
      finalToken = await pfExchange.performExchange(
        pf, 'mcp', hop1Token, mcpActorToken, mcpResourceUri, finalScopes,
      );
      pfExchange.validateFinalToken(finalToken, {
        userSub: tokenSubject, audience: mcpResourceUri, scopes: finalScopes, issuer: pf.issuer, agentActorToken, mcpActorToken,
      });
    } else {
      const aiAgentActorClientId = configStore.getEffective('pingone_ai_agent_actor_client_id');
      const aiAgentActorClientSecret = configStore.getEffective('pingone_ai_agent_actor_client_secret');
      hop1Token = await oauthService.performTokenExchangeAs(
        accessToken, null, aiAgentActorClientId, aiAgentActorClientSecret,
        intermediateAud, ['read'], 'post',
      );

      const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
      const exchangerClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
      finalToken = await oauthService.performTokenExchangeAs(
        hop1Token, null, exchangerClientId, exchangerClientSecret,
        mcpResourceUri, ['read'], 'post',
      );
    }
  } catch (err) {
    note('exchange-failed', 'Token exchange failed', 'failed', null,
      `The PingOne Admin gate could not exchange the admin's token at ${issuer}, so access was refused.`);
    console.warn('[pingOneAdminAccessService] MCP token exchange failed (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  note('two-ex-exchange1', '2-Exchange #1 — Agent Exchanged Token', 'exchanged', hop1Token,
    `Exchange #1 at ${issuer}: the admin's token exchanged for the agent gateway audience.`);
  note('two-ex-final-token', '2-Exchange: Final MCP Token', 'exchanged', finalToken,
    `Exchange #2 at ${issuer}: the delegated token whose audience and act chain PingOne Authorize evaluates.`);

  const decoded = decodeJwt(finalToken);
  const aud = decoded?.claims?.aud;
  const tokenAudience = Array.isArray(aud) ? aud[0] : aud;
  const actClientId = decoded?.claims?.act?.sub;

  if (!tokenAudience) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  let decision;
  let policyNotFound;
  let decisionId;
  let decisionDebug;
  try {
    ({ decision, policyNotFound, decisionId, _debug: decisionDebug } = await pingOneAuthorizeService.evaluateMcpToolDelegation({
      userId: pingOneUserId,
      toolName: 'pingone_admin_access',
      verticalId: VERTICAL_ID,
      requiredGroup,
      inRequiredGroup,
      tokenAudience,
      mcpResourceUri,
      actClientId,
    }));
  } catch (err) {
    console.warn('[pingOneAdminAccessService] P1AZ evaluation error (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  if (policyNotFound) {
    console.warn('[pingOneAdminAccessService] policy_not_found for pingone_admin_access (denying)');
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const allowed = decision === 'PERMIT';
  // 'authorize-decision' is the id the token chain builds its Authorize card
  // from when a run carries no separate evaluation object.
  note('authorize-decision', 'PingOne Authorize — PingOne Admin access', allowed ? 'permit' : 'deny', null,
    `PingOne Authorize decision: ${decision}. Required group '${requiredGroup}'; `
    + `'${username}' is ${inRequiredGroup ? '' : 'not '}a member in PingOne.`,
    {
      authorizeDecision: decision,
      authorizeEngine: 'pingone',
      authorizeDecisionId: decisionId || null,
      decisionContext: 'McpToolCall',
      authorizeRequest: decisionDebug?.request || null,
      authorizeResponse: decisionDebug?.response || null,
    });
  return {
    allowed,
    error: allowed ? null : 'pingone_admin_group_required',
    status: allowed ? 200 : 403,
    requiredGroup,
    username,
    groups,
  };
}

module.exports = { checkAccess, VERTICAL_ID, GROUP_CATEGORY };
