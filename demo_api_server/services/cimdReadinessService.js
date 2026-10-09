'use strict';

/**
 * cimdReadinessService.js — read-only check that this demo can sign in to the Agent Privilege by
 * Client ID Metadata Document instead of Dynamic Client Registration.
 *
 * It answers three questions, each as pass/fail with a one-line reason:
 *   1. Does the gateway's authorization server say it supports client documents?
 *   2. Does our client document fetch the way Privilege would fetch it?
 *   3. Does the document pass the rules (client_id equals its URL, lists this client's callback, public client)?
 *
 * Targets come from server config, never from request input, so the check cannot be pointed at an arbitrary
 * host. The document URL is built from PUBLIC_APP_URL: on the SE host that is the address Privilege can fetch;
 * on a local stack it is not reachable by Privilege, which the result's `documentUrl` makes visible.
 */

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

// Mirrors routes/privilegeMcpClient.js (PRIVILEGE_GATEWAY_HOST, PRIVILEGE_APP, the /auth/callback path).
const GATEWAY_HOST = 'https://mcpgw.ai-demo.ping-devops.com';
const DEFAULT_APP = 'opensearch22';
const DOCUMENT_SLUG = 'privilege-mcp-client';
const CALLBACK_PATH = '/api/privilege-mcp/auth/callback';

// The origin the client document is fetched from: PRIVILEGE_CIMD_DOCUMENT_ORIGIN when a local stack signs in with
// the public host's document (see cimdDocumentOrigin in routes/privilegeMcpClient.js), otherwise this app's own.
function documentOrigin(env, base) {
  try {
    if (env.PRIVILEGE_CIMD_DOCUMENT_ORIGIN) return new URL(env.PRIVILEGE_CIMD_DOCUMENT_ORIGIN).origin;
  } catch {
    // malformed value: use this app's own origin
  }
  return base;
}

function targets(env = process.env) {
  const base = String(env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const docBase = documentOrigin(env, base);
  const app = env.MCP_FACADE_PRIVILEGE_GATEWAY_APP || DEFAULT_APP;
  return {
    asMetadataUrl: env.PRIVILEGE_CIMD_AS_METADATA_URL || `${GATEWAY_HOST}/${app}/.well-known/oauth-authorization-server`,
    documentUrl: docBase ? `${docBase}/api/cimd/privilege/${DOCUMENT_SLUG}/client-metadata.json` : null,
    // Always this app's own callback: it is where the browser returns, wherever the document is hosted.
    callbackUrl: base ? `${base}${CALLBACK_PATH}` : null
  };
}

async function getJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // redirect: 'manual' so a sign-in redirect shows up as "HTTP 302" rather than being followed to a login page.
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' }, redirect: 'manual' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    if (text.length > MAX_BYTES) return { error: 'response larger than 64 KB' };
    try {
      return { json: JSON.parse(text) };
    } catch {
      return { error: 'response is not JSON' };
    }
  } catch (err) {
    return { error: err && err.name === 'AbortError' ? 'timed out' : 'could not connect' };
  } finally {
    clearTimeout(timer);
  }
}

const check = (id, label, pass, detail) => ({ id, label, pass: Boolean(pass), detail });

function authServerChecks(as) {
  if (as.error) return [check('as_metadata', 'Gateway authorization server metadata fetches', false, as.error)];
  const meta = as.json || {};
  const methods = meta.token_endpoint_auth_methods_supported;
  return [
    check('as_metadata', 'Gateway authorization server metadata fetches', true, 'HTTP 200, JSON'),
    check(
      'as_supports_cimd',
      'Gateway advertises client_id_metadata_document_supported',
      meta.client_id_metadata_document_supported === true,
      meta.client_id_metadata_document_supported === true ? 'true' : 'not advertised'
    ),
    check(
      'as_public_client',
      "Gateway accepts token_endpoint_auth_method 'none' (public client)",
      Array.isArray(methods) && methods.includes('none'),
      Array.isArray(methods) ? methods.join(', ') : 'not advertised'
    )
  ];
}

function documentChecks(doc, { documentUrl, callbackUrl }) {
  if (!documentUrl) {
    return [check('doc_fetch', 'Client document fetches', false, 'PUBLIC_APP_URL is not set, so there is no document URL')];
  }
  if (doc.error) return [check('doc_fetch', 'Client document fetches', false, doc.error)];
  const body = doc.json || {};
  const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const grants = Array.isArray(body.grant_types) ? body.grant_types : [];
  const auth = body.token_endpoint_auth_method;
  return [
    check('doc_fetch', 'Client document fetches', true, 'HTTP 200, JSON'),
    check('doc_client_id', 'client_id equals the document URL', body.client_id === documentUrl, body.client_id === documentUrl ? 'matches' : `document says ${body.client_id || 'nothing'}`),
    callbackUrl
      ? check('doc_redirect', "Document lists this client's callback", redirects.includes(callbackUrl), redirects.includes(callbackUrl) ? callbackUrl : `callback ${callbackUrl} is not in redirect_uris`)
      : check('doc_redirect', "Document lists this client's callback", false, "PUBLIC_APP_URL is not set, so this client's callback is unknown"),
    check('doc_public_client', 'Document declares a public client', auth === 'none' || auth === undefined, `token_endpoint_auth_method: ${auth === undefined ? 'absent' : auth}`),
    check('doc_grant', 'Document allows authorization_code', grants.includes('authorization_code'), grants.join(', ') || 'no grant_types')
  ];
}

async function runReadiness({ env = process.env, fetchImpl = fetch } = {}) {
  const t = targets(env);
  const [as, doc] = await Promise.all([
    getJson(t.asMetadataUrl, fetchImpl),
    t.documentUrl ? getJson(t.documentUrl, fetchImpl) : Promise.resolve({})
  ]);
  const checks = [...authServerChecks(as), ...documentChecks(doc, t)];
  return { ok: checks.every((c) => c.pass), checks, targets: t };
}

module.exports = { runReadiness, targets, DOCUMENT_SLUG, CALLBACK_PATH };
