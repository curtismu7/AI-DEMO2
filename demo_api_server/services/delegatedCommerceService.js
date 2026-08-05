'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const oauthService = require('./oauthService');
const pingOneClientService = require('./pingOneClientService');
const scopeTopology = require('./scopeTopology');
const store = require('./lmdb/delegatedCommerceStore.lmdb');
const runtime = require('./delegatedCommerceRuntime');

const REGISTRATION_TTL_MS = 60 * 60 * 1000;
const DEMO_MARKER = 'A&F delegated-commerce demo';

function claimCodeHash(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

function createClaimCode() {
  return crypto.randomBytes(9).toString('base64url').toUpperCase();
}

function safeRegistration(record) {
  if (!record) return null;
  return {
    id: record.id,
    applicationId: record.applicationId,
    name: record.name,
    status: record.status,
    scopes: record.scopes || [],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    claimedAt: record.claimedAt || null,
    consentedAt: record.consentedAt || null,
    revokedAt: record.revokedAt || null,
    tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
  };
}

async function register({ name, creatorUserId }) {
  const sourceApplicationId =
    configStore.getEffective('pingone_ai_agent_client_id') ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID;
  if (!sourceApplicationId) {
    throw Object.assign(new Error('The configured AI agent application is unavailable for grant provisioning.'), {
      code: 'agent_template_not_configured',
      httpStatus: 503,
    });
  }

  const registrationId = crypto.randomUUID();
  const claimCode = createClaimCode();
  const displayName = `${String(name || 'A&F Personal Shopping Agent').trim()} [${registrationId.slice(0, 8)}]`;
  let app = null;
  try {
    app = await pingOneClientService.createApplication({
      client_name: displayName,
      client_description: `${DEMO_MARKER}; registration=${registrationId}; expires=${new Date(Date.now() + REGISTRATION_TTL_MS).toISOString()}`,
      application_type: 'web',
      grant_types: ['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange'],
      response_types: [],
      redirect_uris: [],
      token_endpoint_auth_method: 'client_secret_post',
    });
    if (!app.clientSecret) {
      throw new Error('PingOne did not return a client secret for the new agent application.');
    }

    await pingOneClientService.cloneApplicationGrants(sourceApplicationId, app.id);
    const actorScope = configStore.getEffective('agent_gateway_cc_scope') || 'agent:invoke';
    const actorAudience = scopeTopology.resourceUri('Super Banking Agent Gateway');
    const actorToken = await oauthService.getClientCredentialsTokenAs(
      app.id,
      app.clientSecret,
      actorAudience,
      'post',
      actorScope,
    );
    const actorClaims = jwt.decode(actorToken) || {};
    const actorId = actorClaims.client_id || actorClaims.sub;
    if (actorId !== app.id) {
      throw new Error('The new application minted an actor token with an unexpected client identity.');
    }

    const now = Date.now();
    const record = store.put({
      id: registrationId,
      applicationId: app.id,
      name: app.name || displayName,
      marker: DEMO_MARKER,
      creatorUserId,
      claimCodeHash: claimCodeHash(claimCode),
      claimedByUserId: null,
      status: 'staged',
      scopes: [],
      tokenEndpointAuthMethod: 'post',
      createdAt: now,
      expiresAt: now + REGISTRATION_TTL_MS,
    });
    runtime.holdCredentials(registrationId, { clientSecret: app.clientSecret });
    return {
      registration: safeRegistration(record),
      claimCode,
      actorToken: {
        clientId: actorId,
        audience: actorClaims.aud || null,
        scope: actorClaims.scope || '',
      },
    };
  } catch (err) {
    if (app?.id) {
      await pingOneClientService.deleteApplication(app.id).catch((cleanupErr) => {
        console.error('[delegated-commerce] partial application cleanup failed:', cleanupErr.message);
      });
    }
    throw err;
  }
}

function claim({ claimCode, userId }) {
  const record = store.findByClaimCodeHash(claimCodeHash(claimCode));
  if (!record || record.status !== 'staged' || !record.claimCodeHash) {
    throw Object.assign(new Error('The one-time claim code is invalid or has already been used.'), {
      code: 'invalid_claim_code',
      httpStatus: 400,
    });
  }
  if (record.expiresAt <= Date.now()) {
    throw Object.assign(new Error('The one-time claim code has expired.'), {
      code: 'claim_code_expired',
      httpStatus: 410,
    });
  }
  const claimed = {
    ...record,
    status: 'claimed',
    claimedByUserId: userId,
    claimedAt: Date.now(),
  };
  delete claimed.claimCodeHash;
  store.put(claimed);
  return safeRegistration(claimed);
}

function updateConsent(registrationId, scopes) {
  const record = store.get(registrationId);
  const updated = {
    ...record,
    status: 'active',
    scopes: scopes.slice(),
    consentedAt: Date.now(),
    revokedAt: null,
  };
  store.put(updated);
  return safeRegistration(updated);
}

function revoke(registrationId) {
  const record = store.get(registrationId);
  if (!record) return null;
  const updated = { ...record, status: 'revoked', revokedAt: Date.now() };
  store.put(updated);
  return safeRegistration(updated);
}

async function cleanup(registrationId, creatorUserId) {
  const record = store.get(registrationId);
  if (!record || record.marker !== DEMO_MARKER || record.creatorUserId !== creatorUserId) {
    throw Object.assign(new Error('Demo registration not found or not owned by this administrator.'), {
      code: 'registration_not_found',
      httpStatus: 404,
    });
  }
  await pingOneClientService.deleteApplication(record.applicationId);
  runtime.removeCredentials(registrationId);
  store.remove(registrationId);
}

module.exports = {
  register,
  claim,
  updateConsent,
  revoke,
  cleanup,
  safeRegistration,
};
