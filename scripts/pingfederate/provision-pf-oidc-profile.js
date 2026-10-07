#!/usr/bin/env node
'use strict';
/**
 * Release the PingOne directory's profile (email, name, phone, and the username as preferred_username) in
 * PingFederate's ID token and userinfo, by extending the OIDC policy aiDemoPfOidcPolicy with a lookup in the
 * existing PingOne REST data store. See oidc-profile-claims.js for what and why.
 *
 * Order matters: the data store must already define the profile attributes. They live in
 * spiffe/pingfederate/pf-pingone-user-gate.json, so run that first:
 *   python3 scripts/pingfederate/provision-pf-pingone-user-gate.sh --apply
 *
 * Dry run by default. --apply backs the policy up to the temp directory, changes it, and reads it back.
 * --remove takes the profile claims off again (the way back if sign-in misbehaves). Never prints a secret.
 *
 *   node scripts/pingfederate/provision-pf-oidc-profile.js            # dry run
 *   node scripts/pingfederate/provision-pf-oidc-profile.js --apply
 *   node scripts/pingfederate/provision-pf-oidc-profile.js --remove
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DATA_STORE_ID, REQUIRED_ATTRIBUTES, withProfile, profileFacts, dataStoreAttributes,
} = require('./oidc-profile-claims');

const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');
const POLICY_ID = 'aiDemoPfOidcPolicy';
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';

const log = (message) => console.log(`[pf-oidc-profile] ${message}`);

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const lines = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' }).split('\n');
  const line = lines.find((entry) => entry.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error(`PING_IDENTITY_PASSWORD is not set on ${CONTAINER}`);
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

async function main() {
  // The local PF admin API uses a self-signed chain.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const auth = 'Basic ' + Buffer.from(`administrator:${adminPassword()}`).toString('base64');
  const api = async (method, resource, body) => {
    const response = await fetch(`${PF_BASE}/${resource}`, {
      method,
      headers: { Authorization: auth, 'X-XSRF-Header': 'x', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = (json.validationErrors || []).map((item) => item.message).join('; ') || json.message || '';
      throw new Error(`${method} ${resource} -> HTTP ${response.status} ${detail}`.trim());
    }
    return json;
  };
  log(`${APPLY ? 'apply' : 'dry run'}${REMOVE ? ' (remove)' : ''} against ${PF_BASE}`);

  const store = await api('GET', `dataStores/${DATA_STORE_ID}`);
  const have = new Set(dataStoreAttributes(store));
  const missing = REQUIRED_ATTRIBUTES.filter((name) => !have.has(name));
  if (missing.length && !REMOVE) {
    throw new Error(`the data store ${DATA_STORE_ID} lacks ${missing.join(', ')}; run provision-pf-pingone-user-gate.sh --apply first`);
  }
  log(`data store ${DATA_STORE_ID}: ${REMOVE ? 'not needed to remove' : 'has the profile attributes'}`);

  const policy = await api('GET', `oauth/openIdConnect/policies/${POLICY_ID}`);
  const wanted = withProfile(policy, !REMOVE);
  const same = JSON.stringify(profileFacts(policy)) === JSON.stringify(profileFacts(wanted));
  if (same) return log(`policy ${POLICY_ID}: already ${REMOVE ? 'without' : 'with'} the profile claims`);
  if (!APPLY) return log(`policy ${POLICY_ID}: WOULD ${REMOVE ? 'remove' : 'add'} ${Object.keys(profileFacts(REMOVE ? policy : wanted).fulfilled).join(', ')}`);

  const backup = path.join(os.tmpdir(), `pf-oidc-policy-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(policy, null, 2), { mode: 0o600 });
  log(`backed up the current policy to ${backup}`);
  await api('PUT', `oauth/openIdConnect/policies/${POLICY_ID}`, wanted);
  const after = await api('GET', `oauth/openIdConnect/policies/${POLICY_ID}`);
  const ok = JSON.stringify(profileFacts(after)) === JSON.stringify(profileFacts(wanted));
  log(`policy ${POLICY_ID}: applied, readback ${ok ? 'ok' : 'MISMATCH'}`);
  if (!ok) throw new Error('PingFederate did not keep the policy as sent');
  if (!REMOVE) log('Sign in at PingFederate again to see the claims. If sign-in fails, run with --remove.');
}

main().catch((error) => { console.error(`[pf-oidc-profile] failed: ${error.message}`); process.exit(1); });
