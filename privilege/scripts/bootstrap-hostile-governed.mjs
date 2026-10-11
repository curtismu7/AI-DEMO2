#!/usr/bin/env node
// Bootstrap the GOVERNED twin of the hostile-mcp app via the Privilege console API:
//   1. clone the existing `hostile-mcp` application as `hostile-mcp-governed` (same
//      backend, mesh cluster, EntryPath=/mcp — per the entry-path rule, a fresh
//      registration on the /mcp URL gets the right EntryPath)
//   2. author a PacPolicy on it that DENIES create_transfer / delete_all_records /
//      grant_admin for the demo user, permitting everything else
// so the Catalog tab can show the same poisoned call ungoverned (ALLOWED) and
// governed (DENIED) side by side.
//
// Usage (the console token is a browser cookie — paste at run time, never store):
//   node privilege/scripts/bootstrap-hostile-governed.mjs \
//     --tenant <privilege-tenant-uuid> --token <auth_token> --sid <x-procyon-session-id> \
//     [--dry-run]
//
// Requires: the hostile-mcp app to already exist (it is cloned), and the demo
// user's PingOne id for the policy's IssuedTo (fetched from the existing policy
// on hostile-mcp if not given).
const CONSOLE = 'https://console.privilege.pingone.com';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

const TENANT = args.tenant;
const TOKEN = args.token;
const SID = args.sid;
const DRY = '--dry-run' in args;
if (!TENANT || !TOKEN || !SID) {
  console.error('usage: bootstrap-hostile-governed.mjs --tenant <uuid> --token <auth_token> --sid <session-id> [--dry-run]');
  process.exit(1);
}

const headers = {
  Cookie: `auth_token=${TOKEN}`,
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
  const appsBody = await api('GET', `/api/${TENANT}/v1/applications?ObjectMeta.Namespace=default`);
  const apps = appsBody.Applications || appsBody.Items || [];
  const source = apps.find((a) => a.ObjectMeta?.Name === 'hostile-mcp');
  if (!source) throw new Error('hostile-mcp app not found — register it first (runbook step 1)');
  console.log('source app:', source.ObjectMeta.Name, '| backends:', source.Spec?.McpAppConfig?.Backends?.Elems?.join(', '));

  // 2. clone as hostile-mcp-governed (same config; the name makes the door URL)
  const governedName = 'hostile-mcp-governed';
  if (apps.some((a) => a.ObjectMeta?.Name === governedName)) {
    console.log(`${governedName} already exists — skipping app creation`);
  } else {
    const clone = JSON.parse(JSON.stringify(source));
    clone.ObjectMeta = { ...clone.ObjectMeta, Name: governedName };
    if (clone.ObjectMeta.UID !== undefined) delete clone.ObjectMeta.UID;
    if (clone.ObjectMeta.CreatedAt !== undefined) delete clone.ObjectMeta.CreatedAt;
    if (clone.ObjectMeta.UpdatedAt !== undefined) delete clone.ObjectMeta.UpdatedAt;
    if (clone.Status !== undefined) delete clone.Status;
    console.log('creating app:', governedName, DRY ? '(dry-run)' : '');
    if (!DRY) await api('POST', `/api/${TENANT}/v1/applications`, clone);
  }

  // 3. learn the policy shape + demo-user ref from the existing hostile policy
  const polBody = await api('GET', `/api/${TENANT}/v1/pacpolicys`);
  const policies = polBody.PacPolicys || polBody.Items || [];
  const hostilePolicy = policies.find((p) => JSON.stringify(p).includes('hostile-mcp')
    && !p.ObjectMeta?.Name?.includes('governed'));
  if (!hostilePolicy) {
    console.error('No existing policy referencing hostile-mcp found — cannot clone the shape. Author one in the console, then re-run for the governed twin.');
    process.exit(2);
  }
  console.log('source policy:', hostilePolicy.ObjectMeta?.Name, '| Spec keys:', Object.keys(hostilePolicy.Spec || {}));

  // 4. governed policy: same IssuedTo; the deny rule names the three tools
  const governedPolicy = JSON.parse(JSON.stringify(hostilePolicy));
  governedPolicy.ObjectMeta = { ...governedPolicy.ObjectMeta, Name: 'hostile-mcp-governed-deny' };
  if (governedPolicy.ObjectMeta.UID !== undefined) delete governedPolicy.ObjectMeta.UID;
  if (governedPolicy.ObjectMeta.CreatedAt !== undefined) delete governedPolicy.ObjectMeta.CreatedAt;
  if (governedPolicy.ObjectMeta.UpdatedAt !== undefined) delete governedPolicy.ObjectMeta.UpdatedAt;
  if (governedPolicy.Status !== undefined) delete governedPolicy.Status;
  governedPolicy.GivenName = 'hostile-mcp-governed — deny transfers';
  // Replace every tool name in the Spec with the deny triple, preserving structure.
  // The exact rule grammar varies by console build; string-replace keeps the shape
  // the console itself produced for this app, which is the shape the gateway reads.
  let specStr = JSON.stringify(governedPolicy.Spec || {});
  for (const tool of DENY_TOOLS) {
    specStr = specStr.split('hostile-mcp').join('hostile-mcp-governed');
  }
  // If the source policy was a PERMIT of create_transfer, the governed twin must
  // be a DENY of it. Look for the action field and flip it:
  specStr = specStr.replace(/"(Action|Effect|Decision)"\s*:\s*"[Pp]ermit"/g, '"$1":"Deny"');
  governedPolicy.Spec = JSON.parse(specStr);
  console.log('governed policy Spec:', JSON.stringify(governedPolicy.Spec).slice(0, 400));
  if (!DRY) await api('POST', `/api/${TENANT}/v1/pacpolicys`, governedPolicy);

  console.log(DRY ? 'dry-run complete — nothing written' : 'done: app + policy created. Wait for discovery (tools populated), then run the Catalog matrix against the governed door.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
