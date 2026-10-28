'use strict';
/**
 * museLive.js — the real "Muse" personal-agent flow (port of the standalone Muse app's liveauth + discovery).
 *
 * Muse calls the gateway with no token (401), reads the metadata the 401 points at, sends the browser to PingOne
 * (auth code + PKCE S256), swaps the code for a token, gets its own agent token, does two RFC 8693 exchanges
 * (act = Muse) and retries the gateway call. Tokens stay in this process; callers only ever see claims and steps.
 *
 * Every outbound request goes through one gate: allowed origin, no redirects, a timeout, a size cap.
 * The fetch implementation is injectable so tests never open a socket.
 */
const { createHash, randomBytes } = require('node:crypto');
const configStore = require('./configStore');

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 6000;
const DEFAULT_REDIRECT_URI = 'https://local.ping-devops.com:4000/api/muse/callback';
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'muse', version: '0.1.0' } } };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const TE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const AT = 'urn:ietf:params:oauth:token-type:access_token';
const SHOWN_AS_SENT = ['code_verifier', 'code', 'client_secret', 'subject_token', 'actor_token'];

const b64u = (buf) => buf.toString('base64url');

const learnedFrom = (as) => ({
  authorizationServer: as.issuer ?? null,
  authorizeEndpoint: as.authorization_endpoint ?? null,
  tokenEndpoint: as.token_endpoint ?? null,
  pkce: (as.code_challenge_methods_supported ?? []).includes('S256'),
  scopes: as.scopes_supported ?? [],
});

/**
 * Resolve Muse's configuration. Returns { configured: false } when the client secret is absent so the page can
 * show "Muse is not configured"; never throws and never includes the secret in anything but `idp.clientSecret`.
 */
function museConfig(lane = 'gateway', env = process.env) {
  const envId = configStore.getEffective('pingone_environment_id');
  const region = /^[a-z]{2,4}$/.test(configStore.getEffective('pingone_region') ?? '') ? configStore.getEffective('pingone_region') : 'com';
  const clientId = configStore.getEffective('pingone_muse_client_id');
  const clientSecret = configStore.getEffective('pingone_muse_client_secret');
  const gwHost = (configStore.getEffective('mcp_pinggateway_url') || 'https://api.ping.demo:3036').replace(/\/mcp\/?$/, '').replace(/\/$/, '');
  const gatewayBase = env.MUSE_GATEWAY_URL || `${gwHost}/mcp`;
  const privilegeUrl = env.MUSE_PRIVILEGE_URL || null;
  const configured = Boolean(envId && clientId && clientSecret);
  const useLane = lane === 'privilege' ? 'privilege' : 'gateway';
  const url = useLane === 'privilege' ? privilegeUrl : gatewayBase;
  // The token audience is the gateway's PingOne resource, which is not always the address Muse calls (on SE the gateway is called
  // inside the cluster while PingOne knows it as https://api.ping.demo:3036/mcp). Same value as the call address when nothing is set.
  const audience = useLane === 'privilege' ? null : (env.MUSE_GATEWAY_AUDIENCE || configStore.getEffective('pingone_resource_pinggateway_uri') || url);
  const base = `https://auth.pingone.${region}`;
  const allow = new Set([base]);
  for (const o of [url, gatewayBase, privilegeUrl, ...(env.MUSE_ALLOW_ORIGINS ?? '').split(',').map((x) => x.trim())]) {
    try {
      if (!o) continue;
      const ou = new URL(o);
      if (ou.protocol === 'https:') allow.add(ou.origin);
      // One exception to https-only: the gateway address the owner set in MUSE_GATEWAY_URL, when it is a cluster-local service name (no dots).
      else if (ou.protocol === 'http:' && env.MUSE_GATEWAY_URL && o === env.MUSE_GATEWAY_URL && !ou.hostname.includes('.')) allow.add(ou.origin);
    } catch { /* ignore */ }
  }
  return {
    configured,
    lane: useLane,
    laneAvailable: Boolean(url),
    url,
    audience,
    origin: url ? new URL(url).origin : null,
    allow,
    // A second PingOne app for "just a user": Sam signs in as himself, no agent, no consent, nothing exchanged. Public client with PKCE.
    userClientId: /^[0-9a-f-]{36}$/i.test(env.MUSE_USER_CLIENT_ID ?? '') ? env.MUSE_USER_CLIENT_ID : null,
    redirectUri: env.MUSE_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    idp: {
      clientId, clientSecret, loginHint: env.MUSE_LOGIN_HINT || 'demouser',
      actorScope: 'agent:invoke',
      gatewayScope: useLane === 'privilege' ? 'mcp:invoke' : 'gateway:mcp:invoke',
      authorizeEndpoint: `${base}/${envId}/as/authorize`,
      tokenEndpoint: `${base}/${envId}/as/token`,
    },
  };
}

async function readCapped(res) {
  const text = await res.text();
  const body = text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
  try { return JSON.parse(body); } catch { return body.slice(0, 500); }
}

async function send(cfg, fetchImpl, { n, title, method, url, headers = {}, body, form, note }) {
  const u = new URL(url);
  if (!cfg.allow.has(u.origin)) return { step: { n, title, request: { method, url: u.href }, skipped: true, note: `Not contacted: ${u.origin} is not an allowed origin.` } };
  const res = await fetchImpl(u.href, {
    method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json, text/event-stream', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
  });
  const parsed = await readCapped(res);
  // The step shown to the page never carries a bearer token or a client secret.
  const shownReq = { method, url: u.href, ...(body ? { body } : {}), ...(form ? { form: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, SHOWN_AS_SENT.includes(k) ? '(sent)' : v])) } : {}) };
  const shownRes = parsed && typeof parsed === 'object' && parsed.access_token
    ? { ...parsed, access_token: '(held by Muse server)', refresh_token: parsed.refresh_token ? '(held by Muse server)' : undefined, id_token: parsed.id_token ? '(held by Muse server)' : undefined }
    : parsed;
  const hdrs = Object.fromEntries(['www-authenticate', 'content-type', 'mcp-session-id'].filter((h) => res.headers.get(h)).map((h) => [h, res.headers.get(h)]));
  return { res, parsed, step: { n, title, request: shownReq, response: { status: res.status, headers: hdrs, body: shownRes }, note } };
}

/** Steps 1 to 3: the 401, then the resource metadata (RFC 9728), then the authorization-server metadata (RFC 8414). */
async function liveDiscovery(cfg, fetchImpl) {
  const steps = [];
  const gw = cfg.lane === 'gateway' ? 'Agent Gateway' : 'Agent Privilege';
  async function call(n, title, method, url, body, note) {
    let target = new URL(url);
    let observed;
    // Some gateways advertise an http:// metadata URL on a host that serves https. Same host only: upgrade, and say so.
    if (target.protocol === 'http:' && target.hostname === new URL(cfg.origin).hostname && new URL(cfg.origin).protocol === 'https:') {
      observed = `The gateway advertised ${url} (http). Muse used https on the same host.`;
      target = new URL(url.replace(/^http:/, 'https:'));
    }
    if (!cfg.allow.has(target.origin)) {
      steps.push({ n, title, request: { method, url: target.href }, skipped: true, note: `Not contacted: ${target.origin} is not an allowed origin.` });
      return null;
    }
    const res = await fetchImpl(target.href, {
      method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: body ? { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await readCapped(res);
    const hdr = Object.fromEntries(['www-authenticate', 'content-type'].filter((h) => res.headers.get(h)).map((h) => [h, res.headers.get(h)]));
    steps.push({ n, title, request: { method, url: target.href, ...(body ? { body } : {}) }, response: { status: res.status, headers: hdr, body: parsed }, note: [note, observed].filter(Boolean).join(' ') });
    return { res, parsed };
  }
  const stop = (reason) => ({ steps, learned: null, stopped: reason });

  const first = await call(1, `Call ${gw} with no token`, 'POST', cfg.url, INIT, 'The 401 is the question. Its WWW-Authenticate header says where to learn how to sign in.');
  if (!first) return stop('The gateway origin is not allowed.');
  if (first.res.status !== 401) return stop(`Expected a 401 with no token, got ${first.res.status}.`);
  const m = /resource_metadata="([^"]+)"/.exec(first.res.headers.get('www-authenticate') ?? '');
  if (!m) return stop('The 401 has no resource_metadata in WWW-Authenticate, so Muse cannot discover how to sign in.');

  // The gateway may advertise its metadata under its PingOne name (https://api.ping.demo:3036/...), which Muse cannot reach from here.
  // Only when that is the audience's own origin, read the same path from the address Muse calls, and say so.
  let prmUrl = m[1], prmNote = '';
  try {
    const adv = new URL(m[1]);
    if (!cfg.allow.has(adv.origin) && cfg.audience && adv.origin === new URL(cfg.audience).origin) {
      prmUrl = `${new URL(cfg.url).origin}${adv.pathname}${adv.search}`;
      prmNote = `The gateway advertised ${m[1]} (its PingOne name). Muse read the same path from ${new URL(cfg.url).origin}, the address it calls.`;
    }
  } catch { /* leave as advertised */ }
  const prm = await call(2, 'Read the resource metadata', 'GET', prmUrl, null, ['This names the authorization server Muse must use, and the audience the token must carry.', prmNote].filter(Boolean).join(' '));
  if (!prm) return stop('The resource metadata origin is not allowed.');
  const issuer = prm.parsed?.authorization_servers?.[0];
  if (prm.res.status !== 200 || typeof issuer !== 'string') return stop('The resource metadata did not name an authorization server.');

  const ai = new URL(issuer);
  const asUrl = `${ai.origin}/.well-known/oauth-authorization-server${ai.pathname === '/' ? '' : ai.pathname}`;
  const asr = await call(3, 'Read the authorization-server metadata', 'GET', asUrl, null, 'Endpoints, PKCE, and how Muse identifies itself.');
  if (!asr) return stop(`The authorization server (${ai.origin}) is on another origin and was not contacted.`);
  if (asr.res.status !== 200 || typeof asr.parsed !== 'object') return stop('The authorization-server metadata could not be read.');
  return { steps, learned: learnedFrom(asr.parsed), stopped: null };
}

/** Step 5: build the PingOne authorize URL. The `.nomfa` suffix on login_hint is what the DaVinci flow reads to skip MFA. */
function startSignIn(cfg, { mfa = true } = {}) {
  const verifier = b64u(randomBytes(32));
  const state = b64u(randomBytes(16));
  const u = new URL(cfg.idp.authorizeEndpoint);
  const privilege = cfg.lane === 'privilege';
  // Gateway lane: the user token is minted for the gateway up front (resource + gateway scope). Privilege lane: openid only.
  const resource = privilege ? null : (cfg.audience || cfg.url);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: cfg.idp.clientId, redirect_uri: cfg.redirectUri, state,
    ...(resource ? { resource } : {}), prompt: 'login',
    login_hint: mfa ? cfg.idp.loginHint : `${cfg.idp.loginHint}.nomfa`,
    code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    scope: privilege ? 'openid' : `openid ${cfg.idp.gatewayScope}`,
  }).toString();
  return { url: u.href, state, verifier, resource };
}

/** Just a user: the authorize URL for the user-only app. No resource, openid only, and the login hint carries no agent marker. */
function startUserSignIn(cfg, { mfa = true } = {}) {
  const verifier = b64u(randomBytes(32));
  const state = b64u(randomBytes(16));
  const u = new URL(cfg.idp.authorizeEndpoint);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: cfg.userClientId, redirect_uri: cfg.redirectUri, state, prompt: 'login',
    login_hint: mfa ? cfg.idp.loginHint : `${cfg.idp.loginHint}.nomfa`,
    code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', scope: 'openid',
  }).toString();
  return { url: u.href, state, verifier };
}

function claimsOf(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return { iss: c.iss, aud: c.aud, sub: c.sub, scope: c.scope ?? c.scp, exp: c.exp, ...(c.act ? { act: c.act } : {}) };
  } catch { return null; }
}

/** Step 6: swap the code for the user token (client_secret_post). */
async function exchangeCode(cfg, fetchImpl, { code, verifier, resource }) {
  const r = await send(cfg, fetchImpl, {
    n: 6, title: 'Swap the code for a token', method: 'POST', url: cfg.idp.tokenEndpoint,
    form: { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, client_id: cfg.idp.clientId, client_secret: cfg.idp.clientSecret, code_verifier: verifier, ...(resource ? { resource } : {}) },
    note: 'The token is held by the Muse server. This page only shows its claims.',
  });
  if (r.step.skipped) return { step: r.step, error: 'The token endpoint is on an origin that is not allowed.' };
  const token = r.parsed?.access_token;
  if (r.res.status !== 200 || typeof token !== 'string') return { step: r.step, error: `The token request was refused (${r.res.status}).` };
  return { step: r.step, token, claims: claimsOf(token) };
}

/** Just a user: swap the code for Sam's own token. A public client, so no secret. */
async function exchangeUserCode(cfg, fetchImpl, { code, verifier }) {
  const r = await send(cfg, fetchImpl, {
    n: 6, title: "Swap the code for Sam's own token", method: 'POST', url: cfg.idp.tokenEndpoint,
    form: { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, client_id: cfg.userClientId, code_verifier: verifier },
    note: 'Public client with PKCE. No agent token and no exchange: this is the user acting as himself.',
  });
  if (r.step.skipped) return { step: r.step, error: 'The token endpoint is on an origin that is not allowed.' };
  const token = r.parsed?.access_token;
  if (r.res.status !== 200 || typeof token !== 'string') return { step: r.step, error: `The token request was refused (${r.res.status}).` };
  return { step: r.step, token, claims: claimsOf(token) };
}

/** Steps 6.1 to 6.3: act on the user's behalf (RFC 8693). Own agent token, then two exchanges; act carries on to the gateway audience. */
async function delegate(cfg, fetchImpl, userToken) {
  const { idp } = cfg;
  const base = { client_id: idp.clientId, client_secret: idp.clientSecret };
  const steps = [];
  const post = async (n, title, form, note) => {
    const r = await send(cfg, fetchImpl, { n, title, method: 'POST', url: idp.tokenEndpoint, form: { ...base, ...form }, note });
    const token = r.parsed?.access_token;
    steps.push({ ...r.step, ...(r.step.response && token ? { note: `${note} ${JSON.stringify(claimsOf(token) ?? {})}` } : {}) });
    return r.res?.status === 200 && typeof token === 'string' ? token : null;
  };
  const actor = await post(6.1, 'Muse gets its own agent token', { grant_type: 'client_credentials', scope: idp.actorScope }, 'Who is acting: Muse itself.');
  if (!actor) return { steps, error: 'PingOne would not issue Muse an agent token.' };
  const first = await post(6.2, 'Exchange 1: the user, with Muse acting', { grant_type: TE, subject_token: userToken, subject_token_type: AT, actor_token: actor, actor_token_type: AT, scope: idp.actorScope }, 'Same user, plus act = Muse (RFC 8693 delegation).');
  if (!first) return { steps, error: 'The first token exchange was refused.' };
  const second = await post(6.3, 'Exchange 2: for the gateway', { grant_type: TE, subject_token: first, subject_token_type: AT, scope: idp.gatewayScope }, 'Audience becomes the gateway; act carries over.');
  if (!second) return { steps, error: 'The second token exchange was refused.' };
  return { steps, token: second, claims: claimsOf(second) };
}

/** Steps 7 to 9: the call refused in step 1, now with the delegated token. */
async function callGateway(cfg, fetchImpl, token, { tool = 'loyalty_balance' } = {}) {
  const gw = cfg.lane === 'gateway' ? 'Agent Gateway' : 'Agent Privilege';
  // PingGateway's default validation path introspects with a different client and rejects this token; jwks is the one that works.
  const auth = { authorization: `Bearer ${token}`, 'x-token-validation': 'jwks', 'mcp-protocol-version': '2025-06-18' };
  const init = await send(cfg, fetchImpl, { n: 7, title: `Call ${gw} with the token`, method: 'POST', url: cfg.url, headers: auth, body: INIT, note: 'Same call as step 1, now with the bearer token.' });
  if (init.step.skipped) return [init.step];
  const steps = [init.step];
  if (init.res.status !== 200) return steps;
  const sid = init.res.headers.get('mcp-session-id');
  const sess = { ...auth, ...(sid ? { 'mcp-session-id': sid } : {}) };
  const list = await send(cfg, fetchImpl, { n: 8, title: `List the tools ${gw} lets Muse see`, method: 'POST', url: cfg.url, headers: sess, body: LIST, note: `Tool-level authorization: ${gw} decides which tools this token may see.` });
  steps.push(list.step);
  if (tool && list.res?.status === 200) {
    const call = await send(cfg, fetchImpl, { n: 9, title: `Call ${tool}`, method: 'POST', url: cfg.url, headers: sess, body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: {} } }, note: 'The gateway checks the token, PingOne Authorize decides, then the tool runs.' });
    steps.push(call.step);
  }
  return steps;
}

/** The tool result is MCP text content holding JSON; Muse reads the points out of it. */
function answerFrom(steps) {
  const r = steps.find((x) => x.n === 9)?.response;
  try { const d = JSON.parse(r.body.result.content[0].text).data; return { points: d.points, tier: d.tier }; } catch { return null; }
}

module.exports = { museConfig, liveDiscovery, startSignIn, startUserSignIn, exchangeUserCode, exchangeCode, delegate, callGateway, answerFrom, claimsOf, DEFAULT_REDIRECT_URI };
