#!/usr/bin/env node
'use strict';
/**
 * An outside company's agent, end to end, with none of our code in its path:
 *   1. sign the user in at ITS IdP (password grant: a test harness, no browser)
 *   2. RFC 8693 token exchange at its IdP for an ID-JAG addressed to OUR authorization server
 *   3. RFC 7523 JWT bearer redemption at OUR public token endpoint
 *   4. optionally, tools/list at our MCP gateway with the token we returned
 * Prints decoded claims and OAuth errors only, never a raw token.
 *
 * Usage (secrets come from env, never args):
 *   OUTSIDE_IDP_CLIENT_SECRET=… OUTSIDE_IDP_USER_PASSWORD=… \
 *   node scripts/id-jag/outside-agent.js --target=oauth-mcp
 *   node scripts/id-jag/outside-agent.js --target=pingfederate   (also needs OUR_AS_CLIENT_SECRET)
 *
 * Options (defaults: the Acme PingFederate in ping-devops-cmuir and our SE servers):
 *   --idp=https://cmuir-pf-acme.ping-devops.com   --idp-client=acme-agent   --user=acme-user
 *   --target=oauth-mcp|pingfederate   --as-issuer=…   --as-token-endpoint=…   --as-client=…
 *   --resource=…   --scope="mcp:invoke accounts:read"   --gateway=https://…/mcp (optional)
 *   --insecure  (skip TLS verification, for self-signed dev hosts only)
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
if (args.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TARGETS = {
  'oauth-mcp': { issuer: 'https://cmuir-mcp.ping-devops.com', tokenEndpoint: 'https://cmuir-mcp.ping-devops.com/token',
    client: 'demo-bff-mcp-client', resource: 'https://cmuir-mcp.ping-devops.com/mcp' },
  pingfederate: { issuer: 'https://cmuir-pf.ping-devops.com', tokenEndpoint: 'https://cmuir-pf.ping-devops.com/as/token.oauth2',
    client: 'ai-demo-pf-idjag-redeemer', resource: 'https://api.ping.demo:3036/mcp' },
};
const target = TARGETS[args.target || 'oauth-mcp'];
if (!target) { console.error(`unknown --target ${args.target}`); process.exit(2); }

const idp = String(args.idp || 'https://cmuir-pf-acme.ping-devops.com').replace(/\/$/, '');
const idpToken = `${idp}/as/token.oauth2`;
const idpClient = args['idp-client'] || 'acme-agent';
const asIssuer = args['as-issuer'] || target.issuer;
const asTokenEndpoint = args['as-token-endpoint'] || target.tokenEndpoint;
const asClient = args['as-client'] || target.client;
const resource = args.resource || target.resource;
const scope = args.scope || 'mcp:invoke accounts:read';

const need = (k) => { if (!process.env[k]) { console.error(`set ${k}`); process.exit(2); } return process.env[k]; };
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
const claims = (jwt) => {
  try {
    const [h, p] = String(jwt).split('.');
    return { header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')) };
  } catch { return '(not a JWT)'; }
};

async function post(url, form, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(form).toString() });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

function step(n, title) { console.log(`\n[${n}] ${title}`); }
function fail(where, r) {
  console.log(`    REFUSED at ${where}: HTTP ${r.status} ${r.body.error || ''} ${r.body.error_description || ''}`);
  process.exit(1);
}

(async () => {
  const idpAuth = { Authorization: basic(idpClient, need('OUTSIDE_IDP_CLIENT_SECRET')) };

  step(1, `Sign in at the outside IdP (${idp}) as ${args.user || 'acme-user'}`);
  const login = await post(idpToken, { grant_type: 'password', username: args.user || 'acme-user',
    password: need('OUTSIDE_IDP_USER_PASSWORD'), scope: 'openid offline_access' }, idpAuth);
  if (login.status !== 200 || !login.body.refresh_token) fail('IdP sign-in', login);
  console.log('    got a refresh token from the outside IdP (kept in memory)');

  step(2, `Exchange it for an ID-JAG addressed to ${asIssuer}`);
  const ex = await post(idpToken, {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    subject_token: login.body.refresh_token,
    subject_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
    audience: asIssuer, resource, scope,
  }, idpAuth);
  if (ex.status !== 200 || !ex.body.access_token) fail('ID-JAG exchange', ex);
  console.log(`    issued_token_type=${ex.body.issued_token_type} token_type=${ex.body.token_type} expires_in=${ex.body.expires_in}`);
  console.log(JSON.stringify(claims(ex.body.access_token), null, 2).replace(/^/gm, '    '));

  step(3, `Redeem the ID-JAG at OUR token endpoint ${asTokenEndpoint} as client ${asClient}`);
  const asSecret = process.env.OUR_AS_CLIENT_SECRET;
  const redeem = await post(asTokenEndpoint, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: ex.body.access_token, client_id: asClient, resource,
  }, asSecret ? { Authorization: basic(asClient, asSecret) } : {});
  if (redeem.status !== 200 || !redeem.body.access_token) fail('redemption', redeem);
  console.log(`    token_type=${redeem.body.token_type} expires_in=${redeem.body.expires_in} scope=${redeem.body.scope || ''} refresh_token=${redeem.body.refresh_token ? 'RETURNED (spec says none)' : 'none'}`);
  console.log(JSON.stringify(claims(redeem.body.access_token), null, 2).replace(/^/gm, '    '));

  if (args.gateway) {
    step(4, `tools/list at ${args.gateway} with the token we returned`);
    const r = await fetch(args.gateway, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${redeem.body.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const text = await r.text();
    const m = text.match(/\{[\s\S]*\}/);
    const body = m ? JSON.parse(m[0]) : {};
    console.log(`    HTTP ${r.status}: ${(body.result?.tools || []).length} tools${body.error ? ` error ${JSON.stringify(body.error)}` : ''}`);
  }
  console.log('\nDone: an outside IdP issued, our authorization server redeemed.');
})().catch((err) => { console.error(err.message); process.exit(1); });
