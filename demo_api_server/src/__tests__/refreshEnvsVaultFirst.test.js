'use strict';
/**
 * refresh-service-envs writes the gateways' INTENT_TOKEN_SECRET, and the BFF
 * now takes that key from the vault (vaultLoader ENV_EXPORT_ALLOWLIST). If this
 * script kept copying a stale .env value into the gateway env files, the signer
 * and the two verifiers would hold different keys — valid signatures nothing can
 * match, silent, which is the 2026-08-25 SE introspection outage.
 *
 * So: the vault must win here too, and must degrade cleanly when there is no
 * vault (fresh clone) or no password.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadVaultSecrets } = require('../../scripts/refresh-service-envs');
const { createVault } = require('../../lib/vault');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-envs-vault-'));
  fs.mkdirSync(path.join(root, 'demo_api_server', 'lib'), { recursive: true });
  // The helper requires the vault lib from <root>/demo_api_server/lib/vault.
  fs.symlinkSync(path.join(__dirname, '..', '..', 'lib', 'vault'),
                 path.join(root, 'demo_api_server', 'lib', 'vault'), 'dir');
  return root;
}

test('no vault file — returns nothing so the caller falls back to .env', async () => {
  const root = tmpRoot();
  await expect(loadVaultSecrets(['INTENT_TOKEN_SECRET'], root)).resolves.toEqual({});
});

test('vault present but no password — falls back rather than throwing', async () => {
  const root = tmpRoot();
  await createVault(path.join(root, 'secrets.vault'), 'pw-not-supplied-to-the-helper');
  const prev = process.env.VAULT_PASSWORD;
  delete process.env.VAULT_PASSWORD;
  try {
    await expect(loadVaultSecrets(['INTENT_TOKEN_SECRET'], root)).resolves.toEqual({});
  } finally {
    if (prev !== undefined) process.env.VAULT_PASSWORD = prev;
  }
});

// The property that matters: a vault entry is returned, so the caller writes
// THAT into the gateway env files rather than whatever .env happened to hold.
test('vault entry is returned so it can beat the .env copy', async () => {
  const root = tmpRoot();
  const handle = await createVault(path.join(root, 'secrets.vault'), 'correct-horse');
  await handle.set('INTENT_TOKEN_SECRET', 'THE-VAULT-VALUE');
  await handle.save();
  if (typeof handle.close === 'function') await handle.close();

  const prev = process.env.VAULT_PASSWORD;
  process.env.VAULT_PASSWORD = 'correct-horse';
  try {
    const got = await loadVaultSecrets(['INTENT_TOKEN_SECRET'], root);
    expect(got).toEqual({ INTENT_TOKEN_SECRET: 'THE-VAULT-VALUE' });
  } finally {
    if (prev === undefined) delete process.env.VAULT_PASSWORD;
    else process.env.VAULT_PASSWORD = prev;
  }
});

test('a wrong password degrades to fallback instead of crashing the refresh', async () => {
  const root = tmpRoot();
  const handle = await createVault(path.join(root, 'secrets.vault'), 'correct-horse');
  await handle.set('INTENT_TOKEN_SECRET', 'THE-VAULT-VALUE');
  await handle.save();
  if (typeof handle.close === 'function') await handle.close();

  const prev = process.env.VAULT_PASSWORD;
  process.env.VAULT_PASSWORD = 'wrong';
  try {
    await expect(loadVaultSecrets(['INTENT_TOKEN_SECRET'], root)).resolves.toEqual({});
  } finally {
    if (prev === undefined) delete process.env.VAULT_PASSWORD;
    else process.env.VAULT_PASSWORD = prev;
  }
});
