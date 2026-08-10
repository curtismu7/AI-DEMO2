'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');
const oauthService = require('./oauthService');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');
const { resolveExpectedMcpResourceUri } = require('./mcpToolAuthorizationService');
const { decodeJwt } = require('../utils/tokenUtils');
const configStore = require('./configStore');

const VERTICAL_ID = 'pingone-admin';
const GROUP_CATEGORY = 'privileged';

async function checkAccess({ username, pingOneUserId, accessToken }) {
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
  let finalToken;
  try {
    const aiAgentActorClientId = configStore.getEffective('pingone_ai_agent_actor_client_id');
    const aiAgentActorClientSecret = configStore.getEffective('pingone_ai_agent_actor_client_secret');
    const hop1Token = await oauthService.performTokenExchangeAs(
      accessToken, null, aiAgentActorClientId, aiAgentActorClientSecret,
      intermediateAud, ['read'], 'post',
    );

    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
    const exchangerClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
    finalToken = await oauthService.performTokenExchangeAs(
      hop1Token, null, exchangerClientId, exchangerClientSecret,
      mcpResourceUri, ['read'], 'post',
    );
  } catch (err) {
    console.warn('[pingOneAdminAccessService] MCP token exchange failed (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

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
  try {
    ({ decision, policyNotFound } = await pingOneAuthorizeService.evaluateMcpToolDelegation({
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
