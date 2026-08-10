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
const killSwitchSseHub = require('./killSwitchSseHub');

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
 * Targets the agent identity apps only (PINGONE_AGENT_CLIENT_ID = "Demo Agent",
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
    { key: 'PINGONE_AGENT_CLIENT_ID', id: process.env.PINGONE_AGENT_CLIENT_ID || configStore.getEffective('PINGONE_AGENT_CLIENT_ID') },
    { key: 'PINGONE_AI_AGENT_CLIENT_ID', id: process.env.PINGONE_AI_AGENT_CLIENT_ID || configStore.getEffective('PINGONE_AI_AGENT_CLIENT_ID') },
  ].filter(a => a.id);

  if (apps.length === 0) {
    console.warn('[killSwitch] No agent application IDs configured — skipping app disable');
    return [];
  }

  const results = await Promise.all(
    apps.map(async (app) => {
      try {
        pingOneUserService.initialize();
        const current = await pingOneUserService.makeRequest('GET', `/applications/${app.id}`);
        if (current.enabled === false) {
          console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) already disabled`);
          return { key: app.key, applicationId: app.id, disabled: true, reason: 'already_disabled' };
        }
        const body = { ...current, enabled: false };
        for (const k of ['_links', '_embedded', 'environment', 'createdAt', 'updatedAt', 'secret']) delete body[k];
        await pingOneUserService.makeRequest('PUT', `/applications/${app.id}`, body);
        console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) disabled — no new agent tokens can be issued`);
        return { key: app.key, applicationId: app.id, disabled: true };
      } catch (err) {
        // Non-fatal: token revocation + user disable still apply
        console.error(`[killSwitch] Failed to disable PingOne application ${app.id} (${app.key}):`, err.message);
        return { key: app.key, applicationId: app.id, disabled: false, reason: err.message };
      }
    })
  );
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
    { key: 'PINGONE_AGENT_CLIENT_ID', id: process.env.PINGONE_AGENT_CLIENT_ID || configStore.getEffective('PINGONE_AGENT_CLIENT_ID') },
    { key: 'PINGONE_AI_AGENT_CLIENT_ID', id: process.env.PINGONE_AI_AGENT_CLIENT_ID || configStore.getEffective('PINGONE_AI_AGENT_CLIENT_ID') },
  ].filter(a => a.id);

  if (apps.length === 0) {
    console.warn('[killSwitch] No agent application IDs configured — skipping app re-enable');
    return [];
  }

  const results = await Promise.all(
    apps.map(async (app) => {
      try {
        pingOneUserService.initialize();
        const current = await pingOneUserService.makeRequest('GET', `/applications/${app.id}`);
        if (current.enabled === true) {
          console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) already enabled`);
          return { key: app.key, applicationId: app.id, enabled: true, reason: 'already_enabled' };
        }
        const body = { ...current, enabled: true };
        for (const k of ['_links', '_embedded', 'environment', 'createdAt', 'updatedAt', 'secret']) delete body[k];
        await pingOneUserService.makeRequest('PUT', `/applications/${app.id}`, body);
        console.log(`[killSwitch] PingOne application ${app.id} (${app.key}) re-enabled`);
        return { key: app.key, applicationId: app.id, enabled: true };
      } catch (err) {
        console.error(`[killSwitch] Failed to re-enable PingOne application ${app.id} (${app.key}):`, err.message);
        return { key: app.key, applicationId: app.id, enabled: false, reason: err.message };
      }
    })
  );
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
 * @param {string} [userId] - PingOne user id, for disableUserAtPingOne
 * @param {{accessToken?: string, idToken?: string}} [oauthTokens]
 * @param {'full'|'instance'} [scope] - 'instance' (default) skips disableAgentApplicationsAtPingOne
 *   and disableUserAtPingOne so only THIS caller's tokens/session are stopped.
 *   'full' also disables the agent's PingOne application(s) and the user account.
 * @param {string} [sessionId] - req.sessionID of the caller, if present. When set, each
 *   step is also pushed to killSwitchSseHub so KillSwitchConfirmModal can render it live
 *   instead of waiting for the whole call to finish.
 * @returns {Promise<{success: boolean, revoked_at: string, state_snapshot_id: string, time_to_revoke_ms: number, scope: string, steps: Array}>}
 */
async function killAgent(agentId, reason = 'manual_red_button', userId = null, oauthTokens = null, scope = 'instance', sessionId = null) {
  const startTime = Date.now();
  const steps = [];
  const pushStep = (step) => {
    steps.push(step);
    killSwitchSseHub.publishStep(sessionId, { agentId, step });
  };

  try {
    console.log(`[killSwitch] Executing kill switch for agent ${agentId}. Reason: ${reason}. Scope: ${scope}`);
    killAgent._userId = userId || null;

    // 1. Revoke access_token + id_token at PingOne (form-encoded, RFC 7009)
    const revokeResult = await revokeAllTokens(oauthTokens);
    const timeToRevoke = Date.now() - startTime;

    if (!revokeResult.revoked) {
      console.warn(`[killSwitch] Token revocation returned revoked=false — proceeding with session invalidation`);
    }
    pushStep({
      key: 'token_revocation',
      label: 'Revoke OAuth tokens at PingOne',
      detail: revokeResult.revoked
        ? 'Access/ID token revoked (RFC 7009) — already-issued tokens are now invalid. This does not interrupt a call already in progress; it stops the token being reused on the next one.'
        : 'No valid access/ID token found on this session to revoke.',
      ran: true,
      skipped: false,
    });

    // 2. Disable the user at PingOne — full scope only. Instance-only kills must
    //    leave the human account enabled so the demo can sign back in.
    let userDisableResult = null;
    if (scope === 'instance') {
      killAgent._userId = null;
      pushStep({
        key: 'user_disable',
        label: 'Disable the PingOne user account',
        detail: 'Skipped — instance-only scope. The human account stays enabled for re-login.',
        ran: false,
        skipped: true,
        skipReason: 'instance_scope',
      });
    } else {
      if (killAgent._userId) {
        userDisableResult = await disableUserAtPingOne(killAgent._userId);
        killAgent._userId = null;
      }
      pushStep({
        key: 'user_disable',
        label: 'Disable the PingOne user account',
        detail: userDisableResult
          ? (userDisableResult.disabled
            ? 'User account disabled — cannot sign back in and mint a fresh token.'
            : `Could not disable user account: ${userDisableResult.reason}`)
          : 'No user id on this session — nothing to disable.',
        ran: !!(userDisableResult && userDisableResult.disabled),
        skipped: !userDisableResult,
        skipReason: userDisableResult ? undefined : 'no_user_id',
      });
    }

    // 2.5 Disable the agent's PingOne applications — identity-layer kill.
    //     Stops NEW token issuance to the agent (revocation only covers
    //     already-issued tokens). Stays disabled until an admin re-enables.
    //     Scoped: this hits AGENT_CLIENT_ID/PINGONE_AI_AGENT_CLIENT_ID directly,
    //     which is shared by every user of that agent identity — skip it for
    //     scope='instance' so a single rogue caller doesn't take the client down
    //     for everyone else.
    let applicationsDisabled = [];
    if (scope === 'instance') {
      pushStep({
        key: 'app_disable',
        label: "Disable the agent's PingOne application",
        detail: 'Skipped — instance-only scope. The agent client stays enabled so other users are unaffected.',
        ran: false,
        skipped: true,
        skipReason: 'instance_scope',
      });
    } else {
      applicationsDisabled = await disableAgentApplicationsAtPingOne();
      const anyDisabled = applicationsDisabled.some((a) => a.disabled);
      pushStep({
        key: 'app_disable',
        label: "Disable the agent's PingOne application",
        detail: applicationsDisabled.length === 0
          ? 'No agent application configured — nothing to disable.'
          : (anyDisabled
            ? 'Application disabled — blocks new tokens for ALL users of this agent client.'
            : 'Failed to disable the agent application(s).'),
        ran: applicationsDisabled.length > 0,
        skipped: applicationsDisabled.length === 0,
        skipReason: applicationsDisabled.length === 0 ? 'no_app_configured' : undefined,
      });
    }

    // 3. Capture state BEFORE invalidating sessions
    const stateSnapshot = await captureAgentState(agentId);
    const stateSnapshotId = crypto.randomBytes(8).toString('hex');

    // 3. Invalidate sessions in Redis
    const sessionResult = await invalidateSessionsInRedis(agentId);
    pushStep({
      key: 'session_invalidate',
      label: "Invalidate this agent's local sessions",
      detail: `${sessionResult.invalidated} session key(s) removed from the local session store.`,
      ran: true,
      skipped: false,
    });

    // 4. Mark agent as revoked in session store — this is the actual enforcement
    //    point: agentRateLimit.js checks this flag before letting ANY new
    //    tool call through, so it's what makes "stop this agent" real rather
    //    than just a token-revoke that a cached/in-flight call could outrun.
    let revokedFlagSet = false;
    try {
      const sessionStore = require('../middleware/sessionConfig').store;
      if (sessionStore && sessionStore.client) {
        await sessionStore.client.setex(`agent:${agentId}:revoked`, 86400, 'true'); // 24 hour expiry
        revokedFlagSet = true;
      }
    } catch (e) {
      console.warn('[killSwitch] Could not set revoked flag:', e.message);
    }
    pushStep({
      key: 'enforcement_flag',
      label: 'Arm the next-request block',
      detail: revokedFlagSet
        ? `agent:${agentId}:revoked set for 24h — agentRateLimit rejects the agent's NEXT tool call because of this flag. A call already in flight when this ran will still complete.`
        : 'Could not set the revoked flag — the session store was unreachable. Token revocation above still applies once the agent needs a fresh token.',
      ran: revokedFlagSet,
      skipped: !revokedFlagSet,
      skipReason: revokedFlagSet ? undefined : 'session_store_unreachable',
    });

    // 5. Record kill event in audit log
    await auditLogService.recordKillEvent(agentId, reason, stateSnapshot, timeToRevoke, stateSnapshotId);
    pushStep({
      key: 'audit_log',
      label: 'Write immutable audit record',
      detail: 'Kill event recorded with reason, timing, and the state snapshot for forensic review.',
      ran: true,
      skipped: false,
    });

    const result = {
      success: true,
      revoked_at: new Date().toISOString(),
      state_snapshot_id: stateSnapshotId,
      time_to_revoke_ms: timeToRevoke,
      applications_disabled: applicationsDisabled,
      scope,
      steps,
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
