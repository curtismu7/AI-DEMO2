#!/usr/bin/env node
// create-pingone-mfa-adapter.js — add the PingOne MFA IdP adapter to PingFederate, using the PingOne connection
// made by create-pingone-connection.js. Step 1 of MFA on PF; the selector + policy that call it come next.
//
// Defaults to a dry run (prints the adapter it would POST; nothing is written). `--apply` creates it.
// Idempotent: does nothing if the adapter id already exists. No secrets are involved or printed.
//
// Inputs (PingOne ids from list-pingone-mfa-inputs.js), overridable by env:
//   P1_POPULATION_ID  default a7349e04-... "Sample Users"  (PF users get provisioned here on first MFA)
//   P1_APPLICATION_ID default 160cc22f-... "Demo AI App - PKCE"
//   P1_MFA_POLICY_ID  default 9e94e3ca-... "Default MFA Policy"
//   PF_P1_CONNECTION_NAME default "AI Demo PingOne"
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'; // local mkcert PF
const { execFileSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const ADMIN = process.env.PF_ADMIN_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const ADAPTER_ID = 'aiDemoPfP1Mfa';
const DESCRIPTOR = 'com.pingidentity.adapters.pingone.mfa.PingOneMfaIdpAdapter';
const CONN_NAME = process.env.PF_P1_CONNECTION_NAME || 'AI Demo PingOne';
const POPULATION = process.env.P1_POPULATION_ID || 'a7349e04-08ef-4225-8b75-7ec4bb4bc127';
const APPLICATION = process.env.P1_APPLICATION_ID || '160cc22f-ccc4-4fef-8470-c9094c8a9afa';
const MFA_POLICY = process.env.P1_MFA_POLICY_ID || '9e94e3ca-9536-06a9-016a-b2baa39b363f';

function adminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}']).toString();
  const line = env.split('\n').find((l) => l.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error('No PF admin password: set PINGFEDERATE_ADMIN_PASSWORD or run PF as ai-demo-pingfederate.');
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

(async () => {
  const headers = { Authorization: 'Basic ' + Buffer.from('administrator:' + adminPassword()).toString('base64'), 'X-XSRF-Header': 'x', Accept: 'application/json', 'Content-Type': 'application/json' };
  const get = async (p) => { const r = await fetch(ADMIN + p, { headers }); return r.ok ? r.json() : { _status: r.status }; };

  const adapters = await get('/idp/adapters');
  if ((adapters.items || []).some((a) => a.id === ADAPTER_ID)) { console.log(`Adapter ${ADAPTER_ID} already exists; nothing to do.`); return; }
  const conn = ((await get('/pingOneConnections')).items || []).find((c) => c.name === CONN_NAME);
  if (!conn) throw new Error(`PF has no PingOne connection named "${CONN_NAME}"; run create-pingone-connection.js first.`);
  const env = ((await get(`/pingOneConnections/${conn.id}/environments`)).items || [])[0];
  if (!env) throw new Error('The PingOne connection exposes no environment.');

  const desc = ((await get('/idp/adapters/descriptors')).items || []).find((d) => d.id === DESCRIPTOR);
  if (!desc) throw new Error('PingOne MFA adapter type is not installed in this PF.');
  // Start from every required field's default so PF's own validation only has to judge our choices.
  const values = {};
  for (const f of desc.configDescriptor.fields) if (f.required !== false && f.defaultValue !== undefined) values[f.name] = f.defaultValue;
  Object.assign(values, {
    'PingOne Environment': env.id,
    'PingOne Population': POPULATION,
    Application: APPLICATION,
    'MFA policy for registration': MFA_POLICY,
    'Prompt Users to Set Up MFA': 'true',
    'Provision Users and Authentication Methods': 'true',
    'Username Attribute': 'username',
  });
  const body = {
    id: ADAPTER_ID,
    name: 'AI Demo PingOne MFA',
    pluginDescriptorRef: { id: DESCRIPTOR },
    configuration: { tables: [], fields: Object.entries(values).map(([name, value]) => ({ name, value: String(value) })) },
    attributeContract: { coreAttributes: [{ name: 'username', pseudonym: true }], extendedAttributes: [] },
  };
  console.log(`Would create adapter ${ADAPTER_ID} on connection "${CONN_NAME}" (env ${env.id}). Fields:`);
  for (const f of body.configuration.fields) console.log(`  ${f.name} = ${f.value}`);
  if (!APPLY) { console.log('Dry run. Re-run with --apply to create it.'); return; }

  const r = await fetch(ADMIN + '/idp/adapters', { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`PF rejected the adapter: HTTP ${r.status} ${text.slice(0, 900)}`);
  console.log(`Created adapter ${ADAPTER_ID} (HTTP ${r.status}).`);
})().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
