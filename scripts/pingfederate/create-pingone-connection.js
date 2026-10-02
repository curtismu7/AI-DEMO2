#!/usr/bin/env node
// create-pingone-connection.js — give PingFederate a PingOne connection (needed by the PingOne MFA adapter).
//
// The console path (PingOne Integrations > Products > Add Connection > PingFederate) is a thin wrapper over
// the PingOne API, where a product connection is a "gateway" of type PING_FEDERATE:
//   POST /v1/environments/{env}/gateways                       {name, type: PING_FEDERATE, enabled}
//   POST /v1/environments/{env}/gateways/{id}/credentials      -> {credential: <JWT>}   (max 5 per gateway)
// PF then takes that JWT at POST /pf-admin-api/v1/pingOneConnections {name, credential, description}.
// The credential is handed from one call to the other in memory; it is never printed or written to disk.
//
// Defaults to a dry run (read-only: shows what exists and what would be created). `--apply` creates things.
// Idempotent: reuses an existing PING_FEDERATE gateway of the same name and skips if PF already has the connection.
//
// Credentials: the PINGONE_BOOTSTRAP_* worker from the repo-root .env (needs the gateways:create:gateway
// permission, i.e. Environment Admin; the demo PINGONE_WORKER_* app is RBAC-blocked from that).
//
// Usage:
//   node scripts/pingfederate/create-pingone-connection.js            # dry run
//   node scripts/pingfederate/create-pingone-connection.js --apply
//
// Env overrides: PF_ADMIN_BASE, PINGFEDERATE_ADMIN_PASSWORD, PF_P1_CONNECTION_NAME, PINGONE_GATEWAY_NAME.
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'; // local mkcert PF
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ADMIN = process.env.PF_ADMIN_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const PF_CONN_NAME = process.env.PF_P1_CONNECTION_NAME || 'AI Demo PingOne';
const GATEWAY_NAME = process.env.PINGONE_GATEWAY_NAME || 'AI Demo PingFederate';

function readEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function pfAdminPassword() {
  if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
  const env = execFileSync('docker', ['inspect', 'ai-demo-pingfederate', '--format', '{{range .Config.Env}}{{println .}}{{end}}']).toString();
  const line = env.split('\n').find((l) => l.startsWith('PING_IDENTITY_PASSWORD='));
  if (!line) throw new Error('No PF admin password: set PINGFEDERATE_ADMIN_PASSWORD or run PF as ai-demo-pingfederate.');
  return line.slice('PING_IDENTITY_PASSWORD='.length);
}

async function main() {
  const rootEnv = path.resolve(__dirname, '..', '..', '.env');
  // A worktree carries no gitignored files, so fall back to the shared main checkout's .env.
  const envFile = fs.existsSync(rootEnv) ? rootEnv : path.join(process.env.HOME, 'Development', 'AI-DEMO2', '.env');
  const e = { ...readEnvFile(envFile), ...process.env };
  const { PINGONE_BOOTSTRAP_CLIENT_ID: id, PINGONE_BOOTSTRAP_CLIENT_SECRET: secret, PINGONE_BOOTSTRAP_ENV_ID: envId } = e;
  const region = e.PINGONE_BOOTSTRAP_REGION || 'com';
  if (!id || !secret || !envId) throw new Error('PINGONE_BOOTSTRAP_CLIENT_ID/SECRET/ENV_ID are not all set.');

  const tok = await fetch(`https://auth.pingone.${region}/${envId}/as/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!tok.ok) throw new Error(`PingOne worker token failed: HTTP ${tok.status}`);
  const bearer = { Authorization: `Bearer ${(await tok.json()).access_token}`, 'Content-Type': 'application/json' };
  const P1 = `https://api.pingone.${region}/v1/environments/${envId}`;

  const pfHeaders = { Authorization: 'Basic ' + Buffer.from('administrator:' + pfAdminPassword()).toString('base64'), 'X-XSRF-Header': 'x', Accept: 'application/json', 'Content-Type': 'application/json' };
  const pfConns = await (await fetch(`${ADMIN}/pingOneConnections`, { headers: pfHeaders })).json();
  const pfHas = (pfConns.items || []).find((c) => c.name === PF_CONN_NAME);
  console.log(`PF connection "${PF_CONN_NAME}":`, pfHas ? `already exists (id ${pfHas.id}); nothing to do` : 'missing');
  if (pfHas) return;

  const gw = await fetch(`${P1}/gateways`, { headers: bearer });
  if (!gw.ok) throw new Error(`List gateways failed: HTTP ${gw.status} (worker lacks gateways permission?)`);
  const gateways = (await gw.json())._embedded?.gateways || [];
  let gateway = gateways.find((g) => g.type === 'PING_FEDERATE' && g.name === GATEWAY_NAME);
  console.log(`PingOne gateway "${GATEWAY_NAME}":`, gateway ? `exists (id ${gateway.id})` : 'missing, would create type PING_FEDERATE');
  if (!APPLY) { console.log('Dry run. Re-run with --apply to create the gateway credential and the PF connection.'); return; }

  if (!gateway) {
    const c = await fetch(`${P1}/gateways`, { method: 'POST', headers: bearer, body: JSON.stringify({ name: GATEWAY_NAME, type: 'PING_FEDERATE', enabled: true, description: 'PF local demo: PingOne MFA adapter' }) });
    if (!c.ok) throw new Error(`Create gateway failed: HTTP ${c.status} ${(await c.text()).slice(0, 300)}`);
    gateway = await c.json();
    console.log(`Created PingOne gateway (id ${gateway.id}).`);
  }
  const cr = await fetch(`${P1}/gateways/${gateway.id}/credentials`, { method: 'POST', headers: bearer });
  if (!cr.ok) throw new Error(`Create gateway credential failed: HTTP ${cr.status} ${(await cr.text()).slice(0, 300)}`);
  const { credential } = await cr.json();
  const pf = await fetch(`${ADMIN}/pingOneConnections`, { method: 'POST', headers: pfHeaders, body: JSON.stringify({ name: PF_CONN_NAME, description: 'PingOne MFA adapter', credential }) });
  const body = await pf.text();
  if (!pf.ok) throw new Error(`PF rejected the connection: HTTP ${pf.status} ${body.slice(0, 400)}`);
  console.log(`Created PF PingOne connection "${PF_CONN_NAME}" (HTTP ${pf.status}).`);
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
