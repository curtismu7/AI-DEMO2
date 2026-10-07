'use strict';

/**
 * Client for the identity sidecar's credential-injecting relay (ff_agent_identity_sidecar).
 *
 * For a client the sidecar manages, the BFF builds the same form it always did (token exchange,
 * client credentials, PAR, introspection) but leaves the secret out and posts it here. The
 * sidecar authenticates the client and forwards the request to PingOne; this module hands back
 * an axios-shaped result (and an axios-shaped error with `.response`), so each call site's
 * existing response handling and `catch` blocks keep working unchanged.
 *
 * `manages(clientId)` is the one question every call site asks first. It is false whenever the
 * flag is OFF, so with the flag OFF every site runs exactly the code it ran before. With the flag
 * ON there is no silent fallback: an unreachable sidecar is an error, not a quiet return to the
 * local secret.
 */

const axios = require('axios');
const identitySidecar = require('./identitySidecarClient');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const CLIENTS_TTL_MS = 30000;
const RELAY_TIMEOUT_MS = 15000;

let clientsCache = { ids: null, at: 0 };

async function managedClientIds() {
  if (clientsCache.ids && Date.now() - clientsCache.at < CLIENTS_TTL_MS) return clientsCache.ids;
  const { url, options } = identitySidecar.endpoint('/v1/clients');
  let data;
  try {
    ({ data } = await axios.get(url, options));
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'Identity sidecar (client list)', timeoutMs: options.timeout });
  }
  clientsCache = { ids: new Set(Array.isArray(data && data.clients) ? data.clients : []), at: Date.now() };
  return clientsCache.ids;
}

/** True when the flag is ON and the sidecar holds this client's credentials. */
async function manages(clientId) {
  if (!clientId || !identitySidecar.isEnabled()) return false;
  return (await managedClientIds()).has(clientId);
}

/**
 * The client ids the sidecar manages, or an empty set when the flag is OFF. For synchronous config
 * checks that cannot await `manages` themselves: their async caller resolves this once and hands it in.
 */
async function managedIds() {
  if (!identitySidecar.isEnabled()) return new Set();
  return managedClientIds();
}

function parseBody(text, contentType) {
  if (typeof text !== 'string') return text;
  if (!/json/i.test(String(contentType || ''))) return text;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

/**
 * POST a form (URLSearchParams that includes client_id and NOT the secret) to PingOne's
 * `token`, `par` or `introspect` endpoint through the sidecar.
 * @returns {Promise<{status: number, data: any, headers: object}>} on a 2xx
 * @throws an Error with an axios-style `.response` ({status, data, headers}) on any other status
 */
async function post(kind, params) {
  const { url, options } = identitySidecar.endpoint(`/as/${kind}`);
  let upstream;
  try {
    upstream = await axios.post(url, new URLSearchParams(params).toString(), {
      ...options,
      timeout: RELAY_TIMEOUT_MS,
      headers: { ...options.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      // Relay every status: PingOne's own error body is what the caller's catch block reads.
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: (d) => d,
    });
  } catch (err) {
    throw normalizeAxiosError(err, { label: `Identity sidecar relay (${kind})`, timeoutMs: RELAY_TIMEOUT_MS });
  }
  const response = {
    status: upstream.status,
    data: parseBody(upstream.data, upstream.headers['content-type']),
    headers: upstream.headers,
  };
  if (upstream.status >= 200 && upstream.status < 300) return response;
  const err = new Error(`Request failed with status code ${upstream.status}`);
  err.response = response;
  throw err;
}

function resetForTests() {
  clientsCache = { ids: null, at: 0 };
}

module.exports = { manages, managedIds, post, resetForTests };
