'use strict';

const store = require('./lmdb/delegatedCommerceStore.lmdb');
const scopeTopology = require('./scopeTopology');

const credentialVault = new Map();

// Reduce a namespaced tool-required scope (e.g. 'sensitive:read',
// 'airlines:write', 'transfer', 'read') to the customer-consent class it
// demands. The customer's consent vocabulary is ONLY 'read' | 'write' (see
// routes/delegatedCommerce.js ALLOWED_SCOPES), so every namespaced required
// scope must be classified into one of those before comparing against consent.
// Any *:write, bare 'write', 'transfer' (money movement), or 'sensitive:*'
// (sensitive-data access) demands the 'write' class — the highest grantable
// tier — so read-only consent can never reach it. Everything else is 'read'.
// Previously the required set was filtered down to literal 'read'/'write'
// tokens, which silently dropped every namespaced scope: a tool whose scopes
// were all namespaced (e.g. airlines writes) produced an empty required set and
// [].every(...) returned true, bypassing the consent gate entirely.
function requiresWriteConsent(scope) {
  return (
    scope === 'write' ||
    scope === 'transfer' ||
    scope.endsWith(':write') ||
    scope.startsWith('sensitive:')
  );
}

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
  const requiredScopes = scopeTopology.toolScopes(tool);
  const consentScopes = registration.scopes || [];
  // Any required scope in the 'write' class means the tool needs write consent;
  // otherwise read consent is enough. Write consent implies read (it is the
  // higher-privilege class), so a write-consented agent satisfies read-only
  // tools too.
  const needsWrite = requiredScopes.some(requiresWriteConsent);
  const sufficient =
    registration.status === 'active' &&
    !expired &&
    (needsWrite
      ? consentScopes.includes('write')
      : consentScopes.includes('read') || consentScopes.includes('write'));
  return {
    registrationId,
    agentId: registration.applicationId || null,
    status: expired ? 'expired' : registration.status,
    consentScopes,
    requiredScopes,
    sufficient,
  };
}

module.exports = {
  holdCredentials,
  removeCredentials,
  resolveAgentRuntime,
  resolveConsentContext,
};
