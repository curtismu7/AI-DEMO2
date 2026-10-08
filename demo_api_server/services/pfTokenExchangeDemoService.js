'use strict';

// Two RFC 8693 hops at PingFederate for the Protocol Playground: the signed-in user's token
// becomes an agent-scoped token, then an MCP-scoped one. The tokens stay in the server-side
// session; the caller gets their claims only.

const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const pfExchange = require('./pfStandardTokenExchangeService');
const { oauthError } = require('./pfAiAgentOAuthService');

const HOP_TTL_MS = 5 * 60 * 1000;

function claimsOf(token) {
  return jwt.decode(token) || {};
}

// Claims and header fields worth teaching with; never the token itself.
function view(token, hop) {
  const claims = claimsOf(token);
  const header = jwt.decode(token, { complete: true })?.header || {};
  return {
    hop,
    header: { alg: header.alg, typ: header.typ },
    claims: {
      iss: claims.iss, sub: claims.sub ?? claims.Username, aud: claims.aud,
      scope: claims.scope, act: claims.act, exp: claims.exp,
    },
  };
}

function userSubject(req) {
  const session = req?.session;
  const provider = String(session?.oauthProvider || session?.user?.oauthProvider || '').toLowerCase();
  if (provider !== 'pingfederate' || !session?.oauthTokens?.accessToken) {
    throw oauthError('PF_AI_EXCHANGE_PF_SESSION_REQUIRED', 'Sign in with PingFederate to run this exchange', 409);
  }
  const token = session.oauthTokens.accessToken;
  // A reference (opaque) token carries no claims to read the user from; say so rather than "no user".
  if (!jwt.decode(token)) {
    throw oauthError(
      'PF_AI_EXCHANGE_OPAQUE_TOKEN',
      'Your PingFederate sign-in returned an opaque (reference) access token, so the user cannot be read from it. '
      + 'This exchange needs a JWT access token: set the access token manager for the sign-in client to a JWT one in PingFederate, then sign in again.',
      409,
    );
  }
  const sub = pfExchange.resolveUserSubject(claimsOf(token));
  if (!sub) {
    throw oauthError(
      'PF_AI_EXCHANGE_USER_UNKNOWN',
      'Your PingFederate access token has neither a sub nor a Username claim, so the user cannot be identified. '
      + 'Add one of them to the access token manager mapping for the sign-in client, then sign in again.',
      409,
    );
  }
  return { token, sub };
}

function loadConfig(store) {
  try {
    return pfExchange.resolveConfig(store);
  } catch (error) {
    if (error.isConfigError) throw oauthError('PF_AI_EXCHANGE_NOT_CONFIGURED', error.message, 503);
    throw error;
  }
}

async function agentHop(req, { store = configStore, now = Date.now } = {}) {
  const user = userSubject(req);
  const config = loadConfig(store);
  const scopes = [config.agentActorScope];
  const actorToken = await pfExchange.getActorToken(config, 'agent');
  const token = await pfExchange.performExchange(config, 'agent', user.token, actorToken, config.intermediateAudience, scopes);
  pfExchange.validateIntermediateToken(token, {
    userSub: user.sub, audience: config.intermediateAudience, scopes, issuer: config.issuer, agentActorToken: actorToken,
  });
  req.session.pfAiAgent ||= {};
  req.session.pfAiAgent.exchangeDemo = {
    intermediate: token, agentActorToken: actorToken, userSub: user.sub, expiresAt: now() + HOP_TTL_MS,
  };
  return view(token, 'agent');
}

async function mcpHop(req, { store = configStore, now = Date.now } = {}) {
  const pending = req?.session?.pfAiAgent?.exchangeDemo;
  if (!pending || pending.expiresAt <= now()) {
    throw oauthError('PF_AI_EXCHANGE_HOP1_REQUIRED', 'Run the agent exchange first', 409);
  }
  const config = loadConfig(store);
  const audience = require('./mcpToolAuthorizationService').resolveExpectedMcpResourceUri();
  if (!audience) throw oauthError('PF_AI_EXCHANGE_AUDIENCE_UNSET', 'No MCP resource audience is configured', 503);
  const scopes = [config.mcpActorScope];
  const mcpActorToken = await pfExchange.getActorToken(config, 'mcp');
  const token = await pfExchange.performExchange(config, 'mcp', pending.intermediate, mcpActorToken, audience, scopes);
  pfExchange.validateFinalToken(token, {
    userSub: pending.userSub, audience, scopes, issuer: config.issuer,
    agentActorToken: pending.agentActorToken, mcpActorToken,
  });
  delete req.session.pfAiAgent.exchangeDemo;
  return view(token, 'mcp');
}

module.exports = { agentHop, mcpHop };
