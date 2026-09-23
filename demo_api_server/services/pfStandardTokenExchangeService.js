'use strict';

const configStore = require('./configStore');
const oauthService = require('./oauthService');

const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

function resolveConfig(store = configStore) {
  const get = (key) => store.getEffective(key);
  const config = {
    agentExchangeClientId: get('pf_standard_agent_exchange_client_id'),
    agentExchangeClientSecret: get('pf_standard_agent_exchange_client_secret'),
    agentExchangeAuthMethod: (get('pf_standard_agent_exchange_token_endpoint_auth_method') || 'basic').toLowerCase(),
    mcpExchangeClientId: get('pf_standard_token_exchange_client_id'),
    mcpExchangeClientSecret: get('pf_standard_token_exchange_client_secret'),
    mcpExchangeAuthMethod: (get('pf_standard_token_exchange_token_endpoint_auth_method') || 'basic').toLowerCase(),
    agentActorClientId: get('pf_ai_agent_actor_client_id'),
    agentActorClientSecret: get('pf_ai_agent_actor_client_secret'),
    agentActorAuthMethod: (get('pf_ai_agent_actor_token_endpoint_auth_method') || 'basic').toLowerCase(),
    agentActorScope: get('pf_standard_token_exchange_actor_scope') || 'agent:invoke',
    mcpActorClientId: get('pf_mcp_service_actor_client_id'),
    mcpActorClientSecret: get('pf_mcp_service_actor_client_secret'),
    mcpActorAuthMethod: (get('pf_mcp_service_actor_token_endpoint_auth_method') || 'basic').toLowerCase(),
    mcpActorScope: get('pf_standard_mcp_actor_scope') || 'mcp:invoke',
    intermediateAudience: get('pf_standard_intermediate_audience'),
    tokenEndpoint: get('pf_token_endpoint'),
  };
  const missing = Object.entries({
    PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID: config.agentExchangeClientId,
    PF_STANDARD_AGENT_EXCHANGE_CLIENT_SECRET: config.agentExchangeClientSecret,
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID: config.mcpExchangeClientId,
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET: config.mcpExchangeClientSecret,
    PF_AI_AGENT_ACTOR_CLIENT_ID: config.agentActorClientId,
    PF_AI_AGENT_ACTOR_CLIENT_SECRET: config.agentActorClientSecret,
    PF_MCP_SERVICE_ACTOR_CLIENT_ID: config.mcpActorClientId,
    PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: config.mcpActorClientSecret,
    PF_STANDARD_INTERMEDIATE_AUDIENCE: config.intermediateAudience,
    PF_TOKEN_ENDPOINT: config.tokenEndpoint,
  }).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const error = new Error(`PingFederate two-exchange delegation is not configured. Missing: ${missing.join(', ')}`);
    error.code = 'PF_TWO_EXCHANGE_CONFIG_INVALID';
    error.httpStatus = 503;
    error.isConfigError = true;
    error.details = { missing };
    throw error;
  }
  return config;
}

function decodeToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('PingFederate exchange returned a malformed access token');
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    };
  } catch {
    throw new Error('PingFederate exchange returned an unreadable access token');
  }
}

function scopeSet(value) {
  return new Set(Array.isArray(value) ? value : String(value || '').split(/\s+/).filter(Boolean));
}

function sameScopes(actual, expected) {
  const left = [...scopeSet(actual)].sort();
  const right = [...scopeSet(expected)].sort();
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}

function includesAudience(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

function actorIdentity(decoded) {
  return decoded.claims.client_id || decoded.claims.sub;
}

function assertAccessToken(token, step) {
  const decoded = decodeToken(token);
  if (String(decoded.header.typ || '').toLowerCase().includes('id-jag')) {
    throw new Error(`PingFederate ${step} returned an ID-JAG; standard demo steps require access tokens`);
  }
  return decoded;
}

async function getActorToken(config, role) {
  const isAgent = role === 'agent';
  const clientId = isAgent ? config.agentActorClientId : config.mcpActorClientId;
  const clientSecret = isAgent ? config.agentActorClientSecret : config.mcpActorClientSecret;
  const authMethod = isAgent ? config.agentActorAuthMethod : config.mcpActorAuthMethod;
  const actorScope = isAgent ? config.agentActorScope : config.mcpActorScope;
  const description = isAgent ? 'AI-agent' : 'MCP-service';
  const token = await oauthService.getAiAgentClientCredentialsToken({
    clientId, clientSecret, authMethod, actorScope, tokenEndpoint: config.tokenEndpoint,
  });
  const decoded = assertAccessToken(token, `${description} actor-token request`);
  if (actorIdentity(decoded) !== clientId) throw new Error(`PingFederate ${description} actor identity mismatch`);
  if (!scopeSet(decoded.claims.scope).has(actorScope)) throw new Error(`PingFederate ${description} actor scope mismatch`);
  return token;
}

function performExchange(config, hop, subjectToken, actorToken, audience, scopes, options = {}) {
  const isAgentHop = hop === 'agent';
  return oauthService.performTokenExchangeAs(
    subjectToken,
    actorToken,
    isAgentHop ? config.agentExchangeClientId : config.mcpExchangeClientId,
    isAgentHop ? config.agentExchangeClientSecret : config.mcpExchangeClientSecret,
    audience,
    scopes,
    isAgentHop ? config.agentExchangeAuthMethod : config.mcpExchangeAuthMethod,
    {
      ...options,
      requestedTokenType: ACCESS_TOKEN_TYPE,
      tokenEndpoint: config.tokenEndpoint,
      // PF policies derive the result audience. The audience argument is kept
      // for shared telemetry and claim validation, but is not sent to PF.
      omitAudience: true,
    }
  );
}

function validateIntermediateToken(token, { userSub, audience, scopes }) {
  const decoded = assertAccessToken(token, 'first exchange');
  if (decoded.claims.sub !== userSub) throw new Error('PingFederate first exchange did not preserve the user subject');
  if (!includesAudience(decoded.claims.aud, audience)) throw new Error('PingFederate intermediate audience mismatch');
  if (!sameScopes(decoded.claims.scope, scopes)) throw new Error('PingFederate intermediate scope mismatch');
  return decoded;
}

function validateFinalToken(token, { userSub, audience, scopes, agentActorToken, mcpActorToken }) {
  const decoded = assertAccessToken(token, 'second exchange');
  const agentActor = assertAccessToken(agentActorToken, 'AI-agent actor-token request');
  const mcpActor = assertAccessToken(mcpActorToken, 'MCP-service actor-token request');
  if (decoded.claims.sub !== userSub) throw new Error('PingFederate exchange did not preserve the user subject');
  if (!includesAudience(decoded.claims.aud, audience)) throw new Error('PingFederate final audience mismatch');
  if (!sameScopes(decoded.claims.scope, scopes)) throw new Error('PingFederate exchange scope mismatch');
  const nestedActMatches = decoded.claims.act?.sub === actorIdentity(mcpActor)
    && decoded.claims.act?.act?.sub === actorIdentity(agentActor);
  const supportedFlatActMatches = decoded.claims.act?.sub === actorIdentity(agentActor)
    && !decoded.claims.act?.act?.sub;
  if (!nestedActMatches && !supportedFlatActMatches) {
    throw new Error('PingFederate final act claim does not match a supported MCP-service/AI-agent delegation shape');
  }
  return decoded;
}

module.exports = {
  resolveConfig,
  getActorToken,
  performExchange,
  validateIntermediateToken,
  validateFinalToken,
};
