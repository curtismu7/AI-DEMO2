'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { logger } = require('../utils/logger');

let _cachedToken = null;
let _tokenExpiry = 0;

async function _getWorkerToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const region = configStore.getEffective('pingone_region') || 'com';
  const envId = configStore.getEffective('pingone_environment_id');
  const clientId = configStore.getEffective('pingone_worker_token_client_id');
  const clientSecret = configStore.getEffective('pingone_worker_token_client_secret');

  if (!envId || !clientId || !clientSecret) {
    throw new Error('pingOneSessionService: worker credentials not configured');
  }

  const response = await axios.post(
    `https://auth.pingone.${region}/${envId}/as/token`,
    'grant_type=client_credentials',
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 5000,
    }
  );

  _cachedToken = response.data.access_token;
  _tokenExpiry = Date.now() + (response.data.expires_in - 30) * 1000;
  return _cachedToken;
}

function _apiBase() {
  const region = configStore.getEffective('pingone_region') || 'com';
  const envId = configStore.getEffective('pingone_environment_id');
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

/**
 * Fetch all active PingOne sessions for a user.
 * GET /environments/{envId}/users/{userId}/sessions
 * @param {string} userId - PingOne user ID (sub claim)
 * @returns {Promise<Array<{id: string, createdAt: string}>>} empty array on error or 404
 */
async function getUserSessions(userId) {
  if (!userId) return [];
  try {
    const token = await _getWorkerToken();
    const response = await axios.get(
      `${_apiBase()}/users/${userId}/sessions`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      }
    );
    return response.data?._embedded?.sessions || [];
  } catch (err) {
    if (err.response?.status === 404) return [];
    logger.warn('[pingOneSessionService] getUserSessions failed', { userId, error: err.message });
    return [];
  }
}

/**
 * Terminate specific PingOne sessions by ID.
 * DELETE /environments/{envId}/users/{userId}/sessions/{sessionId}
 * @param {string} userId - PingOne user ID
 * @param {string[]} sessionIds - session IDs to delete
 * @returns {Promise<{terminated: number, errors: string[]}>}
 */
async function terminateUserSessions(userId, sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return { terminated: 0, errors: [] };

  const token = await _getWorkerToken();
  const base = _apiBase();
  let terminated = 0;
  const errors = [];

  await Promise.all(
    sessionIds.map(async (sessionId) => {
      try {
        await axios.delete(`${base}/users/${userId}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000,
        });
        terminated++;
        logger.info('[pingOneSessionService] session terminated', { userId, sessionId });
      } catch (err) {
        errors.push(`${sessionId}: ${err.message}`);
        logger.warn('[pingOneSessionService] session termination failed', { userId, sessionId, error: err.message });
      }
    })
  );

  return { terminated, errors };
}

/**
 * Read then terminate all active PingOne sessions for a user.
 * Used by logout — NOT by STOP AGENT (which only revokes tokens).
 * @param {string} userId - PingOne user ID (sub claim from session)
 * @returns {Promise<{sessions_found: number, terminated: number, errors: string[]}>}
 */
async function terminateAllUserSessions(userId) {
  if (!userId) {
    logger.warn('[pingOneSessionService] terminateAllUserSessions: no userId — skipping');
    return { sessions_found: 0, terminated: 0, errors: [] };
  }

  const sessions = await getUserSessions(userId);
  const sessionIds = sessions.map(s => s.id);

  logger.info('[pingOneSessionService] terminating sessions', { userId, count: sessionIds.length });

  const result = await terminateUserSessions(userId, sessionIds);
  return { sessions_found: sessionIds.length, ...result };
}

module.exports = { getUserSessions, terminateUserSessions, terminateAllUserSessions };
