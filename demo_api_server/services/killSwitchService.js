/**
 * killSwitchService.js
 * 
 * AI Safety Red Button Kill Switch Service
 * Purpose: Immediate agent revocation at OAuth server, state capture, session invalidation
 * 
 * Requirements: REQ-159-01/02/03 — Token revocation at PingOne (not local),
 * invalid within 500ms, decoupled from agent code
 */

const axios = require('axios');
const crypto = require('crypto');
const oauthConfig = require('../config/oauth');
const configStore = require('./configStore');
const auditLogService = require('./auditLogService');
const pingOneUserService = require('./pingOneUserService');

/**
 * Revoke a single token at PingOne using the RFC 7009 revocation endpoint.
 * Uses application/x-www-form-urlencoded with token= only (PingOne requirement).
 * @param {string} token - access_token or id_token value
 * @returns {Promise<{revoked: boolean}>}
 */
async function revokeTokenAtPingOne(token) {
  if (!token) return { revoked: false, error: 'no_token' };
  const revokeUrl = `${oauthConfig._base}/revoke`;
  const body = new URLSearchParams({ token }).toString();
  const response = await axios.post(revokeUrl, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 5000,
  });
  // PingOne returns 200 on success
  return { revoked: response.status === 200 };
}

/**
 * Revoke both the access token and ID token from the session.
 * Runs both revocations in parallel; logs results individually.
 * @param {{ accessToken?: string, idToken?: string }} oauthTokens
 * @returns {Promise<{ revoked: boolean, timestamp: string, time_ms: number }>}
 */
async function revokeAllTokens(oauthTokens) {
  const startTime = Date.now();
  const tokensToRevoke = [
    { type: 'access_token', value: oauthTokens?.accessToken },
    { type: 'id_token',     value: oauthTokens?.idToken },
  ].filter(t => t.value);

  if (tokensToRevoke.length === 0) {
    console.warn('[killSwitch] No access_token or id_token found in session to revoke');
    return { revoked: false, timestamp: new Date().toISOString(), time_ms: 0, error: 'no_tokens' };
  }

  const results = await Promise.allSettled(
    tokensToRevoke.map(t =>
      revokeTokenAtPingOne(t.value)
        .then(r => { console.log(`[killSwitch] ${t.type} revoked: ${r.revoked}`); return r; })
        .catch(e => { console.error(`[killSwitch] ${t.type} revocation failed: ${e.message}`); return { revoked: false }; })
    )
  );

  const anyRevoked = results.some(r => r.status === 'fulfilled' && r.value?.revoked);
  const timeMs = Date.now() - startTime;
  console.log(`[killSwitch] Token revocation complete in ${timeMs}ms (${tokensToRevoke.length} tokens)`);
  return { revoked: anyRevoked, timestamp: new Date().toISOString(), time_ms: timeMs };
}

/**
 * Disable a PingOne user account via Management API.
 * Called by kill switch to immediately prevent re-authentication.
 * @param {string} userId - PingOne user ID (sub claim from session)
 * @returns {Promise<{disabled: boolean}>}
 */
async function disableUserAtPingOne(userId) {
  if (!userId) {
    console.warn('[killSwitch] disableUserAtPingOne: no userId provided — skipping');
    return { disabled: false, reason: 'no_user_id' };
  }
  try {
    pingOneUserService.initialize();
    await pingOneUserService.makeRequest('PATCH', `/users/${userId}`, { enabled: false });
    console.log(`[killSwitch] PingOne user ${userId} disabled via Management API`);
    return { disabled: true };
  } catch (err) {
    // Non-fatal: token is already revoked; disabling the user is belt-and-suspenders
    console.error(`[killSwitch] Failed to disable PingOne user ${userId}:`, err.message);
    return { disabled: false, reason: err.message };
  }
}

/**
 * Disable the agent's PingOne applications via Management API.
 *
 * RFC 7009 only revokes already-issued tokens — a disabled application stops
 * NEW token issuance to the agent identity itself (client_credentials actor
 * tokens, RFC 8693 exchanges), for every user. This is the identity-layer
 * kill: the PingOne analog of the PingFed Agent Discovery kill-switch
 * pattern (decommission the agent's client at the IdP).
 *
 * Targets the agent identity apps only (AGENT_CLIENT_ID = "Demo Agent",
 * PINGONE_AI_AGENT_CLIENT_ID = "Demo AI Agent") — NOT the shared MCP
 * exchanger/gateway apps, so non-agent flows keep working.
 *
 * PingOne application update is PUT full-replace, so we GET the current
 * definition, flip enabled, and strip read-only fields. Non-fatal per app —
 * the agent stays disabled until an admin re-enables it in PingOne.
 *
 * @returns {Promise<Array<{key: string, applicationId: string, disabled: boolean, reason?: string}>>}
 */
async function disableAgentApplicationsAtPingOne() {
  const apps = [
    { key: 'AGENT_CLIENT_ID', id: process.env.AGENT_CLIENT_ID || configStore.getEffective('AGENT_CLIENT_ID') },
    { key: 'PINGONE_AI_AGENT_CLIENT_ID', id: process.env.PINGONE_AI_AGENT_CLIENT_ID || configStore.getEffective('PINGONE_AI_AGENT_CLIENT_ID') },
  ].filter(a => a.id);

  if (apps.length === 0) {
    console.warn('[killSwitch] No agent application IDs configured — skipping app disable');
    return [];
  }

  const results = [];
  for (const app of apps) {
    try {
      pingOneUserService.initialize();
      const current = await pingOneUserService.makeRequest('GET', `/applications/${app.id}`);
      if (current.enabled === false) {
        console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) already disabled`);
        results.push({ key: app.key, applicationId: app.id, disabled: true, reason: 'already_disabled' });
        continue;
      }
      const body = { ...current, enabled: false };
      for (const k of ['_links', '_embedded', 'environment', 'createdAt', 'updatedAt', 'secret']) delete body[k];
      await pingOneUserService.makeRequest('PUT', `/applications/${app.id}`, body);
      console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) disabled — no new agent tokens can be issued`);
      results.push({ key: app.key, applicationId: app.id, disabled: true });
    } catch (err) {
      // Non-fatal: token revocation + user disable still apply
      console.error(`[killSwitch] Failed to disable PingOne application ${app.id} (${app.key}):`, err.message);
      results.push({ key: app.key, applicationId: app.id, disabled: false, reason: err.message });
    }
  }
  return results;
}

/**
 * Re-enable the agent identity apps disabled by disableAgentApplicationsAtPingOne().
 * The inverse of the kill switch's application disable — restores agent
 * functionality after a demo run without requiring manual PingOne console access.
 * Targets the same AGENT_CLIENT_ID / PINGONE_AI_AGENT_CLIENT_ID apps.
 *
 * @returns {Promise<Array<{key: string, applicationId: string, enabled: boolean, reason?: string}>>}
 */
async function enableAgentApplicationsAtPingOne() {
  const apps = [
    { key: 'AGENT_CLIENT_ID', id: process.env.AGENT_CLIENT_ID || configStore.getEffective('AGENT_CLIENT_ID') },
    { key: 'PINGONE_AI_AGENT_CLIENT_ID', id: process.env.PINGONE_AI_AGENT_CLIENT_ID || configStore.getEffective('PINGONE_AI_AGENT_CLIENT_ID') },
  ].filter(a => a.id);

  if (apps.length === 0) {
    console.warn('[killSwitch] No agent application IDs configured — skipping app re-enable');
    return [];
  }

  const results = [];
  for (const app of apps) {
    try {
      pingOneUserService.initialize();
      const current = await pingOneUserService.makeRequest('GET', `/applications/${app.id}`);
      if (current.enabled === true) {
        console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) already enabled`);
        results.push({ key: app.key, applicationId: app.id, enabled: true, reason: 'already_enabled' });
        continue;
      }
      const body = { ...current, enabled: true };
      for (const k of ['_links', '_embedded', 'environment', 'createdAt', 'updatedAt', 'secret']) delete body[k];
      await pingOneUserService.makeRequest('PUT', `/applications/${app.id}`, body);
      console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) re-enabled`);
      results.push({ key: app.key, applicationId: app.id, enabled: true });
    } catch (err) {
      console.error(`[killSwitch] Failed to re-enable PingOne application ${app.id} (${app.key}):`, err.message);
      results.push({ key: app.key, applicationId: app.id, enabled: false, reason: err.message });
    }
  }
  return results;
}

/**
 * Invalidate all agent sessions in Redis/session store
 * @param {string} agentId
 * @returns {Promise<{invalidated: number}>}
 */
async function invalidateSessionsInRedis(agentId) {
  try {
    // Access session store (Upstash Redis or local Redis)
    const sessionStore = require('../middleware/sessionConfig').store;
    
    if (!sessionStore || !sessionStore.client) {
      console.warn('[killSwitch] Session store not available');
      return { invalidated: 0 };
    }

    // Pattern: agent:agentId:* — find all sessions for this agent
    const pattern = `agent:${agentId}:*`;
    
    // Use Redis SCAN to find matching keys (non-blocking)
    let cursor = 0;
    let invalidatedCount = 0;
    
    const scanAndDelete = async () => {
      try {
        const result = await sessionStore.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        const keys = result[1];
        
        if (keys.length > 0) {
          await Promise.all(keys.map(key => sessionStore.client.unlink(key)));
          invalidatedCount += keys.length;
        }
        
        if (cursor !== 0) {
          return scanAndDelete();
        }
        
        return invalidatedCount;
      } catch (e) {
        console.warn('[killSwitch] Session invalidation error:', e.message);
        return invalidatedCount;
      }
    };

    invalidatedCount = await scanAndDelete();
    console.log(`[killSwitch] Invalidated ${invalidatedCount} sessions for agent ${agentId}`);
    
    return { invalidated: invalidatedCount };
  } catch (error) {
    console.error('[killSwitch] Session invalidation failed:', error.message);
    return { invalidated: 0, error: error.message };
  }
}

/**
 * Capture agent state for forensic analysis
 * @param {string} agentId 
 * @returns {Promise<Object>} State snapshot
 */
async function captureAgentState(agentId) {
  const snapshot = {
    timestamp: new Date().toISOString(),
    agent_id: agentId,
    token: {
      client_id: agentId,
      scopes: [], // Would come from config
      expires_in: null,
      claims: {},
    },
    active_sessions: [],
    last_requests: [],
    config: {
      max_requests_per_minute: 10,
      approved_resources: [],
      max_transaction_amount: null,
      expires_at: null,
    },
    metrics: {
      requests_last_5m: 0,
      errors_last_5m: 0,
      rate_limit_violations: 0,
      avg_latency_ms: 0,
    },
    actions: [],
  };

  try {
    const sessionStore = require('../middleware/sessionConfig').store;
    
    // Try to get agent config from configStore
    try {
      const agentConfig = configStore.get(`agent:${agentId}:config`);
      if (agentConfig) {
        snapshot.config = {
          max_requests_per_minute: agentConfig.rate_limit || 10,
          approved_resources: agentConfig.resources || [],
          max_transaction_amount: agentConfig.max_tx,
          expires_at: agentConfig.expires_at,
        };
      }
    } catch (e) {
      // Config not available
    }

    // Get rate limit metrics from Redis
    try {
      if (sessionStore && sessionStore.client) {
        const requestCount = await sessionStore.client.get(`agent:${agentId}:requests`);
        const violationCount = await sessionStore.client.get(`agent:${agentId}:violations`);
        
        snapshot.metrics = {
          requests_last_5m: parseInt(requestCount) || 0,
          errors_last_5m: 0,
          rate_limit_violations: parseInt(violationCount) || 0,
          avg_latency_ms: 0,
        };
      }
    } catch (e) {
      // Metrics not available
    }

  } catch (error) {
    console.warn('[killSwitch] Error capturing state:', error.message);
  }

  return snapshot;
}

/**
 * Check if agent is revoked
 * @param {string} agentId 
 * @returns {Promise<boolean>}
 */
async function isAgentRevoked(agentId) {
  try {
    const sessionStore = require('../middleware/sessionConfig').store;
    
    if (!sessionStore || !sessionStore.client) {
      return false;
    }

    // Check if revoked flag is set
    const revokedKey = `agent:${agentId}:revoked`;
    const revoked = await sessionStore.client.get(revokedKey);
    
    return revoked === 'true';
  } catch (error) {
    console.warn('[killSwitch] Error checking revocation:', error.message);
    return false;
  }
}

/**
 * Get agent's refresh token from session store
 * @param {string} agentId 
 * @returns {Promise<string|null>}
 */
async function getAgentRefreshToken(agentId) {
  try {
    const sessionStore = require('../middleware/sessionConfig').store;
    
    if (!sessionStore || !sessionStore.client) {
      return null;
    }

    const key = `agent:${agentId}:refresh_token`;
    const token = await sessionStore.client.get(key);
    
    return token || null;
  } catch (error) {
    console.warn('[killSwitch] Error getting refresh token:', error.message);
    return null;
  }
}

/**
 * Main kill switch function: revoke agent token and capture state
 * @param {string} agentId 
 * @param {string} reason - Reason for kill switch activation
 * @returns {Promise<{success: boolean, revoked_at: string, state_snapshot_id: string, time_to_revoke_ms: number}>}
 */
async function killAgent(agentId, reason = 'manual_red_button', userId = null, oauthTokens = null) {
  const startTime = Date.now();

  try {
    console.log(`[killSwitch] Executing kill switch for agent ${agentId}. Reason: ${reason}`);
    killAgent._userId = userId || null;

    // 1. Revoke access_token + id_token at PingOne (form-encoded, RFC 7009)
    const revokeResult = await revokeAllTokens(oauthTokens);
    const timeToRevoke = Date.now() - startTime;

    if (!revokeResult.revoked) {
      console.warn(`[killSwitch] Token revocation returned revoked=false — proceeding with session invalidation`);
    }

    // 2. Disable the user at PingOne (belt-and-suspenders — token is revoked but user could re-login)
    //    userId must be passed in for this to work; agentId alone is not enough.
    if (killAgent._userId) {
      await disableUserAtPingOne(killAgent._userId);
      killAgent._userId = null;
    }

    // 2.5 Disable the agent's PingOne applications — identity-layer kill.
    //     Stops NEW token issuance to the agent (revocation only covers
    //     already-issued tokens). Stays disabled until an admin re-enables.
    const applicationsDisabled = await disableAgentApplicationsAtPingOne();

    // 3. Capture state BEFORE invalidating sessions
    const stateSnapshot = await captureAgentState(agentId);
    const stateSnapshotId = crypto.randomBytes(8).toString('hex');

    // 3. Invalidate sessions in Redis
    await invalidateSessionsInRedis(agentId);

    // 4. Mark agent as revoked in session store
    try {
      const sessionStore = require('../middleware/sessionConfig').store;
      if (sessionStore && sessionStore.client) {
        await sessionStore.client.setex(`agent:${agentId}:revoked`, 86400, 'true'); // 24 hour expiry
      }
    } catch (e) {
      console.warn('[killSwitch] Could not set revoked flag:', e.message);
    }

    // 5. Record kill event in audit log
    await auditLogService.recordKillEvent(agentId, reason, stateSnapshot, timeToRevoke, stateSnapshotId);

    const result = {
      success: true,
      revoked_at: new Date().toISOString(),
      state_snapshot_id: stateSnapshotId,
      time_to_revoke_ms: timeToRevoke,
      applications_disabled: applicationsDisabled,
    };

    console.log(`[killSwitch] Kill switch completed for agent ${agentId} in ${timeToRevoke}ms`);
    return result;

  } catch (error) {
    console.error(`[killSwitch] Kill switch failed for agent ${agentId}:`, error.message);
    
    // Record failure to audit log
    try {
      await auditLogService.recordKillFailure(agentId, reason, error.message);
    } catch (auditError) {
      console.error('[killSwitch] Could not record failure to audit log:', auditError.message);
    }

    throw error;
  }
}

module.exports = {
  killAgent,
  captureAgentState,
  isAgentRevoked,
  revokeTokenAtPingOne,
  disableAgentApplicationsAtPingOne,
  enableAgentApplicationsAtPingOne,
  invalidateSessionsInRedis,
  getAgentRefreshToken,
};
