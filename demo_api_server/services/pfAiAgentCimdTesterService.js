'use strict';

// CIMD tester for the PingFederate AI Agent page, after client.dev (stytchauth/client.dev, MIT licence,
// Copyright (c) Stytch): the same two sides, here run against PingFederate.
//   Client side: check a client ID metadata document against the draft's rules (validateCimdDocument,
//   ported from client.dev's app/clients/utils.ts, plus the rules client.dev leaves out), then ask
//   PingFederate itself what it makes of good and bad documents (probePf).
//   Server side: read PingFederate's discovery document for CIMD support (checkServer); the sign-in
//   itself is the existing CIMD authorization (pfAiAgentCimdService).
// Nothing here fetches a URL the user typed: documents are pasted, or are this app's own.

const crypto = require('crypto');
const configStore = require('./configStore');
const { resolveCimdConfig, CIMD_METADATA_PATH } = require('./pfAiAgentFeatureConfig');
const { oauthError, REQUEST_TIMEOUT_MS } = require('./pfAiAgentOAuthService');
const { metadataDocument } = require('./pfAiAgentCimdService');
const { bareUrl, safeParams, step } = require('./pfAiAgentTrace');

const MAX_PASTED_BYTES = 16 * 1024;
// PingFederate's own cap on a fetched document (CIMD settings, maxFileSizeBytes, default 5120).
const PF_MAX_DOCUMENT_BYTES = 5120;
const SHARED_SECRET_METHODS = new Set(['client_secret_basic', 'client_secret_post', 'client_secret_jwt']);

// Documents that break one rule each, served by this app at fixed paths that PingFederate's CIMD
// policy allows (provision-ai-agent-features.js), so PingFederate fetches them and gives its verdict.
const NEGATIVE_PATH = '/api/pf-ai-agent/cimd/negative';
const NEGATIVE_DOCUMENTS = {
  // Served at its own URL but claiming this app's real client_id: a document impersonating another client.
  'client-id-mismatch': {
    title: 'Document claims another client\'s client_id',
    build: (good) => ({ ...good }),
  },
  'shared-secret': {
    title: 'Document asks for a shared client secret',
    build: (good, url) => ({ ...good, client_id: url, token_endpoint_auth_method: 'client_secret_basic' }),
  },
};

function hostnameOf(value) {
  try { return new URL(value).hostname; } catch { return null; }
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

// client.dev's rules, with its client_uri domain check fixed (it compared .hostname on strings, so it never fired),
// plus the draft's rules on secrets and PingFederate's size limit.
function validateCimdDocument(metadata, sourceUrl) {
  const errors = [];
  const warnings = [];
  const error = (path, message) => errors.push({ path, message });
  const warning = (path, message) => warnings.push({ path, message });
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { valid: false, errors: [{ path: 'document', message: 'The document must be a JSON object' }], warnings };
  }

  if (!metadata.client_id) error('client_id', 'Missing required field: client_id');
  else if (typeof metadata.client_id !== 'string' || !isHttpsUrl(metadata.client_id)) error('client_id', 'client_id must be an HTTPS URL');
  else if (sourceUrl && metadata.client_id !== sourceUrl) error('client_id', 'client_id must match the URL the document was fetched from');
  else if (new URL(metadata.client_id).hash || new URL(metadata.client_id).search) error('client_id', 'client_id must not carry a fragment or a query');

  if (!metadata.client_uri) warning('client_uri', 'Missing recommended field: client_uri');
  else if (hostnameOf(metadata.client_uri) !== hostnameOf(metadata.client_id)) warning('client_uri', 'client_uri should share the same host as client_id');

  if (!Array.isArray(metadata.redirect_uris)) error('redirect_uris', 'Missing required field: redirect_uris (must be an array)');
  else {
    if (metadata.redirect_uris.length === 0) error('redirect_uris', 'redirect_uris cannot be empty');
    metadata.redirect_uris.forEach((uri, index) => {
      if (typeof uri !== 'string') error(`redirect_uris[${index}]`, 'Redirect URI must be a string');
      else if (!uri.startsWith('https://') && !uri.startsWith('http://localhost') && !uri.startsWith('http://127.0.0.1')) {
        warning(`redirect_uris[${index}]`, 'Redirect URIs should use HTTPS (except localhost)');
      }
    });
    if (new Set(metadata.redirect_uris).size !== metadata.redirect_uris.length) error('redirect_uris', 'Redirect URIs must be unique');
  }

  for (const field of ['logo_uri', 'policy_uri', 'tos_uri', 'jwks_uri']) {
    if (metadata[field] === undefined) continue;
    if (typeof metadata[field] !== 'string') error(field, `${field} must be a string`);
    else if (!metadata[field].startsWith('https://')) warning(field, `${field} should use HTTPS`);
  }

  // The draft: a metadata document is public, so it cannot describe a shared secret.
  if (SHARED_SECRET_METHODS.has(metadata.token_endpoint_auth_method)) {
    error('token_endpoint_auth_method', `${metadata.token_endpoint_auth_method} needs a shared secret, which a public document cannot hold`);
  }
  if (metadata.client_secret !== undefined || metadata.client_secret_expires_at !== undefined) {
    error('client_secret', 'A metadata document must not contain a client secret');
  }

  const size = Buffer.byteLength(JSON.stringify(metadata));
  if (size > 65536) error('document', 'Document size exceeds 64KB');
  else if (size > PF_MAX_DOCUMENT_BYTES) warning('document', `Larger than PingFederate's default fetch limit (${PF_MAX_DOCUMENT_BYTES} bytes)`);
  if (typeof metadata.client_name === 'string' && metadata.client_name.length > 200) warning('client_name', 'Client name is very long (>200 characters)');

  return { valid: errors.length === 0, errors, warnings };
}

function loadConfig(store) {
  try {
    return resolveCimdConfig(store);
  } catch (error) {
    if (error.isConfigError) throw oauthError('PF_AI_CIMD_NOT_CONFIGURED', error.message, 503);
    throw error;
  }
}

function negativeUrl(config, name) {
  return `${new URL(config.clientMetadataUrl).origin}${NEGATIVE_PATH}/${name}.json`;
}

function negativeDocument(name, { store = configStore } = {}) {
  const spec = NEGATIVE_DOCUMENTS[name];
  if (!spec) return null;
  const config = loadConfig(store);
  return spec.build(metadataDocument(config), negativeUrl(config, name));
}

// Client side, part 1: this app's own document (or a pasted one), checked against the rules.
function checkClient(body, { store = configStore } = {}) {
  const config = loadConfig(store);
  if (body?.document !== undefined) {
    const text = typeof body.document === 'string' ? body.document : JSON.stringify(body.document);
    if (Buffer.byteLength(text) > MAX_PASTED_BYTES) throw oauthError('PF_AI_CIMD_DOCUMENT_TOO_LARGE', `Paste at most ${MAX_PASTED_BYTES} bytes`, 413);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw oauthError('PF_AI_CIMD_DOCUMENT_INVALID', 'The pasted text is not JSON', 400); }
    return { source: 'pasted', document: parsed, ...validateCimdDocument(parsed, null) };
  }
  const own = metadataDocument(config);
  return { source: config.clientMetadataUrl, document: own, ...validateCimdDocument(own, config.clientMetadataUrl) };
}

async function pfDiscovery(config, fetchImpl) {
  const response = await fetchImpl(config.discoveryEndpoint, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw oauthError('PF_AI_DISCOVERY_FAILED', `PingFederate discovery answered HTTP ${response.status}`);
  return response.json();
}

// Server side: does PingFederate say it accepts CIMD clients, and with PKCE?
async function checkServer({ store = configStore, fetchImpl = fetch } = {}) {
  const config = loadConfig(store);
  const document = await pfDiscovery(config, fetchImpl);
  const checks = [
    { name: 'client_id_metadata_document_supported', ok: document.client_id_metadata_document_supported === true, value: document.client_id_metadata_document_supported ?? null },
    { name: 'code_challenge_methods_supported includes S256', ok: (document.code_challenge_methods_supported || []).includes('S256'), value: document.code_challenge_methods_supported ?? null },
    { name: 'token_endpoint_auth_methods_supported includes none', ok: (document.token_endpoint_auth_methods_supported || []).includes('none'), value: document.token_endpoint_auth_methods_supported ?? null },
    { name: 'issuer matches the configured issuer', ok: document.issuer === config.issuer, value: document.issuer ?? null },
  ];
  return {
    issuer: config.issuer,
    checks,
    trace: [step({
      id: 'discovery',
      title: 'Read PingFederate discovery for CIMD support',
      request: { method: 'GET', url: config.discoveryEndpoint },
      response: { status: 200, body: Object.fromEntries(checks.map((c) => [c.name.split(' ')[0], c.value])) },
    })],
  };
}

// PingFederate answers an authorization request with its sign-in page when it accepts the client,
// or with an error page ("400 - Invalid client_id") when it does not. Read that sentence back.
function pfVerdict(status, html) {
  if (status === 200 || status === 302) return { accepted: true, pfSays: 'Sign-in page shown: client accepted' };
  const match = String(html).match(/\d{3}\s*-\s*Invalid[^<]{0,80}/i) || String(html).match(/Invalid[^<]{0,80}/i);
  return { accepted: false, pfSays: match ? match[0].trim() : `HTTP ${status}` };
}

// Client side, part 2: ask PingFederate about documents and requests it should accept or refuse.
async function probePf({ store = configStore, fetchImpl = fetch } = {}) {
  const config = loadConfig(store);
  const otherOrigin = 'https://not-registered.example.test/callback';
  const cases = [
    { id: 'valid', title: 'This app\'s document, its own redirect URI', clientId: config.clientMetadataUrl, redirectUri: config.redirectUri, expect: 'accept' },
    { id: 'redirect-not-listed', title: 'Valid document, a redirect URI it does not list', clientId: config.clientMetadataUrl, redirectUri: otherOrigin, expect: 'refuse' },
    { id: 'not-in-policy', title: 'A document URL PingFederate\'s CIMD policy does not allow', clientId: `${config.clientMetadataUrl}?variant=unlisted`, redirectUri: config.redirectUri, expect: 'refuse' },
    ...Object.entries(NEGATIVE_DOCUMENTS).map(([name, spec]) => ({
      id: name, title: spec.title, clientId: negativeUrl(config, name), redirectUri: config.redirectUri, expect: 'refuse',
    })),
  ];
  const challenge = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('base64url');
  const results = [];
  for (const probe of cases) {
    const url = new URL(config.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: probe.clientId, response_type: 'code', scope: 'openid', redirect_uri: probe.redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256', state: crypto.randomBytes(8).toString('hex'),
    }).toString();
    const response = await fetchImpl(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const verdict = pfVerdict(response.status, await response.text());
    results.push({
      ...probe,
      ...verdict,
      asExpected: verdict.accepted === (probe.expect === 'accept'),
      trace: step({
        id: `probe-${probe.id}`,
        title: probe.title,
        request: { method: 'GET', url: bareUrl(url.toString()), params: safeParams(url.searchParams) },
        response: { status: response.status, body: { pingfederate: verdict.pfSays } },
      }),
    });
  }
  return { results };
}

module.exports = {
  NEGATIVE_PATH,
  NEGATIVE_DOCUMENTS,
  validateCimdDocument,
  negativeDocument,
  checkClient,
  checkServer,
  probePf,
};
