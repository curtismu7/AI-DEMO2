'use strict';

// OAuth clients in PingFederate for agents the demo registers at run time.
//
// A delegated-commerce agent is its own PingOne application, so that PingOne
// issues tokens with THAT agent as the actor. Under a PingFederate sign-in the
// tokens come from PingFederate, which has no client for the agent — so the
// agent could not act, and the generic agent acted in its place. This gives the
// agent a PingFederate client with the same client id and secret as its PingOne
// application, cloned from the built-in AI-agent actor client so it gets the
// same grant types, token manager and scopes.
//
// Settings are the ones the readiness audit already uses for its PingFederate
// reads (demoReadinessRunner.js): PINGFEDERATE_ADMIN_API_BASE, _USER,
// _TLS_INSECURE in env, and the admin password from env or the vault entry
// PF_ADMIN_CONSOLE_PASSWORD.

const axios = require('axios');
const https = require('node:https');
const configStore = require('./configStore');

const TIMEOUT_MS = 15_000;

function settings() {
  const base = String(process.env.PINGFEDERATE_ADMIN_API_BASE || '').replace(/\/$/, '');
  // Same two reads as demoReadinessRunner's inProcessSettings: the vault loader
  // caches an entry under its own name, which get() finds.
  const password = process.env.PINGFEDERATE_ADMIN_PASSWORD
    || configStore.getEffective('PF_ADMIN_CONSOLE_PASSWORD')
    || configStore.get?.('PF_ADMIN_CONSOLE_PASSWORD')
    || '';
  return {
    base,
    password,
    user: process.env.PINGFEDERATE_ADMIN_USER || 'administrator',
    // The local admin console is self-signed; skipped only when the operator says so.
    insecure: process.env.PINGFEDERATE_ADMIN_TLS_INSECURE === '1',
  };
}

function isConfigured() {
  const s = settings();
  return Boolean(s.base && s.password);
}

async function call(method, path, body) {
  const s = settings();
  if (!s.base || !s.password) {
    throw Object.assign(new Error('PingFederate Admin API is not configured.'), { code: 'pf_admin_not_configured', httpStatus: 503 });
  }
  try {
    return await axios({
      method,
      url: `${s.base}${path}`,
      data: body,
      auth: { username: s.user, password: s.password },
      headers: { 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json' },
      httpsAgent: new https.Agent({ rejectUnauthorized: !s.insecure }),
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
  } catch (err) {
    // Never rethrow the axios error: it carries the Authorization header.
    throw Object.assign(new Error(`PingFederate Admin API ${method} ${path} failed: ${err.code || 'request_failed'}`), {
      code: 'pf_admin_unreachable', httpStatus: 502,
    });
  }
}

/**
 * Create a PingFederate client for a registered agent, cloned from the built-in
 * AI-agent actor client.
 * @returns {Promise<{clientId: string}>}
 */
async function createAgentClient({ clientId, clientSecret, name }) {
  const templateId = configStore.getEffective('pf_ai_agent_actor_client_id');
  if (!templateId) {
    throw Object.assign(new Error('PF_AI_AGENT_ACTOR_CLIENT_ID is not configured, so there is no client to model the agent on.'), {
      code: 'pf_agent_template_not_configured', httpStatus: 503,
    });
  }
  const template = await call('GET', `/oauth/clients/${encodeURIComponent(templateId)}`);
  if (template.status !== 200) {
    throw Object.assign(new Error(`PingFederate returned HTTP ${template.status} for the AI-agent actor client.`), {
      code: 'pf_agent_template_unavailable', httpStatus: 502,
    });
  }
  const { modificationDate, creationDate, clientSecretChangedTime, ...client } = template.data;
  const created = await call('POST', '/oauth/clients', {
    ...client,
    clientId,
    name,
    description: 'Delegated-commerce agent (created by the demo BFF; removed with its registration)',
    clientAuth: { type: 'SECRET', secret: clientSecret },
  });
  if (created.status !== 201 && created.status !== 200) {
    // Do not surface the response body: a client representation carries secret fields.
    throw Object.assign(new Error(`PingFederate returned HTTP ${created.status} creating the agent client.`), {
      code: 'pf_agent_client_create_failed', httpStatus: 502,
    });
  }
  return { clientId };
}

/** Delete an agent's PingFederate client. A client that is already gone is fine. */
async function deleteClient(clientId) {
  const res = await call('DELETE', `/oauth/clients/${encodeURIComponent(clientId)}`);
  if (res.status !== 204 && res.status !== 404) {
    throw Object.assign(new Error(`PingFederate returned HTTP ${res.status} deleting the agent client.`), {
      code: 'pf_agent_client_delete_failed', httpStatus: 502,
    });
  }
  return res.status === 204;
}

module.exports = { isConfigured, createAgentClient, deleteClient };
