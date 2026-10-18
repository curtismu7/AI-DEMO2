#!/usr/bin/env node
// Additively enable CIBA sign-in (decision R1) on the User Login and Admin Login PingOne apps.
//   ENV_FILE=<path> node scripts/pingone/enable-ciba-login.mjs --out <dir> [--app user|admin|both] [--apply] [--probe]
// Default = dry run (read-only GETs, backups written to <out>/<appid>.backup.json, plan printed).
// --apply performs the planned ops one at a time with read-back. --probe creates ONE throwaway app (never touches the real ones).
// Never deletes or reorders anything; never prints secrets.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EMAIL_POLICY = '99972880d9170ab70d72e269cc944186';
export const SMS_POLICY = '87929b3e4c6857e5ff854502dbde1742';
const WANTED = [[EMAIL_POLICY, 'CIBA - EMAIL'], [SMS_POLICY, 'CIBA-SMS']];

// Admin CIBA replaces its sign-on policy with the shared CIBA policy, so PingOne must restrict who can use the app.
const isRestricted = (ac) => !!(ac && (ac.role?.type || ac.group?.groups?.length));

/**
 * @param currentApps [{role:'user'|'admin', app}]
 * @param currentAssignments {[appId]: flowPolicyAssignment[]}
 * @param flowPolicies [{id,name}] live GET /flowPolicies
 * @returns ops [{op:'update-app'|'add-flow-policy', target, body}] with .notes (string[]) attached. Additive only.
 */
export function planCibaLogin(currentApps, currentAssignments, flowPolicies) {
  const ops = []; ops.notes = [];
  const ids = new Set(flowPolicies.map((p) => p.id));
  for (const [id, name] of WANTED) if (!ids.has(id)) throw new Error(`flow policy '${name}' (${id}) not found in environment`);
  for (const { role, app } of currentApps) {
    if (role === 'admin' && !isRestricted(app.accessControl)) {
      ops.notes.push(`BLOCKED: Admin app '${app.name}' (${String(app.id).slice(0, 8)}…) has no PingOne access restriction (accessControl role/group). Enabling CIBA there would let any customer account approve into an admin session. Restrict it in PingOne first; nothing planned for admin.`);
      continue;
    }
    if (!app.grantTypes?.includes('CIBA')) ops.push({ op: 'update-app', target: app.id, body: { ...app, grantTypes: [...app.grantTypes, 'CIBA'] } });
    const have = currentAssignments[app.id] || [];
    let prio = Math.max(0, ...have.map((a) => a.priority || 0));
    for (const [id] of WANTED) if (!have.some((a) => a.flowPolicy?.id === id)) ops.push({ op: 'add-flow-policy', target: app.id, body: { flowPolicy: { id }, priority: ++prio } });
  }
  return ops;
}

// ---- CLI ----
const mask = (s) => (s ? String(s).slice(0, 8) + '…' : s);
const READONLY = ['id', 'environment', 'createdAt', 'updatedAt', '_links'];
const putBody = (app) => Object.fromEntries(Object.entries(app).filter(([k]) => !READONLY.includes(k)));

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : d);
  const flag = (n) => args.includes('--' + n);
  const out = opt('out'); if (!out) { console.error('--out <dir> required'); process.exit(2); }
  const which = opt('app', 'both');
  const f = process.env.ENV_FILE || new URL('../../demo_api_server/.env', import.meta.url).pathname;
  const env = Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
  const E = env.PINGONE_ENVIRONMENT_ID;
  const API = `https://api.pingone.com/v1/environments/${E}`;
  const tr = await fetch(`https://auth.pingone.com/${E}/as/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${env.PINGONE_WORKER_CLIENT_ID}:${env.PINGONE_WORKER_CLIENT_SECRET}`).toString('base64') }, body: 'grant_type=client_credentials' });
  const H = { authorization: 'Bearer ' + (await tr.json()).access_token, 'content-type': 'application/json' };
  const call = async (method, p, body) => { const r = await fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); return r.j; };
  fs.mkdirSync(out, { recursive: true });

  if (flag('probe')) {
    const user = must(await call('GET', '/applications/83572007-b2c7-4862-8197-dc225a9fb8e1'), 'GET user app');
    const name = 'SPIKE-delete-me-login-copy-' + Math.random().toString(36).slice(2, 8);
    const mk = await call('POST', '/applications', { name, enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', pkceEnforcement: user.pkceEnforcement || 'S256_REQUIRED', responseTypes: ['CODE'], redirectUris: ['https://localhost.invalid/callback'] });
    console.log('create throwaway:', mk.status, mk.status < 300 ? '' : JSON.stringify(mk.j).slice(0, 400));
    if (mk.status >= 300) process.exit(1);
    const up = await call('PUT', `/applications/${mk.j.id}`, putBody({ ...mk.j, grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN', 'CIBA'] }));
    const back = (await call('GET', `/applications/${mk.j.id}`)).j;
    console.log('add CIBA to throwaway:', up.status, up.status < 300 ? '' : JSON.stringify(up.j).slice(0, 400));
    console.log('read-back grantTypes:', back.grantTypes, 'pkce:', back.pkceEnforcement, 'auth:', back.tokenEndpointAuthMethod);
    console.log(`PROBE ${up.status < 300 && back.grantTypes?.includes('CIBA') ? 'PASS' : 'FAIL'}. Owner: delete throwaway app '${name}' id ${mk.j.id}`);
    return;
  }

  const ROLE_IDS = { user: '83572007-b2c7-4862-8197-dc225a9fb8e1' };
  const list = must(await call('GET', '/applications'), 'GET applications')._embedded.applications;
  const adminApp = list.find((a) => a.name === 'Demo AI App - Admin Login');
  if (adminApp) ROLE_IDS.admin = adminApp.id; else if (which !== 'user') throw new Error("Admin app 'Demo AI App - Admin Login' not found");
  const roles = which === 'both' ? ['user', 'admin'] : [which];
  const currentApps = []; const assigns = {};
  for (const role of roles) {
    const app = must(await call('GET', `/applications/${ROLE_IDS[role]}`), `GET ${role} app`);
    currentApps.push({ role, app });
    assigns[app.id] = must(await call('GET', `/applications/${app.id}/flowPolicyAssignments`), 'GET flowPolicyAssignments')._embedded?.flowPolicyAssignments || [];
    fs.writeFileSync(path.join(out, `${app.id}.backup.json`), JSON.stringify({ app, flowPolicyAssignments: assigns[app.id], signOnPolicyAssignments: (await call('GET', `/applications/${app.id}/signOnPolicyAssignments`)).j._embedded?.signOnPolicyAssignments }, null, 2));
  }
  const fps = must(await call('GET', '/flowPolicies'), 'GET flowPolicies')._embedded?.flowPolicies || [];
  const ops = planCibaLogin(currentApps, assigns, fps);
  const nameOf = (id) => currentApps.find((c) => c.app.id === id)?.app.name;
  console.log(`Backups written to ${out}/<appid>.backup.json`);
  for (const n of ops.notes) console.log('\n' + n);
  console.log(`\nPLAN (${ops.length} op${ops.length === 1 ? '' : 's'}, additive only):`);
  for (const o of ops) console.log(' -', o.op === 'update-app' ? `PUT app ${mask(o.target)} '${nameOf(o.target)}': add CIBA grant -> grantTypes [${o.body.grantTypes}]` : `POST flowPolicyAssignment on ${mask(o.target)} '${nameOf(o.target)}': ${mask(o.body.flowPolicy.id)} priority ${o.body.priority}`);
  if (!flag('apply')) { console.log('\nDRY RUN: nothing changed. Re-run with --apply to perform.'); return; }

  const revert = [];
  for (const o of ops) {
    if (o.op === 'update-app') {
      const before = currentApps.find((c) => c.app.id === o.target).app;
      must(await call('PUT', `/applications/${o.target}`, putBody(o.body)), 'PUT app');
      const after = must(await call('GET', `/applications/${o.target}`), 'read-back app');
      const same = ['tokenEndpointAuthMethod', 'pkceEnforcement', 'type', 'protocol'].every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k]));
      if (!same || !before.grantTypes.every((g) => after.grantTypes.includes(g)) || !after.grantTypes.includes('CIBA')) throw new Error(`READ-BACK MISMATCH on app ${mask(o.target)}; revert from backup now`);
      revert.push(`PUT /applications/${o.target} with the "app" object from ${out}/${o.target}.backup.json (minus id, environment, createdAt, updatedAt, _links)`);
    } else {
      const r = must(await call('POST', `/applications/${o.target}/flowPolicyAssignments`, o.body), 'POST flowPolicyAssignment');
      const now = must(await call('GET', `/applications/${o.target}/flowPolicyAssignments`), 'read-back assignments')._embedded?.flowPolicyAssignments || [];
      if (!now.some((a) => a.id === r.id && a.flowPolicy?.id === o.body.flowPolicy.id)) throw new Error(`READ-BACK MISMATCH on assignment ${mask(r.id)}`);
      revert.push(`DELETE /applications/${o.target}/flowPolicyAssignments/${r.id}`);
    }
    console.log('applied + verified:', o.op, mask(o.target));
  }
  console.log('\nREVERT (undo in reverse order):\n' + revert.reverse().map((s) => ' - ' + s).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
