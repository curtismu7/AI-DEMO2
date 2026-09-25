#!/usr/bin/env node
'use strict';
/**
 * vault-hydrate — fill EMPTY vault-managed keys in service .env files from the
 * vault, so the local Docker Compose stack (which reads .env directly, unlike
 * the SE cluster where create-secrets.sh rehydrates) boots without manual
 * secret re-entry. Never overwrites a non-empty value and never writes
 * VAULT_PASSWORD itself (that is the bootstrap credential).
 *
 * Usage: node scripts/vault-hydrate.js [--check]
 *   --check  report what WOULD be filled; write nothing
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VAULT_JS = path.join(__dirname, 'vault.js');
const ENV_DIRS = [
  'demo_api_server', 'demo_mcp_gateway', 'demo_mcp_resource_server',
  'demo_authz_server', 'demo_hitl_service', 'demo_agent_service',
  'langchain_agent', 'oauth-mcp', 'ping-gateway', 'demo_api_resource_server',
  'demo_mcp_jwt_verifier', 'librechat',
];
const SKIP = new Set(['VAULT_PASSWORD', 'DOTENV_PUBLIC_KEY', 'DOTENV_PRIVATE_KEY']);

function loadVaultPassword() {
  if (process.env.VAULT_PASSWORD) return;
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^VAULT_PASSWORD=(.+)$/m);
    if (m) process.env.VAULT_PASSWORD = m[1].trim().replace(/^"|"$/g, '');
  }
}

function vaultCli(subcommand, name) {
  const args = [VAULT_JS_PATH, subcommand];
  if (name) args.push(name);
  return require('node:child_process').execFileSync(
    process.execPath, args,
    { env: { ...process.env }, encoding: 'utf8' },
  );
}

const VAULT_JS_PATH = path.join(__dirname, 'vault.js');

function main() {
  const checkOnly = process.argv.includes('--check');
  loadVaultPassword();
  if (!process.env.VAULT_PASSWORD) {
    console.error('[vault-hydrate] VAULT_PASSWORD required (env or demo_api_server/.env)');
    process.exit(1);
  }
  const keys = vaultCli('list').split('\n').map((s) => s.trim()).filter(Boolean);
  let filled = 0;
  for (const dir of ENV_DIRS) {
    const file = path.join(ROOT, '..', dir, '.env');
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const key of keys) {
      if (SKIP.has(key)) continue;
      if (!new RegExp(`^${key}=$`, 'm').test(text)) continue;
      if (checkOnly) { console.log(`[vault-hydrate] would fill ${dir}/.env ${key}`); filled += 1; continue; }
      let value;
      try { value = vaultCli('get', key).replace(/\n$/, ''); } catch { continue; }
      if (!value) continue;
      text = text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
      filled += 1; changed = true;
    }
    if (changed) fs.writeFileSync(file, text);
  }
  console.log(`[vault-hydrate] ${checkOnly ? 'would fill' : 'filled'} ${filled} empty key(s)${checkOnly ? '' : ' from vault'}`);
}

main();
