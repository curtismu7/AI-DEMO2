// READ-ONLY audit of vault-managed keys.
//
// Why: k8s/create-secrets.sh treats the vault as authoritative and refuses to
// deploy when a service .env disagrees. On 2026-08-29 that premise was found
// false for three keys in a row — the vault held a WORKER app with no grants,
// a secret that did not match its own id, and a RESOURCE id in a *_CLIENT_ID
// key. Following the guard mechanically would have pointed introspection at a
// client that does not exist.
//
// This prints an inventory so the vault can be checked against PingOne in one
// pass instead of discovered one failed deploy at a time.
//
// Prints: key, value SHAPE (uuid / secret-like / other), and every service .env
// that holds a DIFFERENT non-empty value. Secrets are never printed — only a
// short fingerprint, which is enough to say "same" or "different".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Resolved from this file's own location (scripts/ lives at the repo root), so
// the audit runs on any clone. A hardcoded path fails the fresh-clone contract
// in NEW-MACHINE.md.
const ROOT = path.resolve(__dirname, '..');
const BFF = path.join(ROOT, 'demo_api_server');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let vaultPw = null;
for (const line of fs.readFileSync(path.join(BFF, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^VAULT_PASSWORD=(.*)$/);
  if (m) vaultPw = m[1].replace(/^["']|["']$/g, '');
}
if (!vaultPw) { console.error('no VAULT_PASSWORD in demo_api_server/.env'); process.exit(1); }
const env = { ...process.env, VAULT_PASSWORD: vaultPw };

const run = (args) => execFileSync('npm', ['run', '-s', ...args], { cwd: BFF, env, encoding: 'utf8' });
const fp = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

const keys = run(['vault:list'])
  .split('\n').map((s) => s.trim())
  .filter((s) => s && !s.startsWith('⚠') && !/\s/.test(s));

// Every service .env that create-secrets.sh feeds from.
const envFiles = [
  'demo_api_server/.env', 'langchain_agent/.env', 'demo_mcp_gateway/.env',
  'oauth-mcp/.env', 'demo_hitl_service/.env', 'demo_authz_server/.env',
  'demo_mcp_resource_server/.env', 'demo_agent_service/.env',
].filter((f) => fs.existsSync(path.join(ROOT, f)));

const envMaps = {};
for (const f of envFiles) {
  const map = {};
  for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2].trim();
  }
  envMaps[f] = map;
}

console.log(`vault keys: ${keys.length} | env files scanned: ${envFiles.length}\n`);

const uuids = new Set();
const rows = [];
for (const k of keys) {
  let v = '';
  try { v = run(['vault:get', '--', k]).trim(); } catch { v = '(get failed)'; }
  const shape = UUID.test(v) ? 'uuid' : (v === '' ? 'EMPTY' : (v.length > 30 ? 'secret-like' : 'other'));
  if (UUID.test(v)) uuids.add(v);

  const drift = [];
  for (const f of envFiles) {
    const local = envMaps[f][k];
    if (local === undefined || local === '') continue;
    if (local.startsWith('encrypted:')) { drift.push(`${f}(encrypted)`); continue; }
    if (local !== v) drift.push(`${f}=${UUID.test(local) ? local : fp(local)}`);
  }
  rows.push({ k, shape, shown: UUID.test(v) ? v : (v ? fp(v) : ''), drift });
}

const drifted = rows.filter((r) => r.drift.length);
console.log(`=== ${drifted.length} key(s) where a service .env DIFFERS from the vault ===`);
for (const r of drifted) console.log(`  ${r.k}  vault=${r.shown || '(empty)'}  ${r.drift.join('  ')}`);

console.log(`\n=== ${uuids.size} distinct UUID value(s) to check against PingOne ===`);
for (const u of uuids) {
  console.log('  ' + u + '  <- ' + rows.filter((r) => r.shown === u).map((r) => r.k).join(', '));
}

const empties = rows.filter((r) => r.shape === 'EMPTY');
if (empties.length) console.log(`\n=== ${empties.length} vault key(s) EMPTY ===\n  ` + empties.map((r) => r.k).join('\n  '));
