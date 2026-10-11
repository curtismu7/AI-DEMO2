#!/usr/bin/env node
// Bootstrap the GOVERNED twin of the hostile-mcp app via the Procyon/Privilege API:
//   1. clone the existing `hostile-mcp` application as `hostile-mcp-governed` (same
//      backend, mesh cluster, EntryPath — the door URL is the app name)
//   2. author a PacPolicy on it that permits every tool/prompt/resource EXCEPT
//      create_transfer / delete_all_records / grant_admin
// The policy model is permit-selection: Capabilities.Map.{tools,prompts,resources}
// .Elems list what agents may use; unselected = denied at the gateway. The
// ungoverned `hostile-mcp` carries NO policy (permit-all), so the Catalog tab can
// show the same poisoned call ALLOWED (ungoverned) and DENIED (governed) side by side.
//
// Auth: the console "For Developers" tenant API key/secret as x-api-key /
// x-api-secret headers against the LOCAL console (https://local.procyon.ai:8643).
// The x-procyon-session-id header is required but its value is unvalidated
// (correlation id) — the script mints one.
//
// Usage:
//   node privilege/scripts/bootstrap-hostile-governed.mjs \
//     --url https://local.procyon.ai:8643 --tenant <uuid> \
//     --key <api-key> --secret <api-secret> [--dry-run]
const CONSOLE = process.env.PROCYON_URL
  || 'https://local.procyon.ai:8643';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

const TENANT = args.tenant;
const KEY = args.key;
const SECRET = args.secret;
const DRY = 'dry-run' in args;
if (!TENANT || !KEY || !SECRET) {
  console.error('usage: bootstrap-hostile-governed.mjs --tenant <uuid> --key <api-key> --secret <api-secret> [--url <console-url>] [--dry-run]');
  process.exit(1);
}

const crypto = await import('node:crypto');
const SID = crypto.randomUUID();

// The local console serves a self-signed cert (curl needs -k). Node's global
// fetch does not take a dispatcher on this build — set env instead. The script
// re-execs itself once with NODE_TLS_REJECT_UNAUTHORIZED=0 when it detects the
// self-signed chain.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}

function refID(name) {
  // ObjectMeta.ID shape: base64("<tenant>@@default@@<name>")
  return Buffer.from(`${TENANT}@@default@@${name}`).toString('base64');
}

const headers = {
  'x-api-key': KEY,
  'x-api-secret': SECRET,
  'x-procyon-session-id': SID,
  'content-type': 'application/json',
  accept: 'application/json',
};

async function api(method, path, body) {
  const res = await fetch(`${CONSOLE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const DENY_TOOLS = ['create_transfer', 'delete_all_records', 'grant_admin'];

(async () => {
  // 1. read the source app
  const appsBody = await api('GET', `/api/${TENANT}/v1/applications`);
  const apps = appsBody.Applications || [];
  const source = apps.find((a) => a.ObjectMeta?.Name === 'hostile-mcp');
  if (!source) throw new Error('hostile-mcp app not found — register it first');
  console.log('source app:', source.ObjectMeta.Name,
    '| backends:', source.Spec?.McpAppConfig?.Backends?.Elems?.join(', '),
    '| entry:', source.Spec?.McpAppConfig?.EntryPath);

  // 2. clone as hostile-mcp-governed (same config; the name makes the door URL)
  const governedName = 'hostile-mcp-governed';
  // Point the twin at its OWN front-end host: FrontEndName is the public door
  // hostname (<app>.default.applications.procyon.ai:8643) — leaving the source's
  // would route the governed door name to the ungoverned front-end.
  const desiredFrontEnds = (source.Spec?.McpAppConfig?.FrontEndName?.Elems || [])
    .map((h) => h.replace(/^hostile-mcp\./, `${governedName}.`));
  const existing = apps.find((a) => a.ObjectMeta?.Name === governedName);
  if (existing && JSON.stringify(existing.Spec?.McpAppConfig?.FrontEndName?.Elems) === JSON.stringify(desiredFrontEnds)) {
    console.log(`${governedName} already exists and points at its own front-end — skipping app creation`);
  } else if (existing) {
    const fixed = JSON.parse(JSON.stringify(existing));
    fixed.Spec.McpAppConfig.FrontEndName.Elems = desiredFrontEnds;
    console.log(`${governedName} exists but FrontEndName is ${existing.Spec?.McpAppConfig?.FrontEndName?.Elems?.join(',')} — PUTting correction to [${desiredFrontEnds.join(',')}]`, DRY ? '(dry-run)' : '');
    if (!DRY) await api('PUT', `/api/${TENANT}/v1/applications/default/${governedName}`, fixed);
  } else {
    const clone = JSON.parse(JSON.stringify(source));
    clone.Spec.McpAppConfig.FrontEndName.Elems = desiredFrontEnds;
    clone.ObjectMeta = {
      ...clone.ObjectMeta,
      Name: governedName,
      ID: refID(governedName),
    };
    for (const k of ['UID', 'CreatedAt', 'UpdatedAt', 'RevisionID']) delete clone.ObjectMeta[k];
    delete clone.Status; // server re-discovers tools/prompts/resources itself
    console.log('creating app:', governedName, DRY ? '(dry-run)' : '');
    if (!DRY) await api('POST', `/api/${TENANT}/v1/applications`, clone);
  }

  // 3. governed policy: one rule on the governed app. IssuedTo names the demo
  //    user — measured 2026-10-11 on build v1.261009: no policy = DENY ALL, and
  //    an IssuedTo the actor isn't in denies too. Separator trap, measured live:
  //    a policy RULE's app ObjectRef encodes `tenant@@@default@@@<app>` (triple
  //    @ both sides) while IssuedTo user refs encode `tenant@@default@@<user>`
  //    (double @ both sides, same as ObjectMeta.ID). Wrong separator silently
  //    matches nothing: the console accepts the POST, then every call 403s with
  //    an empty "Access Denied for" reason. Capabilities select ALL tools
  //    except the deny triple.
  const tools = (source.Status?.McpServerStatus?.Capabilities?.Tools || []).map((t) => t.name);
  if (!tools.length) throw new Error('hostile-mcp has no discovered tools in Status — trigger discovery in the console first');
  const allowedTools = tools.filter((t) => !DENY_TOOLS.includes(t));
  console.log('tools:', tools.join(', '));
  console.log('allowed tools:', allowedTools.join(', '));

  const appRef = (name) => Buffer.from(`${TENANT}@@@default@@@${name}`).toString('base64');
  const userRef = (uid) => Buffer.from(`${TENANT}@@default@@${uid}`).toString('base64');
  const rule = {
    ObjectRef: { RefKind: 'Application', RefID: appRef(governedName) },
    Principal: '',
    GcpRoleTarget: null,
    Services: { ObjectRef: [] },
    ProcyonCreated: false,
    RoleAssignments: [],
    ADRoleAssignments: [],
    Permissions: [],
    Attributes: { Map: {} },
    Capabilities: {
      Map: {
        tools: { Elems: allowedTools },
        prompts: { Elems: ['account_review'] },
        resources: { Elems: ['mcp://hostile/account-verification'] },
      },
    },
    RequiredClaims: { Map: {} },
  };
  const governedPolicy = {
    ObjectMeta: {
      Kind: 'PacPolicy',
      Tenant: TENANT,
      Namespace: 'default',
      Name: 'hostile-mcp-governed-allow-except',
    },
    GivenName: 'hostile-mcp-governed — allow except transfers/admin',
    IssuedTo: { ObjectRef: [{ RefKind: 'User', RefID: userRef(args['demo-user-id'] || '5d85b8bf-3f4d-471b-a4b3-cbb5d9385a1c') }] },
    Spec: {
      Description: 'Permit-selection for the governed hostile twin: every tool except create_transfer / delete_all_records / grant_admin; the account_review prompt and account-verification resource stay selectable for the demo.',
      ActionMap: { MCP: { PolicyRule: [rule] } },
    },
  };

  // 4. the UNGOVERNED twin's policy: on build v1.261009 an app with NO policy
  //    denies everything, so "ungoverned" = an explicit allow-all policy. Same
  //    rule shape, all tools.
  const allowAllRule = JSON.parse(JSON.stringify(rule));
  allowAllRule.ObjectRef.RefID = appRef('hostile-mcp');
  allowAllRule.Capabilities.Map.tools.Elems = [...tools];
  const allowAllPolicy = {
    ObjectMeta: {
      Kind: 'PacPolicy',
      Tenant: TENANT,
      Namespace: 'default',
      Name: 'hostile-mcp-allow-all',
    },
    GivenName: 'hostile-mcp — allow all (ungoverned twin)',
    IssuedTo: governedPolicy.IssuedTo,
    Spec: {
      Description: 'Ungoverned twin: every operation permitted — the poison rides through unfiltered.',
      ActionMap: { MCP: { PolicyRule: [allowAllRule] } },
    },
  };

  console.log('governed policy:', JSON.stringify({
    name: governedPolicy.ObjectMeta.Name,
    app: governedName,
    tools: allowedTools.length,
    prompts: ['account_review'],
    resources: ['mcp://hostile/account-verification'],
  }));
  console.log('ungoverned policy:', JSON.stringify({
    name: allowAllPolicy.ObjectMeta.Name,
    app: 'hostile-mcp',
    tools: tools.length,
  }));
  if (!DRY) {
    // Policies cloned without the console's own owner metadata get reaped
    // within minutes (measured 2026-10-11). Fetch an existing console-made
    // policy and copy its Creator/owners onto ours before posting.
    const existing = await api('GET', `/api/${TENANT}/v1/pacpolicys`);
    const template = (existing.PacPolicys || []).find((p) => p.ObjectMeta?.WrOwners?.ObjectRef?.length);
    for (const p of [governedPolicy, allowAllPolicy]) {
      if (template) {
        p.ObjectMeta.WrOwners = template.ObjectMeta.WrOwners;
        p.ObjectMeta.RdOwners = template.ObjectMeta.RdOwners;
        p.Creator = template.Creator;
      }
      await api('POST', `/api/${TENANT}/v1/pacpolicys`, p);
    }
  }

  console.log(DRY ? 'dry-run complete — nothing written'
    : 'done: app + both policies created. Gateways take up to ~4 min to enforce; then run the Catalog matrix (ungoverned: all ALLOWED, governed: the three dangerous calls DENIED).');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
