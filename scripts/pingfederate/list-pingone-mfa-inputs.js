#!/usr/bin/env node
// list-pingone-mfa-inputs.js — read-only: the PingOne populations, MFA (device authentication) policies and the
// sign-on policy of the demo PKCE app, i.e. the IDs the PF PingOne MFA adapter needs.
// Prints ids and names only. Uses the PINGONE_BOOTSTRAP_* worker from the repo-root .env (main checkout fallback).
'use strict';
const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

(async () => {
  const rootEnv = path.resolve(__dirname, '..', '..', '.env');
  const file = fs.existsSync(rootEnv) ? rootEnv : path.join(process.env.HOME, 'Development', 'AI-DEMO2', '.env');
  const e = { ...readEnvFile(file), ...process.env };
  const region = e.PINGONE_BOOTSTRAP_REGION || 'com';
  const envId = e.PINGONE_BOOTSTRAP_ENV_ID;
  const tok = await fetch(`https://auth.pingone.${region}/${envId}/as/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${e.PINGONE_BOOTSTRAP_CLIENT_ID}:${e.PINGONE_BOOTSTRAP_CLIENT_SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!tok.ok) throw new Error(`worker token: HTTP ${tok.status}`);
  const h = { Authorization: `Bearer ${(await tok.json()).access_token}` };
  const base = `https://api.pingone.${region}/v1/environments/${envId}`;
  const get = async (p) => { const r = await fetch(base + p, { headers: h }); return r.ok ? r.json() : { _status: r.status }; };

  const pops = await get('/populations');
  console.log('populations:', (pops._embedded?.populations || [pops]).map((p) => `${p.id} "${p.name}"${p.default ? ' (default)' : ''}`).join(' | ') || JSON.stringify(pops));
  const dap = await get('/deviceAuthenticationPolicies');
  console.log('MFA policies:', (dap._embedded?.deviceAuthenticationPolicies || [dap]).map((p) => `${p.id} "${p.name}"${p.default ? ' (default)' : ''}`).join(' | '));
  const apps = ['160cc22f-ccc4-4fef-8470-c9094c8a9afa'];
  for (const a of apps) {
    const sp = await get(`/applications/${a}/signOnPolicyAssignments`);
    console.log(`app ${a} sign-on policies:`, (sp._embedded?.signOnPolicyAssignments || []).map((x) => x.signOnPolicy?.id).join(', ') || JSON.stringify(sp));
  }
})().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
