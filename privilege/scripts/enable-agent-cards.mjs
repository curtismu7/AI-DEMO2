#!/usr/bin/env node
// Enable A2A agent-card discovery on Privilege Remote-Agent applications.
//
// What it does:
//   1. List applications, select those with an HttpAppConfig backend.
//   2. For each selected app (all with a backend, or --app <name> to scope),
//      read-modify-write PUT `Spec.HttpAppConfig.EnableAgentCard: true`.
//   3. Optionally verify: after --wait-seconds, re-GET and report
//      Status.A2AAgentStatus (CardURL, protocol, parsed skills).
//
// Auth: x-auth-token browser-session blob (key/secret auth is broken on the
// local console as of 2026-11-18 — see .claude/skills/privilege-console-api).
// Grab it from the signed-in console: devtools -> Network -> any XHR ->
// request header `x-auth-token` (a JSON blob with user/org/tenant).
//
// Usage:
//   node privilege/scripts/enable-agent-cards.mjs \
//     --token '{"user":"…","org":"default","tenant":"…"}' \
//     [--url https://local.procyon.ai:8643] \
//     [--app <name>]...          # scope to named apps; default: all Remote-Agent apps
//     [--verify] [--wait-seconds 300]
//     [--dry-run]
const CONSOLE = process.env.PROCYON_URL || 'https://local.procyon.ai:8643';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

const TENANT = args.tenant || (() => { try { return JSON.parse(args.token).tenant; } catch { return null; } })();
const TOKEN = args.token;
if (!TENANT || !TOKEN) {
  console.error('usage: enable-agent-cards.mjs --token <x-auth-token-json> [--url <console-url>] [--app <name>]... [--verify] [--wait-seconds 300] [--dry-run]');
  process.exit(1);
}

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
const headers = {
  'x-auth-token': TOKEN,
  'x-procyon-session-id': crypto.randomUUID(),
  'content-type': 'application/json',
  accept: 'application/json',
};

async function api(method, path, body) {
  const res = await fetch(`${CONSOLE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
