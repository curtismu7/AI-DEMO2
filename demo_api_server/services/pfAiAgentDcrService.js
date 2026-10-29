'use strict';

// Dynamic client registration (RFC 7591, managed per RFC 7592) at PingFederate, in four server-side
// steps: get an initial access token, register a client with it, get a token as that client, then
// delete the client with its registration access token. Each step also shows what PingFederate
// refuses (no initial access token, a scope the client may not have, a deleted client). The new
// client's secret and every token stay in the server-side session; the page gets the redacted
// trace (pfAiAgentTrace) and decoded claims.

const configStore = require('./configStore');
const { resolveDcrConfig } = require('./pfAiAgentFeatureConfig');
const { oauthError, REQUEST_TIMEOUT_MS } = require('./pfAiAgentOAuthService');
const { safeParams, safeBody, bareUrl, claimsOf, step } = require('./pfAiAgentTrace');

const PENDING_TTL_MS = 10 * 60 * 1000;
const IAT_SCOPE = 'dcr:register';
const CLIENT_SCOPE = 'accounts:read';
// A scope PingFederate's DCR settings do not let a registered client have.
const FORBIDDEN_SCOPE = 'admin:write';
const REGISTRATION = {
  client_name: 'AI Demo agent (registered by DCR)',
  grant_types: ['client_credentials'],
  token_endpoint_auth_method: 'client_secret_basic',
  scope: CLIENT_SCOPE,
};

function loadConfig(store) {
  try {
    return resolveDcrConfig(store);
  } catch (error) {
    if (error.isConfigError) throw oauthError('PF_AI_DCR_NOT_CONFIGURED', error.message, 503);
    throw error;
  }
}

function basic(id, secret) {
  return `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
}

// PingFederate answers JSON; anything else (an HTML error page) is reported by status only.
async function call(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { note: 'PingFederate did not answer with JSON' }; }
  return { status: response.status, ok: response.ok, body };
}

function tokenRequest(fetchImpl, config, clientId, clientSecret, scope) {
  const params = new URLSearchParams({ grant_type: 'client_credentials', scope });
  return {
    traceRequest: {
      method: 'POST', url: bareUrl(config.tokenEndpoint),
      headers: { Authorization: `Basic <${clientId}:client secret, redacted>` }, params: safeParams(params),
    },
    send: () => call(fetchImpl, config.tokenEndpoint, {
      method: 'POST',
      headers: { Authorization: basic(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params,
    }),
  };
}

function session(req) {
  req.session.pfAiAgent ||= {};
  return req.session.pfAiAgent;
}

function pending(req, now, need) {
  const dcr = req?.session?.pfAiAgent?.dcr;
  if (!dcr || dcr.expiresAt <= now() || !dcr[need]) {
    throw oauthError('PF_AI_DCR_STEP_ORDER', 'Run the earlier steps first (the run expires after 10 minutes)', 409);
  }
  return dcr;
}

function pfRefused(code, what, result) {
  const reason = [result.body?.error, result.body?.error_description].filter(Boolean).join(': ');
  return oauthError(code, `PingFederate refused ${what} (HTTP ${result.status}${reason ? `, ${reason}` : ''})`, 502);
}

// Step 1: the client that is allowed to register others gets an initial access token (scope dcr:register).
async function initialToken(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const config = loadConfig(store);
  const request = tokenRequest(fetchImpl, config, config.iatClientId, config.iatClientSecret, IAT_SCOPE);
  const result = await request.send();
  if (!result.ok || !result.body.access_token) throw pfRefused('PF_AI_DCR_IAT_REFUSED', 'the initial access token request', result);
  const claims = claimsOf(result.body.access_token);
  const trace = [step({
    id: 'initial-access-token',
    title: 'Get an initial access token (scope dcr:register)',
    request: request.traceRequest,
    response: { status: result.status, body: safeBody(result.body) },
    claims: { accessToken: claims },
    note: 'Without this token PingFederate refuses every registration: anyone who can reach the endpoint cannot just add clients.',
  })];
  session(req).dcr = { iat: result.body.access_token, trace, expiresAt: now() + PENDING_TTL_MS };
  return { trace, claims };
}

// Step 2: register, first without the initial access token (refused), then with it.
async function register(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const dcr = pending(req, now, 'iat');
  const config = loadConfig(store);
  const post = (headers) => call(fetchImpl, config.registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(REGISTRATION),
  });
  const anonymous = await post({});
  const result = await post({ Authorization: `Bearer ${dcr.iat}` });
  if (!result.ok || !result.body.client_id || !result.body.client_secret) throw pfRefused('PF_AI_DCR_REGISTER_REFUSED', 'the registration', result);
  dcr.client = {
    clientId: result.body.client_id,
    clientSecret: result.body.client_secret,
    registrationAccessToken: result.body.registration_access_token,
  };
  delete dcr.iat;
  dcr.trace.push(
    step({
      id: 'register-anonymous',
      title: 'Register with no initial access token',
      request: { method: 'POST', url: bareUrl(config.registrationEndpoint), params: REGISTRATION },
      response: { status: anonymous.status, body: safeBody(anonymous.body) },
      note: anonymous.ok ? 'PingFederate accepted an anonymous registration: open registration is on.' : 'Refused, as it should be.',
    }),
    step({
      id: 'register',
      title: 'Register with the initial access token',
      request: {
        method: 'POST', url: bareUrl(config.registrationEndpoint),
        headers: { Authorization: 'Bearer <initial access token, redacted>' }, params: REGISTRATION,
      },
      response: { status: result.status, body: safeBody(result.body) },
      note: 'PingFederate picked the client_id and the secret. The registration access token lets this client manage, and delete, itself.',
    }),
  );
  return { trace: dcr.trace, clientId: dcr.client.clientId, anonymousRefused: !anonymous.ok };
}

// Step 3: a token as the new client, then a scope its registration does not allow.
async function useClient(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const dcr = pending(req, now, 'client');
  const config = loadConfig(store);
  const { clientId, clientSecret } = dcr.client;
  const allowed = tokenRequest(fetchImpl, config, clientId, clientSecret, CLIENT_SCOPE);
  const allowedResult = await allowed.send();
  const forbidden = tokenRequest(fetchImpl, config, clientId, clientSecret, FORBIDDEN_SCOPE);
  const forbiddenResult = await forbidden.send();
  if (!allowedResult.ok) throw pfRefused('PF_AI_DCR_TOKEN_REFUSED', `a token for ${CLIENT_SCOPE}`, allowedResult);
  const claims = claimsOf(allowedResult.body.access_token);
  dcr.trace.push(
    step({
      id: 'client-token',
      title: `Get a token as the new client (${CLIENT_SCOPE})`,
      request: allowed.traceRequest,
      response: { status: allowedResult.status, body: safeBody(allowedResult.body) },
      claims: { accessToken: claims },
    }),
    step({
      id: 'client-token-forbidden',
      title: `Ask for a scope the registration does not allow (${FORBIDDEN_SCOPE})`,
      request: forbidden.traceRequest,
      response: { status: forbiddenResult.status, body: safeBody(forbiddenResult.body) },
      note: forbiddenResult.ok
        ? 'PingFederate issued it: the DCR scope restriction is off.'
        : 'Refused: PingFederate limits what a self-registered client may ask for.',
    }),
  );
  return { trace: dcr.trace, claims, forbiddenRefused: !forbiddenResult.ok };
}

// Step 4: the client deletes itself with its registration access token; its credentials then stop working.
async function remove(req, { store = configStore, fetchImpl = fetch, now = Date.now } = {}) {
  const dcr = pending(req, now, 'client');
  const config = loadConfig(store);
  const { clientId, clientSecret, registrationAccessToken } = dcr.client;
  // Built from the configured endpoint, never from PingFederate's reply, so the call cannot leave PingFederate.
  const clientUri = `${config.registrationEndpoint}/${encodeURIComponent(clientId)}`;
  const result = await call(fetchImpl, clientUri, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${registrationAccessToken}`, Accept: 'application/json' },
  });
  if (!result.ok) throw pfRefused('PF_AI_DCR_DELETE_REFUSED', 'the delete', result);
  const after = tokenRequest(fetchImpl, config, clientId, clientSecret, CLIENT_SCOPE);
  const afterResult = await after.send();
  dcr.trace.push(
    step({
      id: 'delete',
      title: 'Delete the client with its registration access token',
      request: { method: 'DELETE', url: clientUri, headers: { Authorization: 'Bearer <registration access token, redacted>' } },
      response: { status: result.status, body: safeBody(result.body) },
    }),
    step({
      id: 'deleted-token',
      title: 'Try the deleted client once more',
      request: after.traceRequest,
      response: { status: afterResult.status, body: safeBody(afterResult.body) },
      note: afterResult.ok ? 'PingFederate still issued a token after the delete.' : 'Refused: the client is gone.',
    }),
  );
  const trace = dcr.trace;
  delete session(req).dcr;
  return { trace, deletedRefused: !afterResult.ok };
}

module.exports = { initialToken, register, useClient, remove };
