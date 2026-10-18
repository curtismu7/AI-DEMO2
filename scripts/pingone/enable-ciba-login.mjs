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
// Strict: only the known PingOne restriction shapes count (role ADMIN_USERS_ONLY, or a group restriction with >=1 group).
const isRestricted = (ac) => !!(ac && (ac.role?.type === 'ADMIN_USERS_ONLY'
  || (['ANY_GROUP', 'ALL_GROUPS'].includes(ac.group?.type) && Array.isArray(ac.group.groups) && ac.group.groups.length > 0)));

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
    const grants = app.grantTypes || [];
    if (!grants.includes('CIBA')) ops.push({ op: 'update-app', target: app.id, body: { ...app, grantTypes: [...grants, 'CIBA'] } });
    const have = currentAssignments[app.id] || [];
    let prio = Math.max(0, ...have.map((a) => a.priority || 0));
    for (const [id] of WANTED) if (!have.some((a) => a.flowPolicy?.id === id)) ops.push({ op: 'add-flow-policy', target: app.id, body: { flowPolicy: { id }, priority: ++prio } });
  }
  return ops;
}

const READONLY = ['id', 'environment', 'createdAt', 'updatedAt', '_links'];
export const putBody = (app) => Object.fromEntries(Object.entries(app).filter(([k]) => !READONLY.includes(k)));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

/** Differing top-level fields between two apps (values never returned).
 *  Keys ABSENT before and present after are benign server-added defaults (returned as `added`); any key present before that
 *  changes or goes missing (incl. null -> missing) is a difference. grantTypes must equal before + 'CIBA' as a SET (PingOne reorders). */
export function diffApps(before, after) {
  const b = putBody(before); const a = putBody(after); const bad = [];
  const added = Object.keys(a).filter((k) => !(k in b));
  for (const k of Object.keys(b)) {
    if (k === 'grantTypes') continue;
    if (JSON.stringify(canon(b[k])) !== JSON.stringify(canon(a[k]))) bad.push(k);
  }
  if (JSON.stringify([...(a.grantTypes || [])].sort()) !== JSON.stringify([...(b.grantTypes || []), 'CIBA'].sort())) bad.push('grantTypes');
  return { bad, added: added.filter((k) => k !== 'grantTypes') };
}

export const backupName = (appId, now = new Date()) => `${appId}.${now.toISOString().replace(/:/g, '-')}.backup.json`;
/** The ORIGINAL backup is the earliest timestamped one for the app. */
export const originalBackup = (files, appId) => files.filter((f) => f.startsWith(appId + '.') && f.endsWith('.backup.json')).sort()[0];

export function pickByName(list, name) {
  const m = list.filter((a) => a.name === name);
  if (m.length !== 1) throw new Error(`expected exactly one app named '${name}', found ${m.length}`);
  return m[0];
}

export function parseArgs(argv) {
  const r = { app: 'both', apply: false, probe: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply' || a === '--probe') r[a.slice(2)] = true;
    else if (a === '--out' || a === '--app') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      r[a.slice(2)] = v;
    } else throw new Error(`unknown argument '${a}'`);
  }
  if (!r.out) throw new Error('--out <dir> required');
  if (!['user', 'admin', 'both'].includes(r.app)) throw new Error('--app must be user|admin|both');
  return r;
}

/** The ONE write path for an app change (used by --apply and --probe): PUT, onPut() right after a 2xx (so the caller can print REVERT
 *  before anything can fail), re-GET, deep compare. A mismatch throws an error with .applied = true (the PUT is live). */
export async function putAppVerified(call, before, desired, onPut = () => {}) {
  const r = await call('PUT', `/applications/${before.id}`, putBody(desired));
  if (r.status >= 300) throw new Error(`PUT app failed: ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`);
  onPut();
  const fail = (m) => Object.assign(new Error(m), { applied: true });
  const g = await call('GET', `/applications/${before.id}`);
  if (g.status >= 300) throw fail(`read-back GET failed: ${g.status}`);
  const { bad, added } = diffApps(before, g.j);
  if (bad.length) throw fail(`READ-BACK MISMATCH on app ${String(before.id).slice(0, 8)}…; differing fields: ${bad.join(', ')}`);
  return { after: g.j, added };
}

/** --apply wrapper: records state the moment the PUT succeeds. state = {done: string[], pending: string[]}. */
export async function trackedUpdate(call, before, desired, state, label, revertLine, log = console.log) {
  const r = await putAppVerified(call, before, desired, () => {
    log(`PUT accepted for ${label} (read-back pending)\n${revertLine}`);
    state.done.push(`${label} (APPLIED, UNVERIFIED)`); state.pending.shift();
  });
  state.done[state.done.length - 1] = `${label} (applied, verified)`;
  if (r.added.length) log(`PingOne added (not an error): ${r.added.join(', ')}`);
  return r;
}

export const summarize = ({ done, pending }) => `\nSTATE AFTER RUN\n applied: ${done.length ? done.join('; ') : 'none'}\n not applied: ${pending.length ? pending.join('; ') : 'none'}\n (use the REVERT lines printed above to undo)`;

/** Everything after auth: read, back up, plan, and (with apply) perform. `call(method, path, body) -> {status, j}` is injected so tests can drive the real flow. */
export async function runEnable({ call, out, which = 'both', apply = false, log = console.log, now = () => new Date(), fsApi = fs, userId = '83572007-b2c7-4862-8197-dc225a9fb8e1' }) {
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); return r.j; };
  fsApi.mkdirSync(out, { recursive: true });
  const ROLE_IDS = { user: userId };
  const list = must(await call('GET', '/applications'), 'GET applications')._embedded.applications;
  if (which !== 'user') ROLE_IDS.admin = pickByName(list, 'Demo AI App - Admin Login').id;
  const roles = which === 'both' ? ['user', 'admin'] : [which];
  const currentApps = []; const assigns = {}; const stamp = now();
  for (const role of roles) {
    const app = must(await call('GET', `/applications/${ROLE_IDS[role]}`), `GET ${role} app`);
    currentApps.push({ role, app });
    assigns[app.id] = must(await call('GET', `/applications/${app.id}/flowPolicyAssignments`), 'GET flowPolicyAssignments')._embedded?.flowPolicyAssignments || [];
    const so = must(await call('GET', `/applications/${app.id}/signOnPolicyAssignments`), 'GET signOnPolicyAssignments')._embedded?.signOnPolicyAssignments;
    if (!Array.isArray(so)) throw new Error(`signOnPolicyAssignments for ${mask(app.id)} missing from response`);
    fsApi.writeFileSync(path.join(out, backupName(app.id, stamp)), JSON.stringify({ app, flowPolicyAssignments: assigns[app.id], signOnPolicyAssignments: so }, null, 2), { flag: 'wx' });
  }
  const fps = must(await call('GET', '/flowPolicies'), 'GET flowPolicies')._embedded?.flowPolicies || [];
  const ops = planCibaLogin(currentApps, assigns, fps);
  const nameOf = (id) => currentApps.find((c) => c.app.id === id)?.app.name;
  const origFiles = Object.fromEntries(currentApps.map((c) => [c.app.id, path.join(out, originalBackup(fsApi.readdirSync(out), c.app.id))]));
  log(`Backups: ${out}/<appid>.<time>.backup.json (never overwritten; the EARLIEST per app is the ORIGINAL)`);
  for (const n of ops.notes) log('\n' + n);
  log(`\nPLAN (${ops.length} op${ops.length === 1 ? '' : 's'}, additive only):`);
  for (const x of ops) log(' -', x.op === 'update-app' ? `PUT app ${mask(x.target)} '${nameOf(x.target)}': add CIBA grant -> grantTypes [${x.body.grantTypes}]` : `POST flowPolicyAssignment on ${mask(x.target)} '${nameOf(x.target)}': ${mask(x.body.flowPolicy.id)} priority ${x.body.priority}`);
  if (!apply) { log('\nDRY RUN: nothing changed. Re-run with --apply to perform.'); return { ops, state: null, failed: false }; }

  let failed = false;
  const state = { done: [], pending: ops.map((x) => `${x.op} ${mask(x.target)}`) };
  try {
    for (const x of ops) {
      const label = `${x.op} ${mask(x.target)}`;
      if (x.op === 'update-app') {
        const before = currentApps.find((c) => c.app.id === x.target).app;
        await trackedUpdate(call, before, x.body, state, label, `REVERT: PUT /applications/${x.target} with the "app" object from ${origFiles[x.target]} (minus id, environment, createdAt, updatedAt, _links); grantTypes back to [${before.grantTypes}]`, log);
      } else {
        const r = must(await call('POST', `/applications/${x.target}/flowPolicyAssignments`, x.body), 'POST flowPolicyAssignment');
        log(`created assignment ${r.id}; REVERT (instruction only, never run by this script): DELETE /applications/${x.target}/flowPolicyAssignments/${r.id}`);
        state.done.push(`${label} (APPLIED, UNVERIFIED)`); state.pending.shift();
        const now = must(await call('GET', `/applications/${x.target}/flowPolicyAssignments`), 'read-back assignments')._embedded?.flowPolicyAssignments || [];
        if (!now.some((a) => a.id === r.id && a.flowPolicy?.id === x.body.flowPolicy.id)) throw new Error(`READ-BACK MISMATCH on assignment ${r.id}`);
        state.done[state.done.length - 1] = `${label} (applied, verified)`;
        log('verified:', mask(x.target), mask(x.body.flowPolicy.id));
      }
    }
  } catch (e) {
    failed = true; log('ERROR: ' + e.message);
  } finally {
    log(summarize(state));
  }
  return { ops, state, failed };
}

// ---- CLI ----
const mask = (s) => (s ? String(s).slice(0, 8) + '…' : s);

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { out, app: which } = o;
  const f = process.env.ENV_FILE || new URL('../../demo_api_server/.env', import.meta.url).pathname;
  const env = Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
  const E = env.PINGONE_ENVIRONMENT_ID;
  const API = `https://api.pingone.com/v1/environments/${E}`;
  const tr = await fetch(`https://auth.pingone.com/${E}/as/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${env.PINGONE_WORKER_CLIENT_ID}:${env.PINGONE_WORKER_CLIENT_SECRET}`).toString('base64') }, body: 'grant_type=client_credentials' });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) throw new Error(`worker token request failed: ${tr.status} ${tj.error || ''}`);
  const H = { authorization: 'Bearer ' + tj.access_token, 'content-type': 'application/json' };
  const call = async (method, p, body) => { const r = await fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); return r.j; };
  fs.mkdirSync(out, { recursive: true });

  if (o.probe) {
    const user = must(await call('GET', '/applications/83572007-b2c7-4862-8197-dc225a9fb8e1'), 'GET user app');
    const name = 'SPIKE-delete-me-login-copy-' + Math.random().toString(36).slice(2, 8);
    const { clientId: _omit, ...copy } = putBody(user); // a new app must get its own clientId (PingOne rejects a reused one)
    const body = { ...copy, name };
    let mk = await call('POST', '/applications', body);
    let placeholder = false;
    if (mk.status >= 300 && (body.redirectUris || body.postLogoutRedirectUris)) { // originals may clash
      placeholder = true;
      if (body.redirectUris) body.redirectUris = ['https://localhost.invalid/callback'];
      if (body.postLogoutRedirectUris) body.postLogoutRedirectUris = ['https://localhost.invalid/logout'];
      mk = await call('POST', '/applications', body);
    }
    console.log('create throwaway (full copy of User Login settings):', mk.status, placeholder ? '(redirect URIs replaced by placeholders)' : '(original redirect URIs kept)', mk.status < 300 ? '' : JSON.stringify(mk.j).slice(0, 400));
    if (mk.status >= 300) process.exit(1);
    console.log(`THROWAWAY '${name}' id ${mk.j.id} (owner: delete it)`);
    console.log('Fields stripped from the copy source:', [...READONLY.filter((k) => k in user), 'clientId (create only)'].join(', '));
    const created = must(await call('GET', `/applications/${mk.j.id}`), 'GET throwaway');
    const { clientId: _c, ...ub } = putBody(user); const cb = putBody(created);
    const changed = Object.keys(ub).filter((k) => k !== 'name' && !(placeholder && /RedirectUris$/.test(k)) && JSON.stringify(canon(ub[k])) !== JSON.stringify(canon(cb[k])));
    const extra = Object.keys(cb).filter((k) => !(k in ub) && k !== 'clientId');
    console.log('POST copy vs source, fields PingOne changed:', changed.length ? changed.join(', ') : 'none', '| fields PingOne added:', extra.length ? extra.join(', ') : 'none');
    try {
      const { after, added } = await putAppVerified(call, created, { ...created, grantTypes: [...(created.grantTypes || []), 'CIBA'] });
      console.log('PUT CIBA via the --apply code path + deep compare: LOSSLESS (PingOne added, not an error: ' + (added.join(', ') || 'none') + '). grantTypes now', after.grantTypes, 'pkce', after.pkceEnforcement, 'auth', after.tokenEndpointAuthMethod);
    } catch (e) { console.log('PUT CIBA via the --apply code path: FAILED -', e.message); process.exitCode = 1; }
    return;
  }

  const r = await runEnable({ call, out, which, apply: o.apply });
  if (r.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
