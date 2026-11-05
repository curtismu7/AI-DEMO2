'use strict';

// PingFederate Authentication API (pi.flow), shown step by step for the PingFederate AI Agent page: an
// authorization request with response_mode=pi.flow returns a JSON flow (status + _links) instead of a login
// page, so a native or agent client can render the sign-in itself. This opens a real flow with the app's own
// pi.flow-enabled sign-in client and reads it back; it never sends a credential. The app's PingFederate
// sign-in (services/piFlowDriver.js) drives the same API to completion.

const crypto = require('crypto');
const configStore = require('./configStore');
const { resolveCimdConfig } = require('./pfAiAgentFeatureConfig');
const { oauthError, REQUEST_TIMEOUT_MS } = require('./pfAiAgentOAuthService');
const { safeParams, bareUrl, shortened, step } = require('./pfAiAgentTrace');

const FLOW_ID = /^[A-Za-z0-9_-]{6,64}$/;

function loadConfig(store) {
  let pf;
  try {
    pf = resolveCimdConfig(store);
  } catch (error) {
    if (error.isConfigError) throw oauthError('PF_AI_PIFLOW_NOT_CONFIGURED', error.message, 503);
    throw error;
  }
  const clientId = String(store.getEffective('pf_user_client_id') || '').trim();
  const redirectUri = String(store.getEffective('pf_user_redirect_uri') || '').trim();
  if (!clientId || !redirectUri) {
    throw oauthError('PF_AI_PIFLOW_NOT_CONFIGURED', 'PF_USER_CLIENT_ID and PF_USER_REDIRECT_URI name the pi.flow sign-in client', 503);
  }
  return { ...pf, clientId, redirectUri };
}

// What a client renders from: the status, the actions offered, and the fields of embedded objects. The flow id
// is a bearer handle to this sign-in, so it is shortened; links are reduced to their names.
function flowView(flow) {
  return {
    id: shortened(flow.id),
    status: flow.status,
    actions: Object.keys(flow._links || {}),
    ...(flow._embedded ? { embedded: Object.keys(flow._embedded) } : {}),
    ...(flow.usernameHint ? { usernameHint: flow.usernameHint } : {}),
  };
}

function cookieHeader(response) {
  const raw = typeof response.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function openFlow(req, { store = configStore, fetchImpl = fetch } = {}) {
  const config = loadConfig(store);
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    response_mode: 'pi.flow',
    redirect_uri: config.redirectUri,
    scope: 'openid profile',
    state: crypto.randomBytes(12).toString('base64url'),
    code_challenge: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  const opened = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const flow = await opened.json().catch(() => null);
  if (!opened.ok || !FLOW_ID.test(String(flow?.id || ''))) {
    throw oauthError('PF_AI_PIFLOW_NOT_OPENED', `PingFederate did not open a flow (HTTP ${opened.status}). The client needs "Allow Authentication API OAuth initiation" (scripts/pingfederate/enable-pi-flow-user-client.js).`, 502);
  }

  // The flow lives on PingFederate, tied to its session cookie: read it back the way a client polls it.
  const flowUrl = `${new URL(config.tokenEndpoint).origin}/pf-ws/authn/flows/${flow.id}`;
  const again = await fetchImpl(flowUrl, {
    headers: { Accept: 'application/json', 'X-XSRF-Header': 'PingFederate', Cookie: cookieHeader(opened) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const reread = await again.json().catch(() => ({}));

  const trace = [
    step({
      id: 'open',
      title: 'Ask PingFederate for a sign-in flow instead of a login page',
      request: { method: 'GET', url: bareUrl(url.toString()), params: safeParams(url.searchParams) },
      response: { status: opened.status, body: flowView(flow) },
      note: 'response_mode=pi.flow: PingFederate answers with JSON. The client renders the form named by status and posts to one of the actions.',
    }),
    step({
      id: 'read',
      title: 'Read the flow back from the Authentication API',
      request: { method: 'GET', url: `${bareUrl(flowUrl).replace(flow.id, shortened(flow.id))}`, headers: { 'X-XSRF-Header': 'PingFederate', Cookie: '<PingFederate session cookie, redacted>' } },
      response: { status: again.status, body: again.ok ? flowView(reread) : {} },
      note: 'The flow and its state stay on PingFederate. A client moves it on by posting to an action, for example checkUsernamePassword with a username and password.',
    }),
  ];
  return { status: flow.status, actions: Object.keys(flow._links || {}), trace };
}

module.exports = { openFlow, flowView };
