#!/usr/bin/env node
// Privilege tenant cleanup: rename demo/aggregate/test doors to lab-* names.
// Rename = create new (from backup template) + delete old. Dry run by default; --apply writes.
// Backups of every touched object live in /tmp/priv-cleanup/ (full-object GETs, 2026-11-23).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const T = 'ea040334-d50b-4ded-8d98-4d5cd14dbd4d';
const BASE = `https://local.procyon.ai:8643/api/${T}/v1`;
const APPLY = process.argv.includes('--apply');
const BKDIR = '/tmp/priv-cleanup';
const SOME = ['list_entitlements', 'who_has_role', 'get_access_grants', 'get_portfolio_summary',
  'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions'];
const TAGS = { env: 'demo', source: 'ai-demo2', capability: 'standing-demo-door', protection: 'governed' };
const b64 = (s) => Buffer.from(s).toString('base64');
const ref = (kind, name) => ({ RefKind: kind, RefID: b64(`${T}@@@default@@@${name}`) });
const HDR = { 'x-procyon-session-id': crypto.randomUUID(), 'accept': 'application/json', 'content-type': 'application/json' };

async function call(method, p, body) {
  const r = await fetch(`${BASE}/${p}`, { method, headers: { ...HDR, 'x-procyon-session-id': crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? (() => { try { return JSON.parse(t); } catch { return t; } })() : {} };
}
const list = async (kind) => {
  const { json } = await call('GET', `${kind}?ObjectMeta.Namespace=default`);
  const arr = Object.values(json).find(Array.isArray) || [];
  return Object.fromEntries(arr.map((o) => [o.ObjectMeta.Name, o]));
};
const strip = (o) => { for (const k of ['UUID', 'CreatedAt', 'UpdatedAt', 'RevisionID']) delete o.ObjectMeta[k]; return o; };
const retag = (o, extra) => { o.ObjectMeta.CTags = { Map: { ...TAGS, ...extra } }; return o; };
const renameIn = (o, old, neu) => JSON.parse(JSON.stringify(o).replaceAll(`${old}.default.applications.procyon.ai`, `${neu}.default.applications.procyon.ai`));

// [oldApp, newApp, toolFilter(null=blocked), description]
const APPS = [
  ['demo-all-tools', 'lab-banking-full', ['.*'], 'Standing lab door: every tool is permitted.'],
  ['demo-some-tools', 'lab-banking-limited', SOME, 'Standing lab door: only 7 read-only, non-sensitive tools are permitted; open_ticket and every sensitive_* tool are refused.'],
  ['demo-blocked', 'lab-banking-blocked', null, 'Standing lab door: NO policy grants access, so Privilege refuses every caller (no policy = deny all).'],
  ['aggregate', 'lab-agg-full', ['.*'], 'Aggregate lab door: banking-mcp + opensearch, every tool permitted.'],
  ['aggregate-limited', 'lab-agg-limited', SOME, 'Aggregate lab door: banking-mcp + opensearch, limited tool set.'],
  ['aggregate-none', 'lab-agg-blocked', null, 'Aggregate lab door: no policy, deny all.'],
  ['obo-idjag-test', 'lab-obo-full', ['.*'], 'OBO / ID-JAG test door, all tools.'],
  ['pftoken', 'lab-pftoken-full', ['.*'], 'PingFederate token-exchange test door, all tools.'],
  ['pftoken-rs', 'lab-pftoken-limited', SOME, 'PingFederate token-exchange resource door, limited tools.'],
];
// [oldKey, newKey, boundApp-or-null, tools]
const KEYS = [
  ['pgc-all-tools', 'lab-banking-full-key', 'lab-banking-full', ['.*']],
  ['pgc-some-tools', 'lab-banking-limited-key', 'lab-banking-limited', SOME],
  ['pgc-blocked', 'lab-banking-blocked-key', null, null],
  ['lab-agent', 'lab-agg-key', 'lab-agg-full', ['.*']],
  ['agg-delegate', 'lab-agg-delegate-key', 'lab-agg-limited', SOME],
  ['agg-guest', 'lab-agg-guest-key', 'lab-agg-limited', SOME],
  ['pftoken-agent', 'lab-pftoken-key', 'lab-pftoken-full', ['.*']],
];

const apps = await list('applications');
const pols = await list('pacpolicys');
const keys = await list('agentaccesskeys');
const users = await list('users');
const uname = {};
for (const [n, u] of Object.entries(users)) uname[u.Spec.UserName] = n;
const AIDEMO = uname['aidemo'];
if (!AIDEMO) { console.error('FATAL: aidemo user missing'); process.exit(1); }
const now = new Date(Date.now() - 120000).toISOString().replace(/\.\d+Z$/, '.000Z');
const NOT_AFTER = '2027-02-20T00:00:00.000Z';
const status0 = { Status: '', AppRoles: { ObjectRef: [] }, Error: '', ApprovalReq: { RefKind: '', RefID: '' } };

const plan = [];
for (const [oldN, newN, tools, desc] of APPS) {
  if (apps[oldN] && !apps[newN]) {
    const a = retag(strip(renameIn(JSON.parse(fs.readFileSync(path.join(BKDIR, `app-${oldN}.json`), 'utf8')), oldN, newN)), { purpose: newN });
    a.ObjectMeta.Name = newN;
    a.ObjectMeta.ID = b64(`${T}@@@default@@@${newN}`);
    a.Spec.Description = desc;
    plan.push(['applications', newN, a, oldN]);
  } else if (!apps[newN]) console.log(`SKIP app ${oldN}: gone`);
  const pname = `${newN}-permit`;
  if (tools !== null && !pols[pname]) {
    const src = pols[`${oldN}-permit`] || pols['MainAgentA2aMcpTools'];
    if (!src) { console.error(`FATAL: no policy template for ${pname}`); process.exit(1); }
    const p = retag(strip(renameIn(JSON.parse(JSON.stringify(src)), oldN || 'MainAgentA2aMcpTools', newN)), { purpose: pname });
    p.ObjectMeta.Name = pname; p.ObjectMeta.ID = b64(`${T}@@@default@@@${pname}`);
    p.IssuedTo = { ObjectRef: [ref('User', uname.demoAdmin), ref('User', uname.demouser), ref('User', AIDEMO)].filter((r) => r.RefID) };
    const rule = p.Spec.ActionMap.MCP.PolicyRule[0];
    rule.ObjectRef = ref('Application', newN);
    rule.Capabilities.Map.tools = { Elems: tools };
    p.Spec.ActionMap.MCP.PolicyRule = [rule];
    p.Spec.Description = `${desc} Issued to demoAdmin, demouser, aidemo.`;
    p.NotBefore = now; p.NotAfter = NOT_AFTER; p.Status = status0;
    plan.push(['pacpolicys', pname, p, null]);
  }
}
for (const [oldN, newN, app, tools] of KEYS) {
  if (keys[oldN] && !keys[newN]) {
    const raw = JSON.parse(fs.readFileSync(path.join(BKDIR, `key-${oldN}.json`), 'utf8'));
    if (raw.Spec.Provider || (raw.Spec.Scopes?.Elems || []).includes('llm')) {
      // LLM-shaped key cloned into an MCP role: rebuild from a known-good MCP key template
      const mcpTpl = JSON.parse(fs.readFileSync(path.join(BKDIR, 'key-pgc-all-tools.json'), 'utf8'));
      mcpTpl.ObjectMeta.CTags = raw.ObjectMeta.CTags;
      fs.writeFileSync(path.join(BKDIR, `key-${oldN}.json`), JSON.stringify({ ...mcpTpl, ObjectMeta: { ...mcpTpl.ObjectMeta, Name: oldN, ID: raw.ObjectMeta.ID, CTags: { ...raw.ObjectMeta.CTags } } }));
      console.log(`NOTE key ${oldN} was LLM-shaped (${raw.Spec.Provider || 'llm'}); rebuilt from MCP template`);
    }
    const k = retag(strip(JSON.parse(fs.readFileSync(path.join(BKDIR, `key-${oldN}.json`), 'utf8'))), { purpose: newN });
    k.ObjectMeta.Name = newN; k.ObjectMeta.ID = b64(`${T}@@@default@@@${newN}`);
    k.Spec.VirtualKey = ''; k.Spec.Revoked = false;
    k.Spec.NotAfter = NOT_AFTER;
    plan.push(['agentaccesskeys', newN, k, oldN]);
  }
  const gname = `${newN}-grant`;
  if (app && !pols[gname]) {
    const src = pols[`${oldN}-grant`] || pols.MainAgentA2aMcpTools;
    if (!src) { console.error(`FATAL: no grant template for ${gname}`); process.exit(1); }
    const g = retag(strip(JSON.parse(JSON.stringify(src))), { purpose: gname });
    g.ObjectMeta.Name = gname; g.ObjectMeta.ID = b64(`${T}@@@default@@@${gname}`);
    g.IssuedTo = { ObjectRef: [ref('User', AIDEMO)] };
    const rule = g.Spec.ActionMap.MCP.PolicyRule[0];
    rule.ObjectRef = ref('Application', app);
    rule.Attributes = { Map: { agentaccesskey: b64(`${T}@@@default@@@${newN}`) } };
    rule.Capabilities.Map.tools = { Elems: tools };
    g.Spec.ActionMap.MCP.PolicyRule = [rule];
    g.Spec.Description = `Key-bound grant for the agent key ${newN}: ${app}.`;
    g.NotBefore = now; g.NotAfter = NOT_AFTER; g.Status = status0;
    plan.push(['pacpolicys', gname, g, null]);
  }
}

for (const [kind, name] of plan) console.log(`  would create ${kind}/${name}`);
if (!plan.length) console.log('  nothing to create');
if (!APPLY) { console.log('(dry run)'); process.exit(0); }

const created = {};
for (const [kind, name, body] of plan) {
  const { status, json } = await call('POST', kind, body);
  console.log(`POST ${kind}/${name}: ${status}`, status >= 300 ? String(json).slice(0, 300) : '');
  if (status >= 300) process.exit(1);
  if (kind === 'agentaccesskeys') created[name] = true;
  await new Promise((r) => setTimeout(r, 2500));
}

// capture new virtual key values (never printed) and write lab .env
const fresh = await list('agentaccesskeys');
const vals = {};
for (const [, newN] of KEYS) vals[newN] = fresh[newN]?.Spec?.VirtualKey || '';
console.log('key values present:', Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Boolean(v)])));

const ENVNAME = {
  'lab-banking-full-key': 'PGC_GW_KEY_DEMO_ALL_TOOLS',
  'lab-banking-limited-key': 'PGC_GW_KEY_DEMO_SOME_TOOLS',
  'lab-banking-blocked-key': 'PGC_GW_KEY_DEMO_BLOCKED',
};
const LAB_ENV = path.join(process.env.HOME, 'Development/AI-DEMO-Standalone/standalone/privilege-gateway-client-LAB/.env');
if (fs.existsSync(LAB_ENV)) {
  const bk = `${BKDIR}/gateway-client-LAB.env.${Date.now()}.bak`;
  fs.copyFileSync(LAB_ENV, bk);
  const m = Object.fromEntries(Object.entries(ENVNAME).map(([k, e]) => [e, vals[k]]));
  let out = fs.readFileSync(LAB_ENV, 'utf8').split('\n');
  const done = new Set();
  out = out.map((l) => {
    const hit = Object.keys(m).find((e) => l.startsWith(e + '='));
    if (hit && !done.has(hit)) { done.add(hit); return `${hit}=${m[hit]}`; }
    return l;
  });
  fs.writeFileSync(LAB_ENV, out.join('\n'));
  console.log('lab .env updated; backup', bk, 'lines replaced:', [...done]);
}
console.log('done');
