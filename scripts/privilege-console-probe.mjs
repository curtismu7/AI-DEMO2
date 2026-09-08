#!/usr/bin/env node
// Privilege console API probe — read what the control plane actually thinks
// about an Agentic App, instead of reading the console's Tools panel.
//
// Why this exists: when an app discovers no tools, the console is the worst
// place to find out why. Its Tools panel is rendered by a separate call
// (/v1/github-account) that returns 401 independently of discovery, so a
// healthy app and a broken one look identical. And when the console session
// expires it renders "Gateway Unreachable — Showing Cached Data" and replays
// stale values, which reads exactly like a live failure.
//
// Auth, established by live probes on 2026-08-31 (privilege/LESSONS-LEARNED.md):
//   GET /session-token   no cookie at all -> 200 {"session_id":"<uuid>"}
//   GET /v1/pacpolicys   junk auth_token  -> 401 "User is not authorized"
// So `x-procyon-session-id` is a mintable correlation id, NOT a credential —
// this script mints its own. The only real credential is the `auth_token`
// cookie from an operator's console browser session (~60 min lifetime).
// There is no API-key or service-account path. Read it from devtools:
// Network -> any XHR to console.privilege.pingone.com -> Request Headers.
//
// Usage:
//   export PRIVILEGE_CONSOLE_TOKEN='eyJ...'        # the auth_token cookie value
//   node scripts/privilege-console-probe.mjs                    # inventory every app
//   node scripts/privilege-console-probe.mjs openapi2           # full record for one app
//   node scripts/privilege-console-probe.mjs openapi2 mcp-grafana  # diff broken vs working
//   node scripts/privilege-console-probe.mjs --policies         # raw pacpolicys
//
// The token is taken from the environment only, never argv — argv is visible
// in `ps` to every user on the box. It is never printed, logged or echoed.

const CONSOLE_BASE = 'https://console.privilege.pingone.com';

// The AI Gateway's own tenant, from its enrollment JWT (`tenantName`). This is
// Privilege's PingOne environment, NOT AI-Demo's 01d89b06 — conflating the two
// has cost sessions before.
const DEFAULT_TENANT = '0428ba4f-169c-436b-aff9-b230496e0e3b';

// --- pure helpers, unit-tested in privilege-console-probe.test.mjs ---------

/** Flatten an object to `a.b[0].c` -> leaf-value pairs, for diffing. */
export function flatten(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

/** Compare two flattened records. Returns rows of {path, a, b} that differ. */
export function diffRecords(a, b) {
  const fa = flatten(a);
  const fb = flatten(b);
  const paths = [...new Set([...fa.keys(), ...fb.keys()])].sort();
  return paths
    .filter((p) => JSON.stringify(fa.get(p)) !== JSON.stringify(fb.get(p)))
    .map((p) => ({ path: p, a: fa.has(p) ? fa.get(p) : '(absent)', b: fb.has(p) ? fb.get(p) : '(absent)' }));
}

// --- API ------------------------------------------------------------------

async function mintSessionId() {
  const res = await fetch(`${CONSOLE_BASE}/session-token`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`/session-token ${res.status} — the console API is unreachable from here.`);
  return (await res.json()).session_id;
}

function makeGet(token, sessionId) {
  return async function get(path) {
    const res = await fetch(`${CONSOLE_BASE}${path}`, {
      headers: {
        Cookie: `auth_token=${token}`,
        'x-procyon-session-id': sessionId,
        accept: 'application/json',
      },
    });
    const text = await res.text();
    if (res.status === 401) {
      // Never echo the request headers — they carry the console token.
      throw new Error(
        'Console API 401. The auth_token cookie is expired or wrong.\n' +
          'It lives ~60 minutes. Re-grab it: console.pingone.com/?env=<privilege-env> -> launch\n' +
          'PingOne Privilege -> devtools Network -> any XHR -> Request Headers -> Cookie: auth_token=…',
      );
    }
    if (!res.ok) throw new Error(`Console API ${res.status} on ${path}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Console API returned non-JSON from ${path}: ${text.slice(0, 200)}`);
    }
  };
}

// --- reporting ------------------------------------------------------------

function summarise(app) {
  const cfg = app.Spec?.McpAppConfig || {}; // McpAppConfig, NOT MCPAppConfig
  const status = app.Status?.McpServerStatus || {};
  const tools = status.Tools || status.McpTools || cfg.Tools || null;
  return {
    name: app.ObjectMeta?.Name || '(unnamed)',
    status: status.Status || '(none)',
    message: status.Message || status.Reason || '',
    tools: Array.isArray(tools) ? tools.length : tools == null ? '?' : String(tools),
    entryPath: cfg.EntryPath || '',
    backends: (cfg.Backends?.Elems || []).join(',') || '',
    image: app.Spec?.AppContainerConfig?.Image || cfg.Image || '',
  };
}

function printTable(rows) {
  const cols = Object.keys(rows[0]);
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))]),
  );
  const line = (vals) => cols.map((c) => String(vals[c] ?? '').padEnd(width[c])).join('  ');
  console.log(line(Object.fromEntries(cols.map((c) => [c, c.toUpperCase()]))));
  console.log(cols.map((c) => '-'.repeat(width[c])).join('  '));
  for (const r of rows) console.log(line(r));
}

// --- main -----------------------------------------------------------------

async function main() {
  const token = process.env.PRIVILEGE_CONSOLE_TOKEN;
  if (!token) {
    console.error(
      'PRIVILEGE_CONSOLE_TOKEN is not set.\n\n' +
        'It is the `auth_token` cookie from a PingOne Privilege console browser session\n' +
        '(~60 minute lifetime; there is no service-account path to this API).\n' +
        '  1. https://console.pingone.com/?env=<privilege-env-id>  -> launch PingOne Privilege\n' +
        '  2. devtools -> Network -> any XHR to console.privilege.pingone.com\n' +
        '  3. Request Headers -> Cookie -> copy the auth_token=… value\n' +
        "  4. export PRIVILEGE_CONSOLE_TOKEN='eyJ...'   (quote it; do not pass it as an argument)",
    );
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const tenantFlag = args.indexOf('--tenant');
  const tenant =
    tenantFlag >= 0 ? args.splice(tenantFlag, 2)[1] : process.env.PRIVILEGE_CONSOLE_TENANT || DEFAULT_TENANT;
  const wantPolicies = args.includes('--policies');
  const names = args.filter((a) => !a.startsWith('--'));

  const get = makeGet(token, await mintSessionId());
  console.log(`# tenant ${tenant}\n`);

  if (wantPolicies) {
    const body = await get(`/api/${tenant}/v1/pacpolicys`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const body = await get(`/api/${tenant}/v1/applications?ObjectMeta.Namespace=default`);
  const apps = body.Applications || [];
  if (!apps.length) {
    console.log('No applications returned. Wrong tenant, or the token belongs to another environment.');
    return;
  }

  const byName = new Map(apps.map((a) => [a.ObjectMeta?.Name, a]));
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) {
    console.error(`Not found: ${missing.join(', ')}\nApps in this tenant: ${[...byName.keys()].join(', ')}`);
    process.exit(1);
  }

  if (names.length === 0) {
    printTable(apps.map(summarise));
    console.log(`\n${apps.length} app(s). Pass a name for its full record, or two names to diff them.`);
    return;
  }

  if (names.length === 1) {
    console.log(JSON.stringify(byName.get(names[0]), null, 2));
    return;
  }

  const [a, b] = names;
  const rows = diffRecords(byName.get(a), byName.get(b));
  console.log(`# diff  a=${a}  b=${b}  (${rows.length} differing leaves)\n`);
  for (const r of rows) console.log(`${r.path}\n    a: ${JSON.stringify(r.a)}\n    b: ${JSON.stringify(r.b)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
