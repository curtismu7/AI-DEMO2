/**
 * appEventService.js — Centralized app event capture service
 * 
 * Captures structured events (OAuth, token exchange, session, JWKS, MCP)
 * and stores them in an in-memory ring buffer for admin visibility.
 * Replaces scattered console.log('[tag]...') calls with structured events.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Event categories
const EVENT_CATEGORIES = {
  OAUTH: 'oauth',
  TOKEN_EXCHANGE: 'token_exchange',
  SESSION: 'session',
  JWKS: 'jwks',
  MCP: 'mcp',
  AUTH_LIFECYCLE: 'auth_lifecycle',
  AGENT: 'agent',
  AUTHORIZE: 'authorize',
  AGENT_PROMPT: 'agent_prompt',
  DELEGATION: 'delegation',
  INTROSPECTION: 'introspection',
  HELIX: 'helix',
  // Phase 266 — gateway credential-path routing events (oauth_bearer / api_key / dual_token)
  GATEWAY_PATH: 'gateway_path',
  HITL: 'hitl',
  THRESHOLD: 'threshold',
  CONFIG: 'config',
};

// Event severity levels
const EVENT_SEVERITIES = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
};

// File persistence — D-01
const _logFilePath = path.resolve(
  process.env.ACTIVITY_LOG_FILE || path.join(__dirname, '..', 'logs', 'activity.ndjson')
);
try {
  fs.mkdirSync(path.dirname(_logFilePath), { recursive: true });
} catch (_e) {
  console.warn('[appEventService] Could not create log directory:', _e.message);
}

// Configuration
const MAX_EVENTS = 200;
let events = [];

// Live-push subscribers (SSE connections)
const _subscribers = new Set();

function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

function _notify(event) {
  for (const fn of _subscribers) {
    try { fn(event); } catch (_) {}
  }
}

/**
 * Generate a unique flow ID for grouping related events
 * @returns {string} Short random flow ID
 */
function generateFlowId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Log a structured event
 * @param {string} category - Event category from EVENT_CATEGORIES
 * @param {string} severity - Severity level from EVENT_SEVERITIES
 * @param {string} message - Human-readable event message
 * @param {object} options - Additional options
 * @param {string} options.tag - Original [tag] label for traceability
 * @param {object} options.metadata - Optional structured metadata (no secrets)
 * @param {string} options.flowId - Optional flow ID for grouping related events (legacy)
 * @param {string} options.correlationId - Preferred correlation id (aliases flowId)
 * @param {string} options.requestId - Optional HTTP request id
 * @param {string} options.sessionId - Optional BFF session id
 * @param {string} options.username - Optional username association
 */
function logEvent(category, severity, message, options = {}) {
  const { redactMessage, redactObject } = require("../utils/logRedact");
  const useCaseId = options.useCaseId
    || (options.metadata && options.metadata.useCaseId)
    || null;
  const correlationId =
    options.correlationId || options.flowId || null;
  const metadata = options.metadata
    ? redactObject(options.metadata)
    : null;
  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    category,
    severity,
    message: redactMessage(message),
    tag: options.tag || null,
    metadata,
    flowId: correlationId,
    correlationId,
    requestId: options.requestId || null,
    sessionId: options.sessionId || null,
    username: options.username || null,
    ...(useCaseId ? { useCaseId } : {}),
  };

  events.push(event);
  _notify(event);

  // Persist to NDJSON file — D-01
  try {
    fs.appendFileSync(_logFilePath, JSON.stringify(event) + '\n');
  } catch (_writeErr) {
    console.warn('[appEventService] Log file write failed:', _writeErr.message);
  }

  // Evict oldest event if buffer is full
  if (events.length > MAX_EVENTS) {
    events.shift();
  }

  return event;
}

/**
 * Get events with optional filtering
 * @param {object} options - Filter options
 * @param {string} options.category - Filter by category
 * @param {string} options.severity - Filter by severity
 * @param {number} options.limit - Max events to return (default 100, max 500)
 * @param {string} options.since - ISO timestamp, return events after this time
 * @returns {array} Filtered events array (newest first)
 */
function getEvents(options = {}) {
  let filtered = [...events];

  // Filter by category
  if (options.category) {
    filtered = filtered.filter(e => e.category === options.category);
  }

  // Filter by severity
  if (options.severity) {
    filtered = filtered.filter(e => e.severity === options.severity);
  }

  // Filter by timestamp
  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    filtered = filtered.filter(e => new Date(e.timestamp).getTime() > sinceTime);
  }

  // Sort newest first
  filtered.reverse();

  // Apply limit
  const limit = Math.min(options.limit || 100, 500);
  return filtered.slice(0, limit);
}

/**
 * Get event counts grouped by category
 * @returns {object} Category counts
 */
function getEventsByCategory() {
  const counts = {};
  Object.values(EVENT_CATEGORIES).forEach(cat => {
    counts[cat] = events.filter(e => e.category === cat).length;
  });
  return counts;
}

/**
 * Clear all events from the buffer
 */
function clearEvents() {
  events = [];
}

module.exports = {
  logEvent,
  getEvents,
  getEventsByCategory,
  clearEvents,
  generateFlowId,
  subscribe,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
};
