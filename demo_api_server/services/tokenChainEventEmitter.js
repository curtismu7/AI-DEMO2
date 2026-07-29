/**
 * tokenChainEventEmitter.js — Token chain SSE event emission with type tagging
 *
 * Emits RFC 8693 token exchange events to SSE with type classification:
 * - "introspection" when token validation occurs
 * - "agent-to-a2a" when act claim is present (agent delegation)
 * - "person-to-mcp" when audience is MCP server
 * - "person-to-agent" default (user-initiated flow)
 *
 * Integrates with appEventService to broadcast events to subscribed SSE clients.
 */

'use strict';

const appEventService = require('./appEventService');

/**
 * Determine the type of token exchange based on context
 *
 * @param {object} context - Token exchange context
 * @param {boolean} context.isIntrospection - Is this a token introspection?
 * @param {string} context.aud - Token audience claim
 * @param {object} context.act - Token act claim (indicates agent delegation)
 * @param {string} context.subjectTokenAud - Subject token's audience (optional)
 * @returns {string} Exchange type: "introspection" | "agent-to-a2a" | "person-to-mcp" | "person-to-agent"
 */
function determineExchangeType(context) {
  if (!context) {
    return 'person-to-agent';
  }

  const { isIntrospection, aud, act } = context;

  if (isIntrospection === true) {
    return 'introspection';
  }

  if (act) {
    // Agent is actor → A2A delegation
    return 'agent-to-a2a';
  }

  if (aud && typeof aud === 'string' && aud.includes('mcp')) {
    return 'person-to-mcp';
  }

  // Default to person-to-agent
  return 'person-to-agent';
}

/**
 * Emit a token exchange event to SSE
 *
 * @param {object} event - Event object with token exchange details
 * @param {string} event.timestamp - ISO 8601 timestamp
 * @param {string} event.subjectToken - Subject token (JWT)
 * @param {string} event.resultToken - Result/issued token (JWT)
 * @param {object} event.metadata - Token metadata (aud, sub, scope, etc.)
 * @param {object} event.context - Token context for type determination
 * @param {object} options - Emission options
 * @param {string} options.category - Event category (default: 'token_exchange')
 * @param {string} options.severity - Severity level (default: 'info')
 * @param {string} options.tag - Traceability tag (optional)
 * @returns {object} The emitted event with exchangeType added
 */
function emitTokenExchangeEvent(event, options = {}) {
  const {
    category = 'token_exchange',
    severity = 'info',
    tag = null,
  } = options;

  // Determine exchange type from context
  const exchangeType = determineExchangeType(event.context || event.metadata || {});

  // Build complete event with exchangeType
  const enrichedEvent = {
    exchangeType,
    timestamp: event.timestamp || new Date().toISOString(),
    subjectToken: event.subjectToken || null,
    resultToken: event.resultToken || null,
    metadata: event.metadata || {},
  };

  // Log to appEventService for SSE broadcast
  const message = `Token exchange (${exchangeType}): ${enrichedEvent.metadata.aud || 'unknown'} audience`;

  appEventService.logEvent(category, severity, message, {
    tag,
    metadata: {
      ...enrichedEvent.metadata,
      exchangeType,
      subjectToken: enrichedEvent.subjectToken,
      resultToken: enrichedEvent.resultToken,
    },
  });

  return enrichedEvent;
}

/**
 * Create a token exchange event emitter bound to a request
 *
 * @param {object} req - Express request object
 * @returns {function} emitTokenExchange(event, options) bound to this request
 */
function createRequestTokenEmitter(req) {
  return function emitTokenExchange(event, options = {}) {
    return emitTokenExchangeEvent(event, {
      ...options,
      tag: options.tag || `req-${req.id || 'unknown'}`,
    });
  };
}

module.exports = {
  determineExchangeType,
  emitTokenExchangeEvent,
  createRequestTokenEmitter,
};
