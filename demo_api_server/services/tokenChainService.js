'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mcpToolAuditStore = require('./mcpToolAuditStore');
const configStore = require('./configStore');

// In-memory storage for token events (in production, this would be persisted)
const tokenEvents = new Map();

// Token event structure
const TokenEvent = {
  id: '',
  timestamp: '',
  eventType: '', // 'auth', 'exchange', 'refresh', 'revoke'
  tokenType: '', // 'user_token', 'agent_token', 'exchanged_token'
  tokenSub: '', // sub claim (user ID)
  tokenAct: null, // act claim (agent info)
  tokenAgent: null, // agent client ID
  scopes: [],
  audience: '',
  issuer: '',
  expiry: null,
  description: '', // Human-readable description
  exchangeSteps: [], // For exchange events
  userId: '' // User who owns this token chain
};

// Token type classification
function classifyTokenType(token, context = {}) {
  if (!token) return 'unknown';
  
  try {
    const claims = jwt.decode(token);
    if (!claims) return 'invalid';
    
    // Check for agent token (has specific scopes or client_id in context)
    if (claims.act?.client_id || claims.scope?.includes('agent:')) {
      return 'agent_token';
    }
    
    // Check for exchanged token (has both sub and act)
    if (claims.sub && claims.act) {
      return 'exchanged_token';
    }
    
    // Default to user token
    return 'user_token';
  } catch (err) {
    return 'invalid';
  }
}

// Description generation
function generateTokenDescription(eventType, tokenType, claims, context = {}) {
  switch (eventType) {
    case 'auth':
      return `User authentication via PingOne OAuth (sub: ${claims.sub || 'unknown'})`;
    case 'exchange':
      if (tokenType === 'exchanged_token') {
        return `Token exchange: user_token + agent_token → exchanged_token (sub: ${claims.sub || 'unknown'}, act: ${claims.act?.client_id || 'unknown'})`;
      }
      return `Token exchange: ${context.fromToken || 'unknown'} → ${context.toToken || 'unknown'}`;
    case 'refresh':
      return `Token refreshed (sub: ${claims.sub || 'unknown'})`;
    case 'revoke':
      return `Token revoked (sub: ${claims.sub || 'unknown'})`;
    default:
      return `${eventType} operation`;
  }
}

// Extract JWT claims safely
function extractJwtClaims(token) {
  try {
    return jwt.decode(token) || {};
  } catch (err) {
    return {};
  }
}

// Core functions

async function trackTokenEvent(eventData) {
  const {
    eventType,
    token,
    description,
    userId,
    additionalData = {}
  } = eventData;

  console.log('[tokenChain] Recording event:', { eventType, userId, description });

  // Prefer claims decoded from a raw token; fall back to pre-decoded claims
  // supplied in additionalData (the NL/agent path has only sanitized claims,
  // not the raw token — passing token:'' here would otherwise wipe
  // sub/scope/aud/expiry from the persisted record).
  const claims = (token ? extractJwtClaims(token) : null) || additionalData.claims || {};
  const tokenType = token
    ? classifyTokenType(token, additionalData)
    : (additionalData.tokenType
        || (claims.sub && claims.act ? 'exchanged_token' : (claims.sub ? 'user_token' : 'unknown')));

  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    eventType,
    tokenType,
    tokenSub: claims.sub || '',
    tokenAct: claims.act || null,
    tokenAgent: claims.act?.client_id || null,
    scopes: claims.scope ? (Array.isArray(claims.scope) ? claims.scope : claims.scope.split(' ')) : [],
    audience: claims.aud || '',
    issuer: claims.iss || '',
    // DPoP (RFC 9449) sender-constraint binding + RAR (RFC 9396) intent. Present on the
    // token in native mode; in simulated mode they ride the TraT envelope and surface via
    // the dedicated dpop-binding / rar-authorization token events instead.
    tokenCnf: claims.cnf || null,
    authorizationDetails: claims.authorization_details || claims.azd?.authorization_details || null,
    expiry: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    description: description || generateTokenDescription(eventType, tokenType, claims, additionalData),
    // How the token was granted, when the caller distinguishes a flow subtype
    // (e.g. 'ciba' for a backchannel step-up). Structured field so detectors
    // don't have to string-match the human-readable description.
    grantedVia: additionalData.grantedVia || null,
    // How the BFF authenticated as an OAuth client to the PingOne token endpoint
    // for this step: 'private_key_jwt' (RFC 7523, JWKS) vs 'basic' / 'post'
    // (client_secret). null when not applicable (e.g. simulated TraT envelopes).
    clientAuthMethod: additionalData.clientAuthMethod || null,
    exchangeSteps: [],
    userId
  };

  // Store event (in production, this would be persisted to database)
  if (!tokenEvents.has(userId)) {
    tokenEvents.set(userId, []);
  }
  tokenEvents.get(userId).push(event);

  console.log('[tokenChain] Event recorded. Total events for user:', tokenEvents.get(userId).length);

  // Keep only last 50 events per user
  const userEvents = tokenEvents.get(userId);
  if (userEvents.length > 50) {
    tokenEvents.set(userId, userEvents.slice(-50));
    console.log('[tokenChain] Trimmed events to last 50 for user:', userId);
  }

  return event;
}

async function addExchangeStep(exchangeData) {
  const {
    userId,
    step,
    description,
    fromToken,
    toToken,
    timestamp = new Date().toISOString()
  } = exchangeData;
  
  const userEvents = tokenEvents.get(userId) || [];
  const latestEvent = userEvents[userEvents.length - 1];
  
  if (latestEvent && latestEvent.eventType === 'exchange') {
    latestEvent.exchangeSteps.push({
      step,
      description,
      fromToken,
      toToken,
      timestamp
    });
  }
  
  return latestEvent;
}

async function getTokenChain(userId = null) {
  if (!userId) {
    // Return all events (for admin use)
    const allEvents = [];
    for (const [uid, events] of tokenEvents.entries()) {
      allEvents.push(...events.map(e => ({ ...e, userId: uid })));
    }
    // Ascending (chronological) — the live per-call response is forward-ordered
    // (push order = real sequence); the persisted chain must match so a panel
    // refresh shows the same order, not a reversed one.
    return allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  return (tokenEvents.get(userId) || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Helper function to get current active tokens for a user
async function getCurrentTokens(userId) {
  const userEvents = tokenEvents.get(userId) || [];
  return userEvents.filter(event => 
    event.eventType === 'auth' || event.eventType === 'exchange'
  );
}

// Clear token chain (for testing or logout)
async function clearTokenChain(userId) {
  tokenEvents.delete(userId);
}

// Clear ALL token chain data (for demo reset)
function clearAllTokenChains() {
  tokenEvents.clear();
}

/**
 * Synthesize a single auth event from a raw access token.
 * Fallback for cold-start / server restart when the in-memory Map has no events.
 * Returns an array with one synthetic event, or [] if token cannot be decoded.
 */
function synthesizeFromSession(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') return [];
  try {
    const claims = jwt.decode(accessToken);
    if (!claims || !claims.sub) return [];
    return [{
      id: 'synthetic-session-' + String(claims.sub).slice(0, 8),
      timestamp: new Date().toISOString(),
      eventType: 'auth',
      tokenType: 'user_token',
      tokenSub: claims.sub,
      tokenAct: claims.act || null,
      tokenAgent: (claims.act && claims.act.client_id) || null,
      scopes: claims.scope
        ? (Array.isArray(claims.scope) ? claims.scope : claims.scope.split(' '))
        : [],
      audience: Array.isArray(claims.aud) ? claims.aud.join(' ') : (claims.aud || ''),
      issuer: claims.iss || '',
      expiry: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      description: 'User session token (synthesized after server restart / cold start — '
        + 'decoded from the session only; signature NOT verified, NOT introspected, '
        + 'expiry NOT enforced)',
      exchangeSteps: [],
      userId: claims.sub,
      _synthetic: true,
      // Make the unverified nature explicit so the UI cannot present this as a
      // normal validated auth step. Distinct from a real getTokenChain row.
      verified: false,
      status: 'synthesized',
    }];
  } catch (_e) { return []; }
}

/**
 * Fetch MCP tool calls from audit logs for user.
 * Returns lightweight tool call events (no full token claims).
 * Per Phase 183 D-08, D-09: Show MCP delegation trail for users.
 */
function normalizeMCPEvent(event) {
  return {
    id: event.eventId,
    timestamp: event.timestamp,
    toolName: event.details?.toolName || 'unknown',
    status: event.details?.result?.success ? 'success' : 'failure',
    duration: event.details?.result?.duration || 0,
    chainIndex: event.details?.chainIndex || 0,
    isDelegated: !!event.details?.exchangedToken,
    scopes: event.details?.userToken?.scope || [],
    requestJson: event.details?.request || null,
    resultJson: event.details?.result?.resultJson || null,
    resultSummary: event.details?.result?.summary || null,
  };
}

/**
 * Merge remote MCP audit events with BFF-local mcpToolAuditStore entries.
 * Local records cover api-key / gateway-bypass tools that never hit MCP /audit.
 */
function mergeMcpToolCallEvents(userId, remoteEvents) {
  const remoteList = Array.isArray(remoteEvents) ? remoteEvents : [];
  const localEvents = mcpToolAuditStore.getToolCalls(userId);
  const remoteFiltered = remoteList
    .filter(event => !userId || !event.userId || event.userId === userId || event.details?.userToken?.sub === userId)
    .map(normalizeMCPEvent);
  const localFiltered = localEvents.map(normalizeMCPEvent);
  const byId = new Map();
  for (const e of localFiltered) byId.set(e.id, e);
  for (const e of remoteFiltered) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function getMCPToolCalls(userId, req = null) {
  try {
    // Derive MCP server HTTP origin from MCP_SERVER_URL (ws://host:port → http://host:port)
    const mcpWsUrl = process.env.MCP_SERVER_URL || configStore.getEffective('mcp_server_url');
    const mcpHttpBase = mcpWsUrl.replace(/^ws(s?):/, 'http$1:');
    // The MCP /audit endpoint requires a live agent bearer (validateAgentToken).
    // A static MCP_AGENT_TOKEN would expire, so when it is unset and we have a
    // request, mint (cache-backed) an agent client-credentials token — the same
    // token the BFF already uses for MCP calls. Falls through to no-auth (→ the
    // graceful non-200 merge below) if minting is unavailable or fails.
    let agentToken = process.env.MCP_AGENT_TOKEN || '';
    if (!agentToken && req) {
      try {
        const agentCCTokenService = require('./agentCCTokenService');
        const cc = await agentCCTokenService.getAgentCCToken(req);
        agentToken = cc?.access_token || '';
      } catch (e) {
        console.warn('[tokenChainService] getMCPToolCalls: agent CC token mint failed', e.message);
      }
    }
    const url = `${mcpHttpBase}/audit?eventType=token_chain`;
    // Bounded fetch — /api/token-chain awaits this inline. A hung (half-open)
    // audit socket would otherwise block the whole token-chain request
    // indefinitely (panel spins forever, no 500). Timeout → caught below → [].
    const response = await fetch(url, {
      headers: agentToken ? { 'Authorization': `Bearer ${agentToken}` } : {},
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      console.warn('[tokenChainService] getMCPToolCalls: audit fetch failed', response.status);
      return mergeMcpToolCallEvents(userId, []);
    }

    const data = await response.json();
    const remoteEvents = Array.isArray(data) ? data : (data.events || []);
    return mergeMcpToolCallEvents(userId, remoteEvents);
  } catch (error) {
    console.error('[tokenChainService] getMCPToolCalls error:', error.message);
    return mergeMcpToolCallEvents(userId, []);
  }
}

module.exports = {
  trackTokenEvent,
  addExchangeStep,
  getTokenChain,
  getCurrentTokens,
  clearTokenChain,
  clearAllTokenChains,
  classifyTokenType,
  generateTokenDescription,
  synthesizeFromSession,
  getMCPToolCalls
};
