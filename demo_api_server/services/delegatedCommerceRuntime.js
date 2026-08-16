'use strict';

const store = require('./lmdb/delegatedCommerceStore.lmdb');
const scopeTopology = require('./scopeTopology');

const credentialVault = new Map();

function holdCredentials(registrationId, credentials) {
  credentialVault.set(registrationId, { ...credentials });
}

function removeCredentials(registrationId) {
  credentialVault.delete(registrationId);
}

function resolveAgentRuntime(req, { requireActive = true, fallbackToDefault = false } = {}) {
  const registrationId = req?.session?.delegatedCommerceRegistrationId;
  if (!registrationId) return null;

  const registration = store.get(registrationId);
  const userId = req.user?.id || req.session?.user?.id || req.session?.user?.oauthId;
  if (!registration || registration.claimedByUserId !== userId) {
    const err = new Error('The delegated agent registration is not bound to this session user.');
    err.code = 'delegated_agent_binding_invalid';
    err.httpStatus = 403;
    throw err;
  }
  if (registration.expiresAt <= Date.now()) {
    const err = new Error('The delegated agent registration has expired.');
    err.code = 'delegated_agent_expired';
    err.httpStatus = 403;
    throw err;
  }
  if (requireActive && fallbackToDefault && registration.status === 'claimed') return null;
  if (requireActive && registration.status !== 'active') {
    const err = new Error('The delegated agent authorization is not active.');
    err.code = registration.status === 'revoked'
      ? 'delegated_agent_revoked'
      : 'delegated_agent_consent_required';
    err.httpStatus = 403;
    throw err;
  }

  const credentials = credentialVault.get(registrationId) || {
    clientSecret: store.decryptClientSecret(registration),
  };
  if (!credentials?.clientSecret) {
    const err = new Error('The delegated agent credential is no longer available. Register the agent again.');
    err.code = 'delegated_agent_credential_unavailable';
    err.httpStatus = 503;
    throw err;
  }

  return {
    registrationId,
    clientId: registration.applicationId,
    clientSecret: credentials.clientSecret,
    authMethod: registration.tokenEndpointAuthMethod || 'post',
    scopes: registration.scopes || [],
  };
}

function resolveConsentContext(req, tool) {
  const registrationId = req?.session?.delegatedCommerceRegistrationId;
  if (!registrationId) return null;
  const registration = store.get(registrationId);
  // Orphaned session id (admin cleanup, restart without LMDB) must not brick
  // the default banking/MCP agent path.
  if (!registration) return null;

  const userId = req.user?.id || req.session?.user?.id || req.session?.user?.oauthId;
  if (registration.claimedByUserId !== userId) return null;

  // Claimed/staged means the customer has not consented yet. Token minting
  // falls back to the configured agent (fallbackToDefault); the consent gate
  // must not 403 every MCP tool in the meantime.
  if (registration.status === 'claimed' || registration.status === 'staged') {
    return null;
  }

  const expired = registration.expiresAt <= Date.now();
  const requiredScopes = scopeTopology.toolScopes(tool)
    .filter((scope) => scope === 'read' || scope === 'write');
  const consentScopes = registration.scopes || [];
  return {
    registrationId,
    agentId: registration.applicationId || null,
    status: expired ? 'expired' : registration.status,
    consentScopes,
    requiredScopes,
    sufficient:
      registration.status === 'active' &&
      !expired &&
      requiredScopes.every((scope) => consentScopes.includes(scope)),
  };
}

module.exports = {
  holdCredentials,
  removeCredentials,
  resolveAgentRuntime,
  resolveConsentContext,
};
