'use strict';

/**
 * connectorSandbox.js — a self-contained "ChatGPT connector" flow: an MCP client (stand-in for ChatGPT/Claude), an
 * authorization server, a protected MCP gateway, a policy decision point and a downstream API, all in this process so
 * every step of the 12-step diagram runs real logic that can be inspected:
 *
 *   - discovery documents (RFC 9728 protected-resource, RFC 8414 AS metadata),
 *   - a Client ID Metadata Document (CIMD) client with private_key_jwt and a published JWKS,
 *   - authorization code + PKCE (S256), a consent screen that stores a consent record,
 *   - RS256 client assertion verified against the client's JWKS, one-time codes, jti replay protection,
 *   - an audience-bound RS256 access token the gateway verifies (signature, iss, aud, exp, scope, member, consent),
 *   - a policy decision with the inputs the diagram lists. THAT part is simulated: no PingOne Authorize policy exists
 *     for these attributes, so the decision is made by the rules in `decide()` and labelled as such.
 *
 * The member is whoever is signed in to the demo (PingOne session); this AS does not run its own login.
 * State is in memory: a restart invalidates runs, codes and tokens (keys are regenerated).
 */

const crypto = require('crypto');

const BASE_PATH = '/api/connector-sandbox';
const SCOPE = 'benefits:read';
const CODE_TTL_MS = 60 * 1000;
const TOKEN_TTL_S = 600;
const MAX_RUNS = 200;

const b64u = (input) => Buffer.from(input).toString('base64url');
const sha256b64u = (input) => crypto.createHash('sha256').update(input).digest('base64url');
const random = (n = 24) => crypto.randomBytes(n).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------------------------------------------- keys
let keys = null;
function makeKey(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } };
}
function getKeys() {
  if (!keys) keys = { client: makeKey('chatgpt-sandbox-1'), as: makeKey('optum-sandbox-as-1') };
  return keys;
}

function signJwt(key, claims, typ = 'JWT') {
  const data = `${b64u(JSON.stringify({ alg: 'RS256', typ, kid: key.kid }))}.${b64u(JSON.stringify(claims))}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), key.privateKey).toString('base64url')}`;
}

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()), payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()) };
  } catch { return null; }
}

function verifyJwt(token, jwk) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  try {
    return crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch { return false; }
}

// ------------------------------------------------------------------------------------------------------------ documents
function urls(origin) {
  const base = `${origin}${BASE_PATH}`;
  return {
    base,
    resource: `${base}/mcp`,
    prm: `${base}/.well-known/oauth-protected-resource`,
    issuer: `${base}/as`,
    asMeta: `${base}/as/.well-known/oauth-authorization-server`,
    authorize: `${base}/as/authorize`,
    token: `${base}/as/token`,
    asJwks: `${base}/as/jwks.json`,
    clientId: `${base}/client.json`,
    clientJwks: `${base}/jwks.json`,
    redirect: `${base}/callback`,
  };
}

const protectedResourceMetadata = (origin) => {
  const u = urls(origin);
  return { resource: u.resource, authorization_servers: [u.issuer], scopes_supported: [SCOPE], bearer_methods_supported: ['header'] };
};
const authorizationServerMetadata = (origin) => {
  const u = urls(origin);
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    jwks_uri: u.asJwks,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    scopes_supported: [SCOPE],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ['private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['RS256'],
  };
};
const clientDocument = (origin) => {
  const u = urls(origin);
  return {
    client_id: u.clientId,
    client_name: 'ChatGPT (sandbox stand-in)',
    redirect_uris: [u.redirect],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'RS256',
    jwks_uri: u.clientJwks,
    scope: SCOPE,
  };
};
const clientJwks = () => ({ keys: [getKeys().client.jwk] });
const asJwks = () => ({ keys: [getKeys().as.jwk] });

// ------------------------------------------------------------------------------------------------------------- registries
const runs = new Map();
const pending = new Map();
const codes = new Map();
const consents = new Map();
const seenJti = new Set();

const leg = (run, id, data) => { if (run) run.trace[id] = { at: new Date().toISOString(), ...data }; };

function startRun(origin, user, tool) {
  if (runs.size >= MAX_RUNS) runs.delete(runs.keys().next().value);
  const verifier = random(48);
  const run = {
    id: random(24), origin, sub: user.sub, tool: tool || 'get_my_benefits', status: 'started', trace: {},
    verifier, challenge: sha256b64u(verifier), code: null, tokenResponse: null, consentId: null,
  };
  runs.set(run.id, run);
  const u = urls(origin);

  const first = gatewayHandle(origin, { authorization: null, body: toolCall(run.tool) });
  leg(run, '1a', { from: 'chatgpt', to: 'gateway', request: { method: 'POST', url: u.resource, body: toolCall(run.tool) } });
  leg(run, '1b', { from: 'gateway', to: 'chatgpt', response: { status: first.status, headers: first.headers, body: first.body } });
  leg(run, '2a', { from: 'chatgpt', to: 'gateway', request: { method: 'GET', url: u.prm } });
  leg(run, '2b', { from: 'gateway', to: 'chatgpt', response: { status: 200, body: protectedResourceMetadata(origin) } });
  leg(run, '3a', { from: 'chatgpt', to: 'idp', request: { method: 'GET', url: u.asMeta } });
  leg(run, '3b', { from: 'idp', to: 'chatgpt', response: { status: 200, body: authorizationServerMetadata(origin) } });

  const authUrl = new URL(u.authorize);
  Object.entries({
    response_type: 'code', client_id: u.clientId, redirect_uri: u.redirect, scope: SCOPE, resource: u.resource,
    code_challenge: run.challenge, code_challenge_method: 'S256', state: run.id,
  }).forEach(([k, v]) => authUrl.searchParams.set(k, v));
  leg(run, '4a', { from: 'chatgpt', to: 'user', note: 'ChatGPT asks the member to sign in; the browser, not ChatGPT, sends the authorization request.' });
  return { run, authUrl: authUrl.toString() };
}

// --------------------------------------------------------------------------------------------- authorization server
function lookupClient(origin, clientId, run) {
  const u = urls(origin);
  // The AS fetches the client's metadata document by URL. Here that document is published by this same process, so the
  // fetch is a direct read of the same JSON the URL serves; the acceptance rules below are applied to it as to any CIMD.
  leg(run, '5a', { from: 'idp', to: 'openai', request: { method: 'GET', url: clientId }, note: 'In-process read of the document this server publishes at that URL.' });
  if (clientId !== u.clientId) {
    leg(run, '5b', { from: 'openai', to: 'idp', response: { status: 404, body: { error: 'unknown client document' } } });
    return { error: 'invalid_client', description: 'Only the sandbox ChatGPT client document is accepted by this client acceptance policy.' };
  }
  const doc = clientDocument(origin);
  leg(run, '5b', { from: 'openai', to: 'idp', response: { status: 200, body: doc } });
  return { doc };
}

function authorizeRequest(origin, query, user) {
  const run = runs.get(String(query.state || ''));
  const u = urls(origin);
  leg(run, '4b', { from: 'user', to: 'idp', request: { method: 'GET', url: u.authorize, query: { ...query, state: '(run id)' } } });
  const fail = (error, description) => ({ error, description });
  if (!run) return fail('invalid_request', 'Unknown or expired connector run. Start again from the page.');
  if (run.sub !== user.sub) return fail('access_denied', 'This run belongs to a different signed-in member.');
  if (query.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be code');
  if (query.code_challenge_method !== 'S256' || !query.code_challenge) return fail('invalid_request', 'PKCE S256 is required');
  if (query.resource !== u.resource) return fail('invalid_target', 'resource must be the protected MCP resource');
  if (String(query.scope || '').split(' ').some((s) => s !== SCOPE)) return fail('invalid_scope', `only ${SCOPE} is available`);
  const client = lookupClient(origin, query.client_id, run);
  if (client.error) return fail(client.error, client.description);
  if (!client.doc.redirect_uris.includes(query.redirect_uri)) return fail('invalid_request', 'redirect_uri is not listed in the client document');
  const rid = random(18);
  pending.set(rid, { runId: run.id, sub: user.sub, clientId: query.client_id, clientName: client.doc.client_name, redirectUri: query.redirect_uri, scope: query.scope, resource: query.resource, challenge: query.code_challenge, state: query.state, at: Date.now() });
  leg(run, '6a', { from: 'idp', to: 'user', note: 'Member is already signed in (demo session); consent prompt shown for this client and resource.', consentRequestId: rid });
  return { rid };
}

function consentView(rid, user) {
  const p = pending.get(rid);
  if (!p || p.sub !== user.sub || Date.now() - p.at > 10 * 60 * 1000) return null;
  return { clientName: p.clientName, clientId: p.clientId, scope: p.scope, resource: p.resource, allow: `/members/${p.sub}/benefits (read)`, downstream: 'Benefits API', purpose: 'current coverage' };
}

function decideConsent(rid, user, approve) {
  const p = pending.get(rid);
  if (!p || p.sub !== user.sub) return { error: 'invalid_request' };
  pending.delete(rid);
  const run = runs.get(p.runId);
  const redirect = new URL(p.redirectUri);
  redirect.searchParams.set('state', p.state);
  redirect.searchParams.set('iss', urls(run.origin).issuer);
  leg(run, '6b', { from: 'user', to: 'idp', request: { decision: approve ? 'approve' : 'deny', scope: p.scope } });
  if (!approve) {
    redirect.searchParams.set('error', 'access_denied');
    leg(run, '6c', { from: 'idp', to: 'user', response: { status: 302, location: redirect.toString() } });
    return { redirect: redirect.toString() };
  }
  const consent = { consentId: `cns_${random(9)}`, version: 1, status: 'active', member: p.sub, client: p.clientId, scope: p.scope, resource: p.resource, downstream: 'Benefits API', purpose: 'current coverage', decidedAt: new Date().toISOString() };
  consents.set(consent.consentId, consent);
  run.consentId = consent.consentId;
  const code = random(24);
  codes.set(code, { ...p, consentId: consent.consentId, exp: Date.now() + CODE_TTL_MS, used: false });
  redirect.searchParams.set('code', code);
  leg(run, '6c', { from: 'idp', to: 'user', response: { status: 302, location: redirect.toString().replace(code, '(one-time code)') }, consent });
  return { redirect: redirect.toString() };
}

function receiveCallback(query) {
  const run = runs.get(String(query.state || ''));
  if (!run) return null;
  if (query.error) { run.status = 'denied'; leg(run, '6d', { from: 'user', to: 'chatgpt', request: { method: 'GET', query: { error: query.error } } }); return run; }
  run.code = query.code;
  run.status = 'code_received';
  leg(run, '6d', { from: 'user', to: 'chatgpt', request: { method: 'GET', url: urls(run.origin).redirect, query: { code: '(one-time code)', state: '(run id)', iss: query.iss } } });
  return run;
}

function asToken(origin, form, run) {
  const u = urls(origin);
  const fail = (error, description, status = 400) => ({ status, body: { error, error_description: description } });
  if (form.grant_type !== 'authorization_code') return fail('unsupported_grant_type', 'authorization_code only');
  const entry = codes.get(form.code);
  if (!entry || entry.used || entry.exp < Date.now()) return fail('invalid_grant', 'The code is unknown, used or expired');
  entry.used = true;
  if (form.redirect_uri !== entry.redirectUri || form.client_id !== entry.clientId) return fail('invalid_grant', 'Code was issued to a different client or redirect_uri');
  if (sha256b64u(String(form.code_verifier || '')) !== entry.challenge) return fail('invalid_grant', 'PKCE verifier does not match the S256 challenge');
  if (form.client_assertion_type !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') return fail('invalid_client', 'client_assertion required (private_key_jwt)', 401);

  // Step 8: verify the client's assertion with the public keys published at the client document's jwks_uri.
  const doc = clientDocument(origin);
  leg(run, '8a', { from: 'idp', to: 'openai', request: { method: 'GET', url: doc.jwks_uri }, note: 'In-process read of the JWKS this server publishes at that URL.' });
  const jwks = clientJwks();
  leg(run, '8b', { from: 'openai', to: 'idp', response: { status: 200, body: jwks } });
  const assertion = decodeJwt(form.client_assertion);
  const jwk = jwks.keys.find((k) => k.kid === assertion?.header?.kid);
  const claims = assertion?.payload || {};
  const problems = [];
  if (!jwk || !verifyJwt(form.client_assertion, jwk)) problems.push('signature does not verify against the client JWKS');
  if (claims.iss !== entry.clientId || claims.sub !== entry.clientId) problems.push('iss and sub must equal the client_id');
  if (![u.token, u.issuer].includes(claims.aud)) problems.push('aud must be the token endpoint or issuer');
  if (!claims.exp || claims.exp < now()) problems.push('assertion expired');
  if (!claims.jti || seenJti.has(claims.jti)) problems.push('jti missing or replayed');
  if (problems.length) return fail('invalid_client', problems.join('; '), 401);
  seenJti.add(claims.jti);

  const consent = consents.get(entry.consentId);
  const iat = now();
  const accessToken = signJwt(getKeys().as, {
    iss: u.issuer, sub: entry.sub, aud: u.resource, scope: entry.scope, client_id: entry.clientId,
    jti: random(12), iat, exp: iat + TOKEN_TTL_S, consent_id: consent.consentId,
  }, 'at+jwt');
  return { status: 200, body: { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_TTL_S, scope: entry.scope } };
}

function exchangeToken(runId) {
  const run = runs.get(runId);
  if (!run || run.status !== 'code_received') return { error: 'The run has no authorization code yet.' };
  const u = urls(run.origin);
  const iat = now();
  const assertion = signJwt(getKeys().client, { iss: u.clientId, sub: u.clientId, aud: u.token, jti: random(12), iat, exp: iat + 60 });
  const form = {
    grant_type: 'authorization_code', code: run.code, redirect_uri: u.redirect, client_id: u.clientId,
    code_verifier: run.verifier, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion,
  };
  leg(run, '7a', { from: 'chatgpt', to: 'idp', request: { method: 'POST', url: u.token, body: { ...form, code: '(one-time code)', client_assertion: assertion, code_verifier: '(PKCE verifier)' } }, clientAssertion: { jwt: assertion, ...decodeJwt(assertion) } });
  const result = asToken(run.origin, form, run);
  leg(run, '8c', { from: 'idp', to: 'chatgpt', response: { status: result.status, body: result.body } });
  if (result.status !== 200) { run.status = 'token_failed'; return { error: result.body.error_description, status: result.status }; }
  run.tokenResponse = result.body;
  run.status = 'token_issued';
  return { token: result.body, decoded: decodeJwt(result.body.access_token) };
}

// ------------------------------------------------------------------------------------------------------------- gateway
const TOOLS = {
  get_my_benefits: { scope: SCOPE, action: 'benefits.read', target: (sub) => sub },
  // Same scope, someone else's records: the token alone would allow it, the policy decision must not.
  get_other_member_benefits: { scope: SCOPE, action: 'benefits.read', target: () => 'member-other-0001' },
};
const toolCall = (name) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });

function benefitsFor(memberId) {
  return { member: memberId, plan: 'Example PPO', coverage: 'active', deductible: { individual: 1500, met: 420 }, note: 'Sample data for the demo' };
}

// The policy decision point. Inputs and rules mirror the diagram; the engine is simulated (see file header).
function decide({ member, client, tool, action, resource, consent }) {
  const input = { member, client, tool, action, resource, context: { consent_id: consent?.consentId || null, scope: consent?.scope || null, risk: 'low' } };
  const rules = [
    { id: 'member-owns-target', ok: resource === `member/${member}/benefits`, text: 'The member owns the target resource' },
    { id: 'consent-active', ok: Boolean(consent && consent.status === 'active' && consent.member === member && consent.client === client && String(consent.scope).split(' ').includes(SCOPE)), text: 'Recorded consent is active for this client and scope' },
    { id: 'no-expanded-access', ok: action === 'benefits.read' && (!consent || consent.downstream === 'Benefits API'), text: 'The action stays inside what was consented to' },
  ];
  return { engine: 'simulated PingOne Authorize policy', decisionId: `dec_${random(6)}`, input, rules, decision: rules.every((r) => r.ok) ? 'PERMIT' : 'DENY' };
}

function gatewayHandle(origin, { authorization, body, run = null }) {
  const u = urls(origin);
  const name = body?.params?.name;
  const tool = TOOLS[name];
  const unauthorized = (reason) => ({
    status: 401,
    headers: { 'WWW-Authenticate': `Bearer resource_metadata="${u.prm}", scope="${SCOPE}"` },
    body: { error: 'invalid_token', error_description: reason },
  });
  if (!authorization || !/^Bearer /i.test(authorization)) return unauthorized('An access token is required');
  const token = authorization.replace(/^Bearer /i, '');
  const decoded = decodeJwt(token);
  const claims = decoded?.payload || {};
  const consent = consents.get(claims.consent_id) || null;
  const validation = {
    signature: Boolean(decoded) && verifyJwt(token, getKeys().as.jwk),
    issuer: claims.iss === u.issuer,
    audience: claims.aud === u.resource,
    expiry: Boolean(claims.exp) && claims.exp > now(),
    scope: String(claims.scope || '').split(' ').includes(tool?.scope || SCOPE),
    member: Boolean(claims.sub),
    consent: Boolean(consent && consent.status === 'active'),
  };
  const failed = Object.entries(validation).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length) return { ...unauthorized(`Token rejected: ${failed.join(', ')}`), evidence: { validation, claims } };
  if (!tool) return { status: 404, body: { error: 'unknown_tool', error_description: `No tool named ${name}` }, evidence: { validation, claims } };

  const resource = `member/${tool.target(claims.sub)}/benefits`;
  const pdp = decide({ member: claims.sub, client: claims.client_id, tool: name, action: tool.action, resource, consent });
  if (pdp.decision !== 'PERMIT') return { status: 403, body: { error: 'access_denied', error_description: 'Policy decision: DENY. The downstream API was not called.' }, evidence: { validation, claims, pdp } };

  const downstream = { request: { method: 'GET', url: `https://benefits.example.test/v1/${resource}` }, response: { status: 200, body: benefitsFor(claims.sub) } };
  const text = `Your ${downstream.response.body.plan} coverage is ${downstream.response.body.coverage}. Deductible: $${downstream.response.body.deductible.met} of $${downstream.response.body.deductible.individual} met.`;
  return { status: 200, body: { result: { content: [{ type: 'text', text }], structuredContent: downstream.response.body } }, evidence: { validation, claims, pdp, downstream, explain: text } };
}

function callTool(runId, toolName) {
  const run = runs.get(runId);
  if (!run || !run.tokenResponse) return { error: 'The run has no access token yet.' };
  const u = urls(run.origin);
  const body = toolCall(toolName || run.tool);
  const authorization = `Bearer ${run.tokenResponse.access_token}`;
  leg(run, '9a', { from: 'chatgpt', to: 'gateway', request: { method: 'POST', url: u.resource, headers: { Authorization: 'Bearer (access token)' }, body } });
  const out = gatewayHandle(run.origin, { authorization, body });
  const ev = out.evidence || {};
  // Not a diagram leg: what the gateway checked on the token before it let the call near the policy decision.
  if (ev.validation) leg(run, '9v', { from: 'gateway', to: 'gateway', validation: ev.validation, claims: ev.claims });
  if (ev.pdp) {
    leg(run, '10a', { from: 'gateway', to: 'p1az', request: ev.pdp.input, rules: ev.pdp.rules, engine: ev.pdp.engine });
    leg(run, '10b', { from: 'p1az', to: 'gateway', response: { decision: ev.pdp.decision, decisionId: ev.pdp.decisionId } });
  }
  if (ev.downstream) {
    leg(run, '11a', { from: 'gateway', to: 'api', request: ev.downstream.request });
    leg(run, '11b', { from: 'api', to: 'gateway', response: ev.downstream.response });
  }
  leg(run, '12a', { from: 'gateway', to: 'chatgpt', response: { status: out.status, body: out.body } });
  if (ev.explain) leg(run, '12b', { from: 'chatgpt', to: 'user', note: 'ChatGPT explains the result (templated sentence here, no model call).', text: ev.explain });
  run.status = out.status === 200 ? 'complete' : 'refused';
  return { status: out.status, body: out.body, evidence: ev, validation: ev.validation || null };
}

function publicRun(runId) {
  const run = runs.get(runId);
  if (!run) return null;
  const consent = run.consentId ? consents.get(run.consentId) : null;
  const token = run.tokenResponse ? { ...run.tokenResponse, decoded: decodeJwt(run.tokenResponse.access_token) } : null;
  return { id: run.id, status: run.status, tool: run.tool, trace: run.trace, consent, token, tools: Object.keys(TOOLS) };
}

const runOwnedBy = (runId, sub) => runs.get(runId)?.sub === sub;

module.exports = {
  BASE_PATH, SCOPE, TOOLS,
  urls, protectedResourceMetadata, authorizationServerMetadata, clientDocument, clientJwks, asJwks,
  startRun, authorizeRequest, consentView, decideConsent, receiveCallback, exchangeToken, callTool, publicRun, runOwnedBy,
  gatewayHandle, decodeJwt,
  __reset() { runs.clear(); pending.clear(); codes.clear(); consents.clear(); seenJti.clear(); keys = null; },
};
