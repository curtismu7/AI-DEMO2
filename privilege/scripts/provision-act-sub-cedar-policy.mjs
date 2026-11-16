#!/usr/bin/env node
// Create (or update) a Cedar AI policy that lets only one agent call one MCP tool, by matching the
// token's nested `act.sub` claim: context.token.claims["act.sub"].
//
// Measured 2026-11-16: the AI Policy template "Restrict a tool to tokens carrying a claim" generates exactly this
// Cedar and the controller validates it (Candidate). Not yet run against a real PingFederate token through an
// Active policy. See privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md, "Token claims in Cedar".
//
// Safe by default: dry run unless --apply, and State is Candidate (validated and stored, never enforced)
// unless you pass --state Active. A policy is a forbid ... unless, so a token without the claim, or no token,
// is refused for that tool once the policy is Active.
//
// Auth: same as bootstrap-hostile-governed.mjs. The console "For Developers" key and secret go in as
// x-api-key / x-api-secret against the LOCAL console. The local console accepts any scheme, so "it worked" does
// not prove the credentials are right.
//
// Usage:
//   node privilege/scripts/provision-act-sub-cedar-policy.mjs \
//     --tenant <uuid> --key <api-key> --secret <api-secret> \
//     --agent <act.sub value> --app <door/app name> --tool <tool name> \
//     [--name <policy name>] [--state Candidate|Active] [--url <console-url>] [--apply]

const CONSOLE = process.env.PROCYON_URL || 'https://local.procyon.ai:8643';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), a.startsWith('--apply') ? true : arr[i + 1]]);
  return acc;
}, []));

const { tenant: TENANT, key: KEY, secret: SECRET, agent: AGENT, app: APP, tool: TOOL } = args;
const STATE = args.state || 'Candidate';
const APPLY = args.apply === true;

if (!TENANT || !KEY || !SECRET || !AGENT || !APP || !TOOL) {
  console.error('usage: provision-act-sub-cedar-policy.mjs --tenant <uuid> --key <k> --secret <s> --agent <act.sub> --app <app> --tool <tool> [--name <n>] [--state Candidate|Active] [--apply]');
  process.exit(1);
}
if (!['Candidate', 'Active'].includes(STATE)) {
  console.error(`--state must be Candidate or Active, got "${STATE}"`);
  process.exit(1);
}

// These values are written between double quotes in Cedar. Refuse anything that could close the string
// or add a clause, rather than trying to escape it.
const SAFE = /^[A-Za-z0-9._:/@-]+$/;
for (const [label, value] of [['agent', AGENT], ['app', APP], ['tool', TOOL]]) {
  if (!SAFE.test(value)) {
    console.error(`--${label} "${value}" has characters outside A-Z a-z 0-9 . _ : / @ -`);
    process.exit(1);
  }
}

const NAME = args.name || `act-sub-${APP}-${TOOL}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

function buildCedar({ agent, app, tool }) {
  return [
    `@reason("${tool} requires act.sub to be ${agent}")`,
    `forbid (principal, action == Action::"mcp:Invoke", resource == Tool::"${tool}")`,
    `when   { context.app == "${app}" }`,
    `unless { context.token.claims has "act.sub"`,
    `         && context.token.claims["act.sub"].contains("${agent}") };`,
  ].join('\n');
}

const cedar = buildCedar({ agent: AGENT, app: APP, tool: TOOL });
const description = `act.sub gate: only ${AGENT} may call ${TOOL} on ${APP}. Reads context.token.claims["act.sub"]. Created by provision-act-sub-cedar-policy.mjs.`;
const body = {
  ObjectMeta: {
    Kind: 'AIPolicy',
    Tenant: TENANT,
    Namespace: 'default',
    Name: NAME,
    // ObjectMeta.ID shape: base64("<tenant>@@@default@@@<name>")
    ID: Buffer.from(`${TENANT}@@@default@@@${NAME}`).toString('base64'),
  },
  State: STATE,
  Spec: { Description: description, Cedar: cedar, AuthoringMode: 'text', TemplateID: '', TemplateParams: { Map: {} } },
};

console.log(`policy: ${NAME} | state: ${STATE} | ${APPLY ? 'APPLY' : 'dry run (no --apply)'}`);
console.log(cedar);

if (!APPLY) process.exit(0);

// The local console serves a self-signed cert. Re-exec once with TLS verification off for this process only.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}

const crypto = await import('node:crypto');
const headers = {
  'x-api-key': KEY,
  'x-api-secret': SECRET,
  'x-procyon-session-id': crypto.randomUUID(),
  'content-type': 'application/json',
  accept: 'application/json',
};

async function api(method, path, payload) {
  const res = await fetch(`${CONSOLE}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const list = await api('GET', `/api/${TENANT}/v1/aipolicys`);
const existing = (list.AIPolicys || []).find((p) => p.ObjectMeta?.Name === NAME);
const saved = existing
  ? await api('PUT', `/api/${TENANT}/v1/aipolicys/default/${NAME}`, { ...body, ObjectMeta: { ...existing.ObjectMeta } })
  : await api('POST', `/api/${TENANT}/v1/aipolicys`, body);
console.log(existing ? 'updated' : 'created', NAME);

const check = (await api('GET', `/api/${TENANT}/v1/aipolicys`)).AIPolicys.find((p) => p.ObjectMeta?.Name === NAME);
const st = check?.Status || {};
console.log(`State: ${check?.State} | Validation: ${st.Validation} | PolicyCount: ${st.PolicyCount} | Stages: ${(st.Stages?.Elems || []).join(', ')}`);
if (st.Error) console.log(`Error: ${st.Error}`);
if (st.Validation !== 'Valid') process.exit(2);
void saved;
