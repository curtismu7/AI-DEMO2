#!/usr/bin/env node
// list-pingone-gateway-roles.js — read-only: the role assignments on the PingOne gateway behind PF's PingOne connection.
// PF can only list populations/applications/MFA policies for the adapter if that gateway holds suitable roles.
// Uses the PINGONE_BOOTSTRAP_* worker (repo-root .env, main checkout fallback). Prints ids and names only.
'use strict';
const fs = require('fs');
const path = require('path');
const GATEWAY_NAME = process.env.PINGONE_GATEWAY_NAME || 'AI Demo PingFederate';

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
  const gw = ((await get('/gateways'))._embedded?.gateways || []).find((g) => g.name === GATEWAY_NAME);
  if (!gw) throw new Error(`No gateway named "${GATEWAY_NAME}".`);
  console.log(`gateway ${gw.id} type=${gw.type} enabled=${gw.enabled}`);
  const ra = await get(`/gateways/${gw.id}/roleAssignments`);
  const items = ra._embedded?.roleAssignments || [];
  console.log('role assignments:', items.length ? items.map((r) => `${r.role?.id} scope=${r.scope?.type}:${r.scope?.id}`).join(' | ') : JSON.stringify(ra));
  const roles = await get('/roles');
  if (roles._embedded) console.log('roles in env:', roles._embedded.roles.map((r) => `${r.id} "${r.name}"`).join(' | '));
  else console.log('roles list:', JSON.stringify(roles));
})().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
