#!/usr/bin/env node
// enable-pf-mfa-step-up.js — make PF run the PingOne MFA adapter after the password adapter when a client asks for
// acr_values=Multi_Factor (the same trigger the BFF uses for PingOne). Plain sign-in is unchanged.
//
// What it adds (all additive until the policy swap):
//   1. selector  aiDemoPfAcrSelector  — HTTP request parameter selector on `acr_values`, result `Multi_Factor`
//   2. OAuth IdP adapter mapping for aiDemoPfP1Mfa (same as the password adapter's: USER_NAME/USER_KEY <- username)
//   3. the default authentication policy: selector -> [Multi_Factor: password -> MFA] / [otherwise: password]
//      and `acr_values` added to trackedHttpParameters so it survives the login redirect.
// Requires create-pingone-mfa-adapter.js to have been applied (adapter aiDemoPfP1Mfa exists).
//
// Defaults to a dry run. `--apply` changes PF. Before touching the policy it saves the current policy; if a plain
// authorize against the BFF's PF client no longer returns the login page it PUTs the saved policy back.
// Never prints the admin password.
//
//   node scripts/pingfederate/enable-pf-mfa-step-up.js            # dry run: prints the plan
//   node scripts/pingfederate/enable-pf-mfa-step-up.js --apply
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'; // local mkcert PF
const { execFileSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const ADMIN = process.env.PF_ADMIN_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const ENGINE = process.env.PF_ENGINE || 'https://local.ping-devops.com:9031';
const CLIENT_ID = process.env.PF_USER_CLIENT_ID || 'ai-demo-pf-user';
const REDIRECT = process.env.PF_USER_REDIRECT_URI || 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback';
const PASSWORD_ADAPTER = 'aiDemoPfHtmlForm';
const MFA_ADAPTER = 'aiDemoPfP1Mfa';
const SELECTOR = 'aiDemoPfAcrSelector';
const MFA_VALUE = 'Multi_Factor';

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}']).toString();
  const line = env.split('\n').find((l) => l.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error('No PF admin password: set PINGFEDERATE_ADMIN_PASSWORD or run PF as ai-demo-pingfederate.');
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

const source = (id) => ({ type: 'IDP_ADAPTER', sourceRef: { id } });
const done = (context) => ({ action: { type: 'DONE', context }, children: [] });
const passwordOnly = (context) => ({
  action: { type: 'AUTHN_SOURCE', context, authenticationSource: source(PASSWORD_ADAPTER) },
  children: [done('Success'), done('Fail')],
});

(async () => {
  const headers = { Authorization: 'Basic ' + Buffer.from('administrator:' + adminPassword()).toString('base64'), 'X-XSRF-Header': 'x', Accept: 'application/json', 'Content-Type': 'application/json' };
  const call = async (method, p, body) => {
    const r = await fetch(ADMIN + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, ok: r.ok, json, text };
  };
  const mustOk = (what, r) => { if (!r.ok) throw new Error(`${what} failed: HTTP ${r.status} ${r.text.slice(0, 900)}`); };
  const plainLoginOk = async () => {
    const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: 'openid profile email offline_access', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 'mfa-check' });
    const r = await fetch(`${ENGINE}/as/authorization.oauth2?${q}`, { redirect: 'manual' });
    return r.status;
  };

  const adapter = await call('GET', `/idp/adapters/${MFA_ADAPTER}`);
  if (!adapter.ok) throw new Error(`Adapter ${MFA_ADAPTER} not found; run create-pingone-mfa-adapter.js --apply first.`);
  const selectors = await call('GET', '/authenticationSelectors');
  const haveSelector = (selectors.json.items || []).some((s) => s.id === SELECTOR);
  const mappings = await call('GET', '/oauth/idpAdapterMappings');
  const haveMapping = (mappings.json.items || []).some((m) => m.id === MFA_ADAPTER);
  const pwMapping = (mappings.json.items || []).find((m) => m.id === PASSWORD_ADAPTER);
  if (!pwMapping) throw new Error(`No OAuth mapping for ${PASSWORD_ADAPTER} to copy.`);
  const policy = await call('GET', '/authenticationPolicies/default');
  mustOk('read policy', policy);
  const baseline = await plainLoginOk();

  console.log(`selector ${SELECTOR}: ${haveSelector ? 'exists' : 'would create'}`);
  console.log(`OAuth mapping for ${MFA_ADAPTER}: ${haveMapping ? 'exists' : 'would create (copy of the password adapter mapping)'}`);
  console.log(`default policy: ${(policy.json.authnSelectionTrees || []).length} tree(s) now; would set one selector tree, tracked params +acr_values`);
  console.log(`plain PF login (baseline): HTTP ${baseline}`);
  if (!APPLY) { console.log('Dry run. Re-run with --apply to make the changes.'); return; }
  if (baseline !== 200) throw new Error('Plain PF login is not healthy before the change; refusing to touch the policy.');

  if (!haveSelector) {
    mustOk('create selector', await call('POST', '/authenticationSelectors', {
      id: SELECTOR,
      name: 'AI Demo acr_values selector',
      pluginDescriptorRef: { id: 'com.pingidentity.pf.selectors.http.HttpRequestParamAuthnSelector' },
      configuration: { tables: [], fields: [
        { name: 'HTTP Request Parameter Name', value: 'acr_values' },
        { name: 'Case-Sensitive Matching', value: 'true' },
        { name: "Enable 'Any' Result Value", value: 'false' },
        { name: "Enable 'No Match' Result Value", value: 'true' },
        { name: "Enable 'Not in Request' Result Value", value: 'true' },
      ] },
      attributeContract: { extendedAttributes: [{ name: MFA_VALUE }] },
    }));
    console.log('created selector');
  }
  if (!haveMapping) {
    const { id, idpAdapterRef, ...rest } = pwMapping;
    mustOk('create OAuth mapping', await call('POST', '/oauth/idpAdapterMappings', { ...rest, id: MFA_ADAPTER, idpAdapterRef: { id: MFA_ADAPTER } }));
    console.log('created OAuth mapping');
  }

  const previous = policy.json;
  const next = {
    ...previous,
    failIfNoSelection: false,
    trackedHttpParameters: Array.from(new Set([...(previous.trackedHttpParameters || []), 'acr_values'])),
    authnSelectionTrees: [{
      name: 'Password, plus PingOne MFA for acr_values=Multi_Factor',
      enabled: true,
      rootNode: {
        action: { type: 'AUTHN_SELECTOR', authenticationSelectorRef: { id: SELECTOR } },
        children: [
          {
            action: { type: 'AUTHN_SOURCE', context: MFA_VALUE, authenticationSource: source(PASSWORD_ADAPTER) },
            children: [
              {
                action: { type: 'AUTHN_SOURCE', context: 'Success', authenticationSource: source(MFA_ADAPTER) },
                children: [done('Success'), done('Fail')],
              },
              done('Fail'),
            ],
          },
          passwordOnly('No Match'),
          passwordOnly('Not in Request'),
        ],
      },
    }],
  };
  const put = await call('PUT', '/authenticationPolicies/default', next);
  if (!put.ok) throw new Error(`PF rejected the policy: HTTP ${put.status} ${put.text.slice(0, 1200)} (selector and mapping were created; policy unchanged)`);
  const after = await plainLoginOk();
  console.log(`policy updated; plain PF login now: HTTP ${after}`);
  if (after !== 200) {
    const rv = await call('PUT', '/authenticationPolicies/default', previous);
    console.log(`PLAIN LOGIN BROKE -> reverted policy: HTTP ${rv.status}; plain login now HTTP ${await plainLoginOk()}`);
    process.exit(1);
  }
  console.log('Done. Test: https://local.ping-devops.com:4000/dashboard?signin=mfa (PF provider selected).');
})().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
