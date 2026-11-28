#!/usr/bin/env node
// Enable A2A agent-card discovery on Privilege Remote-Agent applications.
//
// What it does:
//   1. List applications, select Remote-Agent (HttpAppConfig) apps with backends.
//   2. For each selected app (all, or --app <name> to scope), read-modify-write
//      PUT `Spec.HttpAppConfig.EnableAgentCard: true`.
//   3. Optionally verify: after --wait-seconds, re-GET and report
//      Status.A2AAgentStatus (CardURL, protocol, parsed skills).
//
// AUTH (broken wide open 2026-11-19): the LOCAL console API
// (https://local.procyon.ai:8643, listener cyonagent_mac on loopback) requires
// ONLY the `x-procyon-session-id` header — any random UUID, no cookie, no
// key/secret, no auth header. Verified live from plain curl and node fetch:
//   curl -sk "https://local.procyon.ai:8643/api/<tenant>/v1/applications?ObjectMeta.Namespace=default" \
//     -H "x-procyon-session-id: $(uuidgen)"
// returned 200 and an unchanged-object PUT returned 200. Treat it as
// loopback-trust; do not rely on it from other hosts. The CLOUD console
// (console.privilege.pingone.com) still needs the auth_token cookie.
// The 2026-11-18 "key/secret broken" note stands for the cloud host; locally
// key/secret is unnecessary.
//
// Usage:
//   node privilege/scripts/enable-agent-cards.mjs [--tenant <uuid>] \
//     [--url https://local.procyon.ai:8643] [--app <name>]... \
//     [--verify] [--wait-seconds 300] [--dry-run]
const CONSOLE = process.env.PROCYON_URL || 'https://local.procyon.ai:8643';
const DEFAULT_TENANT = '0428ba4f-169c-436b-aff9-b230496e0e3b';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) {
    const next = arr[i + 1];
    acc.push([a.slice(2), !next || next.startsWith('--') ? true : next]);
  }
  return acc;
}, []));

const TENANT = args.tenant || DEFAULT_TENANT;
const DRY = 'dry-run' in args;
const VERIFY = 'verify' in args;
const WAIT = parseInt(args['wait-seconds'] || '300', 10);
const SCOPE = args.app ? (Array.isArray(args.app) ? args.app : [args.app]) : null;

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}

const crypto = await import('node:crypto');
const SID = crypto.randomUUID();

async function api(method, path, body) {
  const res = await fetch(`${CONSOLE}${path}`, {
    method,
    headers: {
      'x-procyon-session-id': SID, // required structurally; value unvalidated
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const appsBody = await api('GET', `/api/${TENANT}/v1/applications?ObjectMeta.Namespace=default`);
const apps = appsBody.Applications || [];
const candidates = apps.filter(a => a.Spec?.HttpAppConfig && (a.Spec.HttpAppConfig.Backends?.Elems?.length || 0) > 0);
const selected = SCOPE ? candidates.filter(a => SCOPE.includes(a.ObjectMeta?.Name)) : candidates;

if (!selected.length) {
  console.error('no Remote-Agent apps with backends matched (scope: ' + (SCOPE ? SCOPE.join(', ') : 'all') + ')');
  process.exit(2);
}

const results = [];
for (const app of selected) {
  const name = app.ObjectMeta.Name;
  const already = app.Spec.HttpAppConfig.EnableAgentCard === true;
  if (!already && !DRY) {
    app.Spec.HttpAppConfig.EnableAgentCard = true;
    await api('PUT', `/api/${TENANT}/v1/applications/default/${name}`, app);
  }
  results.push({ name, already });
  console.log(`${already ? 'already-on' : DRY ? 'would-enable' : 'enabled'}: ${name}`);
}

if (VERIFY && !DRY) {
  console.log(`waiting ${WAIT}s for gateway discovery…`);
  await new Promise(r => setTimeout(r, WAIT * 1000));
  for (const { name } of results) {
    const a = await api('GET', `/api/${TENANT}/v1/applications/default/${name}`);
    const s = a.Status?.A2AAgentStatus;
    let skills = [];
    try { skills = (s?.Skills?.Skills || []).map(x => x.id); } catch {}
    console.log(`${name}: card=${s?.CardURL || 'NONE'} proto=${s?.ProtocolVersion || '-'} skills=[${skills.join(', ')}]`);
  }
}
