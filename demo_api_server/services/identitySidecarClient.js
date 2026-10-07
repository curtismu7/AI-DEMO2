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
 *
 * The sidecar's target is static, but the BFF's Agent Gateway audience and scope
 * are configurable. A caller that knows what it expects passes `audience` and/or
 * `scope`, and a token that does not carry them is rejected rather than handed to
 * the exchange as the wrong actor.
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

function decodePayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
  } catch (_) {
    return null;
  }
}

/** Throws if the token does not carry the audience / every scope the caller expects. */
function assertTokenMatches(token, { audience, scope } = {}) {
  if (!audience && !scope) return;
  const claims = decodePayload(token);
  if (!claims) throw new Error('Identity sidecar token is not a JWT, so its audience and scope cannot be verified');

  if (audience) {
    const auds = [].concat(claims.aud || []);
    if (!auds.includes(audience)) {
      throw new Error(`Identity sidecar token audience [${auds.join(', ')}] does not include the expected ${audience}`);
    }
  }
  if (scope) {
    const have = String(claims.scope || '').split(/\s+/).filter(Boolean);
    const want = (Array.isArray(scope) ? scope : String(scope).split(/\s+/)).filter(Boolean);
    const missing = want.filter((s) => !have.includes(s));
    if (missing.length) {
      throw new Error(`Identity sidecar token scope "${have.join(' ')}" is missing the expected ${missing.join(' ')}`);
    }
  }
}

/**
 * @param {{target?: string, audience?: string, scope?: string|string[]}} [opts]
 *   target: sidecar target name (default: the Agent Gateway actor).
 *   audience / scope: what the caller expects the token to carry; checked, not requested.
 * @returns {Promise<string>} access token
 */
async function fetchActorToken({ target = DEFAULT_TARGET, audience, scope } = {}) {
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
  assertTokenMatches(data.access_token, { audience, scope });
  return data.access_token;
}

module.exports = { isEnabled, fetchActorToken, assertTokenMatches, DEFAULT_TARGET };
