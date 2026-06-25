/**
 * auditLogService.js
 *
 * Immutable audit logging for AI Safety Red Button
 * Purpose: Append-only log of all kill events and rate limit violations
 * 
 * Requirements: REQ-159-04/05 — State capture at kill time, kill reason logged immutably
 */

const crypto = require('node:crypto');
const uuidv4 = () => crypto.randomUUID();

// Use Redis stream for append-only immutable log
// Or fallback to in-memory with timestamp ordering
let auditLogs = {}; // Maps agent_id -> array of events (sorted by timestamp)

/**
 * Record a kill switch event (immutable append)
 * @param {string} agentId 
 * @param {string} reason 
 * @param {Object} stateSnapshot 
 * @param {number} timeToRevoke 
 * @param {string} stateSnapshotId 
 * @returns {Promise<string>} Audit ID
 */
async function recordKillEvent(agentId, reason, stateSnapshot, timeToRevoke, stateSnapshotId) {
  const auditId = `kill-switch-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  const event = {
    audit_id: auditId,
    timestamp,
    event: 'agent_killed',
    agent_id: agentId,
    kill_reason: reason,
    time_to_revoke_ms: timeToRevoke,
    state_captured: true,
    state_size_bytes: JSON.stringify(stateSnapshot).length,
    state_snapshot_id: stateSnapshotId,
    previous_requests_in_flight: stateSnapshot.active_sessions?.length || 0,
    requests_rejected: 0,
    compliance_tags: ['TRiSM', 'AI-Safety', 'Immediate-Action'],
  };

  // Store in in-memory immutable log (in production: Redis stream or append-only DB)
  if (!auditLogs[agentId]) {
    auditLogs[agentId] = [];
  }
  auditLogs[agentId].push(event);

  // Try to persist to Redis stream if available
  try {
    const sessionStore = require('../middleware/sessionConfig').store;
    if (sessionStore && sessionStore.client) {
      await sessionStore.client.xadd(
        `audit:agent:${agentId}`,
        '*', // XADD auto-generates timestamp
        'event', 'agent_killed',
        'audit_id', auditId,
        'timestamp', timestamp,
        'reason', reason,
        'time_to_revoke_ms', timeToRevoke,
        'state_snapshot_id', stateSnapshotId,
        'compliance_tags', 'TRiSM,AI-Safety'
      );
    }
  } catch (e) {
    console.warn('[auditLog] Could not persist kill event to Redis:', e.message);
  }

  console.log(`[auditLog] Kill event recorded: ${auditId}`);
  return auditId;
}

/**
 * Record kill switch failure (for troubleshooting)
 * @param {string} agentId 
 * @param {string} reason 
 * @param {string} errorMessage 
 * @returns {Promise<string>} Audit ID
 */
async function recordKillFailure(agentId, reason, errorMessage) {
  const auditId = `kill-switch-failure-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  const event = {
    audit_id: auditId,
    timestamp,
    event: 'agent_kill_failed',
    agent_id: agentId,
    kill_reason: reason,
    error_message: errorMessage,
    compliance_tags: ['TRiSM', 'AI-Safety', 'Error'],
  };

  if (!auditLogs[agentId]) {
    auditLogs[agentId] = [];
  }
  auditLogs[agentId].push(event);

  console.log(`[auditLog] Kill failure recorded: ${auditId}`);
  return auditId;
}

/**
 * Record rate limit violation
 * @param {string} agentId 
 * @param {number} requestCount 
 * @param {number} limit 
 * @returns {Promise<void>}
 */
async function recordRateLimitViolation(agentId, requestCount, limit) {
  const timestamp = new Date().toISOString();

  const event = {
    timestamp,
    event: 'agent_rate_limit_exceeded',
    agent_id: agentId,
    request_count: requestCount,
    limit,
    compliance_tags: ['TRiSM', 'AI-Safety', 'Rate-Limit'],
  };

  if (!auditLogs[agentId]) {
    auditLogs[agentId] = [];
  }
  auditLogs[agentId].push(event);

  // Try to persist to Redis stream
  try {
    const sessionStore = require('../middleware/sessionConfig').store;
    if (sessionStore && sessionStore.client) {
      await sessionStore.client.xadd(
        `audit:agent:${agentId}`,
        '*',
        'event', 'agent_rate_limit_exceeded',
        'request_count', requestCount,
        'limit', limit,
        'timestamp', timestamp
      );
    }
  } catch (e) {
    console.warn('[auditLog] Could not persist rate limit violation to Redis:', e.message);
  }
}

/**
 * Get audit trail for an agent
 * @param {string} agentId 
 * @param {number} hoursBack - How many hours back to query (default: 24)
 * @param {number} limit - Max events to return (default: 100)
 * @returns {Promise<Array>} Events sorted by timestamp descending
 */
async function getAuditTrail(agentId, hoursBack = 24, limit = 100) {
  try {
    let events = [];

    // Try to get from Redis stream first
    try {
      const sessionStore = require('../middleware/sessionConfig').store;
      if (sessionStore && sessionStore.client) {
        const results = await sessionStore.client.xrevrange(
          `audit:agent:${agentId}`,
          '+', // newest
          '-', // oldest
          'COUNT', limit
        );

        if (results && results.length > 0) {
          // Parse Redis stream results
          events = results.map(([id, fields]) => {
            const obj = {
              stream_id: id,
            };
            for (let i = 0; i < fields.length; i += 2) {
              obj[fields[i]] = fields[i + 1];
            }
            return obj;
          });
        }
      }
    } catch (e) {
      console.warn('[auditLog] Could not read from Redis stream:', e.message);
    }

    // Fallback to in-memory log if Redis failed or empty
    if (events.length === 0 && auditLogs[agentId]) {
      const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
      events = auditLogs[agentId]
        .filter(e => new Date(e.timestamp) > cutoffTime)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    }

    return events;

  } catch (error) {
    console.error('[auditLog] Error getting audit trail:', error.message);
    return [];
  }
}

/**
 * Get event by audit ID (for detail view)
 * @param {string} auditId 
 * @returns {Promise<Object|null>}
 */
async function getAuditEventById(auditId) {
  try {
    // Search in-memory log
    for (const agentId in auditLogs) {
      const event = auditLogs[agentId].find(e => e.audit_id === auditId);
      if (event) return event;
    }

    // Try Redis if not found in memory
    try {
      const sessionStore = require('../middleware/sessionConfig').store;
      if (sessionStore && sessionStore.client) {
        // Note: Simple search in all audit streams (would need proper indexing in production)
        console.warn('[auditLog] Audit event not found:', auditId);
      }
    } catch (e) {
      // Redis not available
    }

    return null;
  } catch (error) {
    console.error('[auditLog] Error getting audit event:', error.message);
    return null;
  }
}

/**
 * Clear old audit logs (retention policy: keep 90 days)
 * @returns {Promise<number>} Number of events deleted
 */
async function pruneOldLogs(retentionDays = 90) {
  try {
    const cutoffTime = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let prunedCount = 0;

    // Prune in-memory log
    for (const agentId in auditLogs) {
      const originalLength = auditLogs[agentId].length;
      auditLogs[agentId] = auditLogs[agentId].filter(
        e => new Date(e.timestamp) > cutoffTime
      );
      prunedCount += originalLength - auditLogs[agentId].length;
    }

    console.log(`[auditLog] Pruned ${prunedCount} old events`);
    return prunedCount;

  } catch (error) {
    console.error('[auditLog] Error pruning logs:', error.message);
    return 0;
  }
}

module.exports = {
  recordKillEvent,
  recordKillFailure,
  recordRateLimitViolation,
  getAuditTrail,
  getAuditEventById,
  pruneOldLogs,
};
