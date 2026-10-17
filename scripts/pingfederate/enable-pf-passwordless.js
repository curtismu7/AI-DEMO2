#!/usr/bin/env node
// enable-pf-passwordless.js — device-first (passwordless) sign-in on PingFederate, selected by
// acr_values=mfa_only (the same value the BFF sends PingOne for its passwordless policy).
// The user gives only a username (Identifier First adapter); the PingOne MFA adapter then runs the
// device step (picker, one-time code, passkey). Plain sign-in and acr_values=Multi_Factor are unchanged.
//
// What it adds (additive; existing branches are copied unchanged):
//   1. adapter   aiDemoPfIdFirst  — Identifier First adapter (username only), defaults
//   2. selector  aiDemoPfAcrSelector gains the result value `mfa_only`
//   3. default policy gains the branch  mfa_only -> aiDemoPfIdFirst -> aiDemoPfP1Mfa (user = identified subject)
// Requires enable-pf-mfa-step-up.js to have been applied (selector + aiDemoPfP1Mfa mapping exist).
//
// Before the policy PUT it saves the current policy to ~/pingfederate-profile-backups/. After it, it checks a
// plain authorize still returns the login page and an mfa_only pi.flow opens on IDENTIFIER_REQUIRED; if the plain
// check fails it PUTs the saved policy back. Never prints the admin password.
//
//   node scripts/pingfederate/enable-pf-passwordless.js            # dry run: prints the plan
//   node scripts/pingfederate/enable-pf-passwordless.js --apply
//   node scripts/pingfederate/enable-pf-passwordless.js --revert   # restore the policy saved by the last --apply
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'; // local mkcert PF
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const ADMIN = process.env.PF_ADMIN_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const ENGINE = process.env.PF_ENGINE || 'https://local.ping-devops.com:9031';
const CLIENT_ID = process.env.PF_USER_CLIENT_ID || 'ai-demo-pf-user';
const REDIRECT = process.env.PF_USER_REDIRECT_URI || 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback';
const ID_FIRST = 'aiDemoPfIdFirst';
const MFA_ADAPTER = 'aiDemoPfP1Mfa';
const SELECTOR = 'aiDemoPfAcrSelector';
const VALUE = 'mfa_only';
const BACKUP_DIR = path.join(os.homedir(), 'pingfederate-profile-backups');
const BACKUP = path.join(BACKUP_DIR, 'default-authn-policy.before-pf-passwordless.json');

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}']).toString();
  const line = env.split('\n').find((l) => l.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error('No PF admin password: set PINGFEDERATE_ADMIN_PASSWORD or run PF as ai-demo-pingfederate.');
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

const source = (id) => ({ type: 'IDP_ADAPTER', sourceRef: { id } });
const done = (context) => ({ action: { type: 'DONE', context }, children: [] });

// The branch this script owns: identifier, then the MFA adapter for that subject.
const passwordlessBranch = () => ({
  action: { type: 'AUTHN_SOURCE', context: VALUE, authenticationSource: source(ID_FIRST) },
  children: [
    done('Fail'),
    {
      action: {
        type: 'AUTHN_SOURCE',
        context: 'Success',
        authenticationSource: source(MFA_ADAPTER),
        // Without an input user id PF prunes the MFA node at run time (see enable-pf-mfa-step-up.js).
        inputUserIdMapping: { source: { type: 'ADAPTER', id: ID_FIRST }, value: 'subject' },
      },
      children: [done('Fail'), done('Success')],
    },
  ],
});

/** The policy with the mfa_only branch added under the acr selector (replacing an older copy of it). */
function withPasswordlessBranch(policy) {
  const trees = policy.authnSelectionTrees || [];
  const tree = trees.find((t) => t.rootNode?.action?.authenticationSelectorRef?.id === SELECTOR);
  if (!tree) throw new Error(`No policy tree rooted at ${SELECTOR}; run enable-pf-mfa-step-up.js --apply first.`);
  const children = tree.rootNode.children.filter((c) => c.action?.context !== VALUE);
  const next = JSON.parse(JSON.stringify(policy));
  const nextTree = next.authnSelectionTrees.find((t) => t.rootNode?.action?.authenticationSelectorRef?.id === SELECTOR);
  nextTree.rootNode.children = [passwordlessBranch(), ...JSON.parse(JSON.stringify(children))];
  nextTree.name = 'Password, PingOne MFA for acr_values=Multi_Factor, device-first for acr_values=mfa_only';
  return next;
}

const BASE_TREE_NAME = 'Password, plus PingOne MFA for acr_values=Multi_Factor';
const hasPasswordlessBranch = (policy) => (policy.authnSelectionTrees || []).some((t) =>
  t.rootNode?.action?.authenticationSelectorRef?.id === SELECTOR && t.rootNode.children.some((c) => c.action?.context === VALUE));

/** The policy with the mfa_only branch removed: the state before --apply. `asPassword` keeps the branch but
 *  points it at the password adapter, which PF accepts while mfa_only is still a selector value. */
function withoutPasswordlessBranch(policy, { asPassword = false } = {}) {
  const next = JSON.parse(JSON.stringify(policy));
  for (const t of next.authnSelectionTrees || []) {
    if (t.rootNode?.action?.authenticationSelectorRef?.id !== SELECTOR) continue;
    const others = t.rootNode.children.filter((c) => c.action?.context !== VALUE);
    if (asPassword) {
      const pw = others.find((c) => c.action?.context === 'No Match');
      t.rootNode.children = [{ ...JSON.parse(JSON.stringify(pw)), action: { ...pw.action, context: VALUE } }, ...others];
    } else {
      t.rootNode.children = others;
      t.name = BASE_TREE_NAME;
    }
  }
  return next;
}

module.exports = { withPasswordlessBranch, withoutPasswordlessBranch, hasPasswordlessBranch, passwordlessBranch };

if (require.main === module) (async () => {
  const headers = { Authorization: 'Basic ' + Buffer.from('administrator:' + adminPassword()).toString('base64'), 'X-XSRF-Header': 'x', Accept: 'application/json', 'Content-Type': 'application/json' };
  const call = async (method, p, body) => {
    const r = await fetch(ADMIN + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, ok: r.ok, json, text };
  };
  const mustOk = (what, r) => { if (!r.ok) throw new Error(`${what} failed: HTTP ${r.status} ${r.text.slice(0, 900)}`); };
  const authorize = async (extra) => {
    const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: 'openid profile email offline_access', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 'pwless-check', ...extra });
    return fetch(`${ENGINE}/as/authorization.oauth2?${q}`, { redirect: 'manual', headers: { Accept: 'application/json' } });
  };
  const plainLoginOk = async () => (await authorize({})).status;
  const passwordlessOpens = async () => {
    const r = await authorize({ response_mode: 'pi.flow', acr_values: VALUE });
    const body = await r.json().catch(() => ({}));
    return `HTTP ${r.status} status=${body.status || '-'}`;
  };

  if (REVERT) {
    // PF rejects a policy missing a branch for any selector value, so: branch -> password, drop the
    // selector value, restore the "before" policy, delete the now-unused adapter.
    const live = await call('GET', '/authenticationPolicies/default');
    mustOk('read policy', live);
    const saved = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : null;
    const before = saved && !hasPasswordlessBranch(saved) ? saved : withoutPasswordlessBranch(live.json);
    console.log(`restoring ${saved && before === saved ? `the backup ${BACKUP}` : 'the live policy minus the mfa_only branch'}`);
    if (hasPasswordlessBranch(live.json)) {
      mustOk('point mfa_only at the password form', await call('PUT', '/authenticationPolicies/default', withoutPasswordlessBranch(live.json, { asPassword: true })));
    }
    const sel = await call('GET', `/authenticationSelectors/${SELECTOR}`);
    mustOk('read selector', sel);
    const kept = (sel.json.attributeContract?.extendedAttributes || []).filter((a) => a.name !== VALUE);
    mustOk('remove selector value', await call('PUT', `/authenticationSelectors/${SELECTOR}`, { ...sel.json, attributeContract: { extendedAttributes: kept } }));
    mustOk('restore policy', await call('PUT', '/authenticationPolicies/default', before));
    const del = await call('DELETE', `/idp/adapters/${ID_FIRST}`);
    console.log(`adapter ${ID_FIRST}: ${del.ok ? 'deleted' : del.status === 404 ? 'already gone' : `left (HTTP ${del.status})`}`);
    console.log(`Reverted. plain PF login: HTTP ${await plainLoginOk()}; mfa_only pi.flow now: ${await passwordlessOpens()}`);
    return;
  }

  const adapters = await call('GET', '/idp/adapters');
  const haveIdFirst = (adapters.json.items || []).some((a) => a.id === ID_FIRST);
  if (!(adapters.json.items || []).some((a) => a.id === MFA_ADAPTER)) throw new Error(`Adapter ${MFA_ADAPTER} not found; run create-pingone-mfa-adapter.js --apply first.`);
  const selector = await call('GET', `/authenticationSelectors/${SELECTOR}`);
  if (!selector.ok) throw new Error(`Selector ${SELECTOR} not found; run enable-pf-mfa-step-up.js --apply first.`);
  const values = (selector.json.attributeContract?.extendedAttributes || []).map((a) => a.name);
  const policy = await call('GET', '/authenticationPolicies/default');
  mustOk('read policy', policy);
  const next = withPasswordlessBranch(policy.json); // throws early if the selector tree is missing
  const baseline = await plainLoginOk();

  console.log(`adapter ${ID_FIRST}: ${haveIdFirst ? 'exists' : 'would create (Identifier First, defaults)'}`);
  console.log(`selector ${SELECTOR} values [${values.join(', ')}]: ${values.includes(VALUE) ? `${VALUE} present` : `would add ${VALUE}`}`);
  console.log(`default policy: would add branch ${VALUE} -> ${ID_FIRST} -> ${MFA_ADAPTER}; other branches copied unchanged`);
  console.log(`plain PF login (baseline): HTTP ${baseline}; mfa_only pi.flow now: ${await passwordlessOpens()}`);
  if (!APPLY) { console.log('Dry run. Re-run with --apply to make the changes.'); return; }
  if (baseline !== 200) throw new Error('Plain PF login is not healthy before the change; refusing to touch the policy.');

  if (!haveIdFirst) {
    mustOk('create adapter', await call('POST', '/idp/adapters', {
      id: ID_FIRST,
      name: 'AI Demo identifier first (passwordless)',
      pluginDescriptorRef: { id: 'com.pingidentity.adapters.identifierfirst.idp.IdentifierFirstAdapter' },
      configuration: { tables: [], fields: [
        { name: 'Identifier Cookie Lifetime', value: '30' },
        { name: 'Maximum Identifiers Count', value: '5' },
        { name: 'Identifier Selection Template', value: 'identifier.first.template.html' },
      ] },
      attributeContract: { coreAttributes: [{ name: 'subject', pseudonym: true }, { name: 'domain' }] },
    }));
    console.log(`created adapter ${ID_FIRST}`);
  }
  if (!values.includes(VALUE)) {
    const updated = { ...selector.json, attributeContract: { extendedAttributes: [...(selector.json.attributeContract?.extendedAttributes || []), { name: VALUE }] } };
    mustOk('add selector value', await call('PUT', `/authenticationSelectors/${SELECTOR}`, updated));
    console.log(`added ${VALUE} to ${SELECTOR}`);
  }

  if (hasPasswordlessBranch(policy.json)) {
    console.log(`policy already has the ${VALUE} branch; keeping the existing backup (not overwriting it with an "after" copy)`);
  } else {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(BACKUP, JSON.stringify(policy.json, null, 2), { mode: 0o600 });
    console.log(`saved the current policy to ${BACKUP}`);
  }
  const put = await call('PUT', '/authenticationPolicies/default', next);
  if (!put.ok) throw new Error(`PF rejected the policy: HTTP ${put.status} ${put.text.slice(0, 1200)} (policy unchanged)`);
  const after = await plainLoginOk();
  console.log(`policy updated; plain PF login now: HTTP ${after}; mfa_only pi.flow now: ${await passwordlessOpens()}`);
  if (after !== 200) {
    const rv = await call('PUT', '/authenticationPolicies/default', policy.json);
    console.log(`PLAIN LOGIN BROKE -> reverted policy: HTTP ${rv.status}; plain login now HTTP ${await plainLoginOk()}`);
    process.exit(1);
  }
  console.log('Done. Undo with --revert.');
})().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
