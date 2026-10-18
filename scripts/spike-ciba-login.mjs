#!/usr/bin/env node
// SPIKE: can a CIBA approval become a login session? See docs/superpowers/specs/2026-10-17-ciba-login-spike-result.md
//
//   ENV_FILE=<path> node scripts/spike-ciba-login.mjs                      read-only: login app grants/scopes + CIBA app config
//   ENV_FILE=<path> node scripts/spike-ciba-login.mjs --apply              + create throwaway 'SPIKE-delete-me-*' app (CIBA+REFRESH_TOKEN,
//                                                                            CLIENT_SECRET_POST, login app's resource grants, flow policy)
//   ... --send --app <id> [--auth post|basic] [--policy email|sms] [--user <id>]
//                                                                          send ONE CIBA request, print match code, poll up to 100 s, inspect tokens
//   ... --exchange --app <id> ...                                          after --send success: RFC 8693 exchange (R2) with the token-exchanger client
// Never modifies the real login apps or existing CIBA apps. Never prints secrets/tokens (claims only, ids masked).
import fs from 'node:fs';

const f = process.env.ENV_FILE || new URL('../demo_api_server/.env', import.meta.url).pathname;
const env = Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : d);
const E = env.PINGONE_ENVIRONMENT_ID;
const API = `https://api.pingone.com/v1/environments/${E}`;
const AUTH = `https://auth.pingone.com/${E}/as`;
const LOGIN_APPS = { user: '83572007-b2c7-4862-8197-dc225a9fb8e1', admin: '8a711944-e625-42ce-af14-4d5a0825155a' };
const POLICIES = { email: '99972880d9170ab70d72e269cc944186', sms: '87929b3e4c6857e5ff854502dbde1742' };
const DEMO_USER = '1aee74ae-3d09-4bcf-a69f-7e1bc225b761';
const mask = (s) => (s ? String(s).slice(0, 8) + '…' : s);
const form = (o) => new URLSearchParams(o).toString();
const basic = (id, s) => 'Basic ' + Buffer.from(`${id}:${s}`).toString('base64');

async function worker() {
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(env.PINGONE_WORKER_CLIENT_ID, env.PINGONE_WORKER_CLIENT_SECRET) }, body: 'grant_type=client_credentials' });
  return { authorization: 'Bearer ' + (await r.json()).access_token, 'content-type': 'application/json' };
}
async function call(H, method, p, body) {
  const r = await fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const show = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, /^(sub|sid|jti|iss|at_hash|client_id|aud|env|org|p1\.\w+)$/.test(k) ? (Array.isArray(v) ? v.map(mask) : mask(v)) : v]));

const H = await worker();
const out = (t, x) => console.log(`\n## ${t}\n` + (typeof x === 'string' ? x : JSON.stringify(x, null, 1)));

if (!flag('send') && !flag('exchange')) {
  // read-only: what do the login apps carry that a CIBA login app would need?
  for (const [k, id] of Object.entries(LOGIN_APPS)) {
    const a = (await call(H, 'GET', `/applications/${id}`)).j;
    const grants = (await call(H, 'GET', `/applications/${id}/grants`)).j._embedded?.grants || [];
    const res = [];
    for (const g of grants) {
      const r = (await call(H, 'GET', `/resources/${g.resource.id}`)).j;
      const sc = (await call(H, 'GET', `/resources/${g.resource.id}/scopes`)).j._embedded.scopes;
      const set = new Set(g.scopes.map((s) => s.id));
      res.push({ resource: r.name, audience: r.audience, scopes: sc.filter((s) => set.has(s.id)).map((s) => s.name) });
    }
    out(`${k} login app`, { name: a.name, grantTypes: a.grantTypes, auth: a.tokenEndpointAuthMethod, pkce: a.pkceEnforcement, resources: res });
  }
  const c = (await call(H, 'GET', '/applications/7d723ec0-e37c-4f18-a60f-5ce0c8bbdeeb')).j;
  const cg = (await call(H, 'GET', '/applications/7d723ec0-e37c-4f18-a60f-5ce0c8bbdeeb/grants')).j._embedded?.grants || [];
  out('existing CIBA email app', { grantTypes: c.grantTypes, auth: c.tokenEndpointAuthMethod, resourceGrants: cg.length });
}

if (flag('apply')) {
  // throwaway app: CIBA + REFRESH_TOKEN, client-secret-post, the user login app's resource grants, CIBA - EMAIL policy
  const name = 'SPIKE-delete-me-ciba-login-' + Date.now().toString(36);
  const mk = await call(H, 'POST', '/applications', { name, enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['CIBA', 'REFRESH_TOKEN'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' });
  out('create app', { status: mk.status, id: mk.j.id, name, err: mk.status >= 300 ? mk.j : undefined });
  if (mk.status < 300) {
    const id = mk.j.id;
    const grants = (await call(H, 'GET', `/applications/${LOGIN_APPS.user}/grants`)).j._embedded.grants;
    for (const g of grants) {
      const r = await call(H, 'POST', `/applications/${id}/grants`, { resource: { id: g.resource.id }, scopes: g.scopes.map((s) => ({ id: s.id })) });
      out('grant ' + mask(g.resource.id), r.status);
    }
    const fp = await call(H, 'POST', `/applications/${id}/flowPolicyAssignments`, { flowPolicy: { id: POLICIES.email }, priority: 1 });
    out('flow policy assignment', { status: fp.status, err: fp.status >= 300 ? fp.j : undefined });
    const fp2 = await call(H, 'POST', `/applications/${id}/flowPolicyAssignments`, { flowPolicy: { id: POLICIES.sms }, priority: 2 });
    out('flow policy assignment (sms)', { status: fp2.status, err: fp2.status >= 300 ? fp2.j : undefined });
    const sec = await call(H, 'GET', `/applications/${id}/secret`);
    out('secret', sec.status < 300 ? 'readable (not printed)' : { status: sec.status, err: sec.j });
    if (sec.status < 300) console.log(`SPIKE_APP_ID=${id}`);
  }
}

if (flag('send')) {
  const id = opt('app'); const policy = POLICIES[opt('policy', 'email')]; const method = opt('auth', 'post');
  const secret = id && (await call(H, 'GET', `/applications/${id}/secret`)).j.secret;
  if (!id || !secret) { console.error('--app <id> with a readable secret required'); process.exit(1); }
  const scope = opt('scope', 'openid profile email');
  const body = { scope, login_hint: opt('user', DEMO_USER), binding_message: opt('bm', 'SP1234'), acr_values: policy };
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (method === 'basic') headers.authorization = basic(id, secret); else { body.client_id = id; body.client_secret = secret; }
  const r = await fetch(`${AUTH}/cibaAuthorization`, { method: 'POST', headers, body: form(body) });
  const j = await r.json().catch(() => ({}));
  out(`cibaAuthorization (client_secret_${method})`, { status: r.status, expires_in: j.expires_in, interval: j.interval, error: j.error, desc: j.error_description, code: j.code });
  if (!j.auth_req_id) process.exit(0);
  console.log(`APPROVE NOW: match code ${body.binding_message}, expires ${new Date(Date.now() + j.expires_in * 1000).toISOString()}`);
  const end = Date.now() + 100000; let tok;
  while (Date.now() < end) {
    await new Promise((s) => setTimeout(s, (j.interval || 2) * 1000));
    const th = { 'content-type': 'application/x-www-form-urlencoded' };
    const tb = { grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: j.auth_req_id };
    if (method === 'basic') th.authorization = basic(id, secret); else { tb.client_id = id; tb.client_secret = secret; }
    const tr = await fetch(`${AUTH}/token`, { method: 'POST', headers: th, body: form(tb) });
    const tj = await tr.json().catch(() => ({}));
    if (tr.status === 200) { tok = tj; break; }
    if (tj.error !== 'authorization_pending' && tj.error !== 'slow_down') { out('token error', { status: tr.status, error: tj.error, desc: tj.error_description }); break; }
  }
  if (tok) {
    out('token response', { token_type: tok.token_type, expires_in: tok.expires_in, scope: tok.scope, has_refresh_token: !!tok.refresh_token, has_id_token: !!tok.id_token });
    out('access_token claims', show(claims(tok.access_token)));
    if (tok.id_token) out('id_token claims', show(claims(tok.id_token)));
    const ui = await fetch(`${AUTH}/userinfo`, { headers: { authorization: 'Bearer ' + tok.access_token } });
    out('userinfo', { status: ui.status, claims: ui.status === 200 ? show(await ui.json()) : undefined });
    if (tok.refresh_token) {
      const rr = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: id, client_secret: secret }) });
      out('refresh', { status: rr.status });
    }
    if (flag('exchange')) {
      const xc = env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID;
      const xr = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(xc, env.PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET) }, body: form({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: tok.access_token, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: opt('xscope', 'accounts:read') }) });
      const xj = await xr.json().catch(() => ({}));
      out('RFC 8693 exchange', { status: xr.status, error: xj.error, desc: xj.error_description, scope: xj.scope, claims: xj.access_token ? show(claims(xj.access_token)) : undefined });
    }
  } else console.log('no approval within 100 s');
}
