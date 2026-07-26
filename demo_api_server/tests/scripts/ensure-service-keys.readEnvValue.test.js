'use strict';

/**
 * readEnvValue must match how the BFF's dotenv loader and docker compose
 * env_file read the SAME .env: strip one pair of surrounding matching quotes.
 * A quoted VAULT_PASSWORD="..." was otherwise handed to vault.js with the quotes
 * attached -> "bad password" -> mortgage/invest service-key provisioning blocked,
 * even though the BFF (quote-stripped) opened the same vault fine.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readEnvValue } = require('../../scripts/ensure-service-keys');

function writeEnv(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'esk-')), '.env');
  fs.writeFileSync(file, contents);
  return file;
}

describe('ensure-service-keys readEnvValue', () => {
  test('strips surrounding double quotes (the vault-password bug)', () => {
    expect(readEnvValue(writeEnv('VAULT_PASSWORD="Sluggers7&"\n'), 'VAULT_PASSWORD')).toBe('Sluggers7&');
  });

  test('strips surrounding single quotes', () => {
    expect(readEnvValue(writeEnv("KEY='abc123'\n"), 'KEY')).toBe('abc123');
  });

  test('leaves an unquoted value untouched', () => {
    expect(readEnvValue(writeEnv('KEY=Sluggers7&\n'), 'KEY')).toBe('Sluggers7&');
  });

  test('does NOT strip an unmatched leading quote', () => {
    expect(readEnvValue(writeEnv('KEY="oops\n'), 'KEY')).toBe('"oops');
  });

  test('trims surrounding whitespace', () => {
    expect(readEnvValue(writeEnv('KEY=  spaced  \n'), 'KEY')).toBe('spaced');
  });

  test('returns null for a missing key', () => {
    expect(readEnvValue(writeEnv('OTHER=1\n'), 'KEY')).toBeNull();
  });
});
