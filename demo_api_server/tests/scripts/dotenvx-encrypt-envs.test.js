'use strict';

/**
 * vault → dotenvx cutover (Task 7): the encrypt step must (a) target only the
 * true secret names, (b) leave non-secrets plaintext, and (c) encrypt every
 * service .env under ONE shared keypair so a single DOTENV_PRIVATE_KEY decrypts
 * them all. These tests exercise the pure orchestration with an INJECTED fake
 * dotenvx runner and temp files — real dotenvx is never invoked and no real
 * secret is touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SECRET_NAMES,
  encryptArgs,
  encryptAll,
  readPublicKey,
} = require('../../scripts/dotenvx-encrypt-envs');

function tmpFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-'));
  const file = path.join(dir, name);
  if (contents != null) fs.writeFileSync(file, contents);
  return file;
}

describe('SECRET_NAMES', () => {
  test('includes vault allowlist secrets and the four service-key names, deduped', () => {
    // From vault-migrate's allowlist:
    expect(SECRET_NAMES).toContain('HELIX_API_KEY');
    expect(SECRET_NAMES).toContain('BFF_INTERNAL_SECRET');
    expect(SECRET_NAMES).toContain('SESSION_SECRET');
    // The four service keys (two legacy aliases included):
    expect(SECRET_NAMES).toContain('DEMO_API_RESOURCE_SERVER_KEY');
    expect(SECRET_NAMES).toContain('DEMO_MCP_RESOURCE_SERVER_KEY');
    expect(SECRET_NAMES).toContain('DEMO_INVEST_SERVICE_KEY');
    expect(SECRET_NAMES).toContain('DEMO_MORTGAGE_SERVICE_KEY');
    // Deduped — DEMO_API_RESOURCE_SERVER_KEY is in both sources but appears once.
    const count = SECRET_NAMES.filter((n) => n === 'DEMO_API_RESOURCE_SERVER_KEY').length;
    expect(count).toBe(1);
    // Never encrypt non-secret config.
    expect(SECRET_NAMES).not.toContain('NODE_ENV');
    expect(SECRET_NAMES).not.toContain('PINGONE_ENVIRONMENT_ID');
  });
});

describe('encryptArgs', () => {
  test('selective -k per secret, with -f target and -fk shared keys file', () => {
    const args = encryptArgs('/tmp/x/.env', ['HELIX_API_KEY', 'BFF_INTERNAL_SECRET'], '/tmp/.env.keys');
    expect(args.slice(0, 5)).toEqual(['encrypt', '-f', '/tmp/x/.env', '-fk', '/tmp/.env.keys']);
    expect(args).toEqual(expect.arrayContaining(['-k', 'HELIX_API_KEY', '-k', 'BFF_INTERNAL_SECRET']));
  });
});

describe('encryptAll', () => {
  // Fake dotenvx: on `encrypt -f <file>`, if the file has no DOTENV_PUBLIC_KEY it
  // "generates" one (as real dotenvx does on first encrypt of an unkeyed file).
  function makeFakeDotenvx(generatedPub) {
    const calls = [];
    const run = (args) => {
      calls.push(args);
      const fi = args.indexOf('-f');
      const file = args[fi + 1];
      const cur = fs.readFileSync(file, 'utf8');
      if (!/^DOTENV_PUBLIC_KEY=/m.test(cur)) {
        fs.writeFileSync(file, `DOTENV_PUBLIC_KEY=${generatedPub}\n${cur}`);
      }
    };
    return { run, calls };
  }

  test('fresh: generates one keypair, then shares it across all files', () => {
    const a = tmpFile('.env', 'HELIX_API_KEY=secretA\nNODE_ENV=development\n');
    const b = tmpFile('.env', 'BFF_INTERNAL_SECRET=secretB\n');
    const { run, calls } = makeFakeDotenvx('pub-GENERATED-1');

    const res = encryptAll({ files: [a, b], runDotenvx: run });

    expect(calls).toHaveLength(2);                       // one encrypt per present file
    expect(res.sharedPublicKey).toBe('pub-GENERATED-1');
    expect(readPublicKey(a)).toBe('pub-GENERATED-1');
    expect(readPublicKey(b)).toBe('pub-GENERATED-1');    // b was seeded, not re-generated
  });

  test('skips absent target files', () => {
    const a = tmpFile('.env', 'HELIX_API_KEY=secretA\n');
    const missing = path.join(os.tmpdir(), 'does-not-exist-xyz', '.env');
    const { run, calls } = makeFakeDotenvx('pub-GENERATED-2');

    const res = encryptAll({ files: [a, missing], runDotenvx: run });

    expect(calls).toHaveLength(1);
    expect(res.encrypted).toEqual([a]);
  });

  test('rerun / existing key: reuses it, never regenerates (no rotation)', () => {
    const a = tmpFile('.env', 'DOTENV_PUBLIC_KEY=pub-EXISTING\nHELIX_API_KEY=encrypted:...\n');
    const b = tmpFile('.env', 'BFF_INTERNAL_SECRET=secretB\n'); // not yet keyed
    // Fake would "generate" pub-NEW, but it must never be reached because a
    // shared key already exists.
    const { run } = makeFakeDotenvx('pub-NEW-MUST-NOT-APPEAR');

    const res = encryptAll({ files: [a, b], runDotenvx: run });

    expect(res.sharedPublicKey).toBe('pub-EXISTING');
    expect(readPublicKey(a)).toBe('pub-EXISTING');
    expect(readPublicKey(b)).toBe('pub-EXISTING');       // b adopted the EXISTING key
  });
});
