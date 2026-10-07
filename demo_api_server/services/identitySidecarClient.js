'use strict';

/**
 * Identity-sidecar client (ff_agent_identity_sidecar).
 *
 * When the flag is ON, the BFF asks the identity sidecar for the default AI
 * Agent's actor token instead of running client_credentials with
 * PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET itself. The caller names a target; the
 * sidecar owns scope, audience and resource, and caches one token per target.
 *
 * No silent fallback: with the flag ON and the sidecar unable to supply a token
 * the call fails, so a broken sidecar is never hidden behind the old path.
 */

const axios = require('axios');
const configStore = require('./configStore');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const DEFAULT_URL = 'http://agent-identity-sidecar:8097';
const DEFAULT_TARGET = 'agent-gateway';
const TIMEOUT_MS = 10000;

function isEnabled() {
  return configStore.getEffective('ff_agent_identity_sidecar') === 'true';
}

/**
 * @param {string} [target] sidecar target name (default: the Agent Gateway actor)
 * @returns {Promise<string>} access token
 */
async function fetchActorToken(target = DEFAULT_TARGET) {
  const apiKey = process.env.AGENT_IDENTITY_SIDECAR_API_KEY;
  if (!apiKey) throw new Error('AGENT_IDENTITY_SIDECAR_API_KEY is not set');
  const url = `${(process.env.AGENT_IDENTITY_SIDECAR_URL || DEFAULT_URL).replace(/\/+$/, '')}/v1/token`;

  let data;
  try {
    ({ data } = await axios.post(url, { target }, { headers: { 'x-api-key': apiKey }, timeout: TIMEOUT_MS }));
  } catch (err) {
    throw normalizeAxiosError(err, { label: `Identity sidecar (target ${target})`, timeoutMs: TIMEOUT_MS });
  }
  if (!data || !data.access_token) throw new Error('Identity sidecar response missing access_token');
  return data.access_token;
}

module.exports = { isEnabled, fetchActorToken, DEFAULT_TARGET };
