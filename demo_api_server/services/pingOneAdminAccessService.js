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

  // The decision is made by PingOne Authorize (Scenario 1 group-policy rule),
  // not in JS — but the deployed "McpFirstTool" policy runs an audience/actor
  // check BEFORE that rule, so this call needs a REAL TokenAudience or it
  // denies everyone (see docs/superpowers/specs/2026-08-10-pingone-admin-
  // p1az-group-gate-design.md for the first, reverted attempt that omitted
  // one). This call site has no MCP-audienced token of its own, so one is
  // minted here via RFC 8693 token exchange, using the admin's own session
  // token as the subject and the already-provisioned Token Exchanger app's
  // identity as the exchanging party — no new PingOne provisioning needed.
  if (!accessToken) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const mcpResourceUri = resolveExpectedMcpResourceUri();
  let tokenAudience;
  try {
    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
    const exchangerClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
    // 'post' (client_secret_post), not the function's own 'basic' default —
    // this exchanger app's token-endpoint auth method rejects 'basic' with
    // 401 invalid_client (live-verified this session).
    const exchanged = await oauthService.performTokenExchangeAs(
      accessToken, null, exchangerClientId, exchangerClientSecret, mcpResourceUri, ['read'], 'post',
    );
    const decoded = decodeJwt(exchanged);
    const aud = decoded?.claims?.aud;
    tokenAudience = Array.isArray(aud) ? aud[0] : aud;
  } catch (err) {
    console.warn('[pingOneAdminAccessService] MCP token exchange failed (denying):', err.message);
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  if (!tokenAudience) {
    console.warn('[pingOneAdminAccessService] Exchanged token has no audience claim (denying)');
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
