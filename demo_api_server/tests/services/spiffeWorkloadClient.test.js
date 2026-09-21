'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configStore = require('../../services/configStore');
const workload = require('../../services/spiffeWorkloadClient');

describe('spiffeWorkloadClient', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-demo-spiffe-'));
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => ({
      spiffe_svid_path: path.join(dir, 'svid.jwt'),
      spiffe_key_path: path.join(dir, 'svid.key'),
      spiffe_bundle_path: path.join(dir, 'bundle.pem'),
      spiffe_trust_domain: 'bxfinance.demo',
    }[key] || ''));
    workload.resetForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reads the configured JWT-SVID and signing key', () => {
    fs.writeFileSync(path.join(dir, 'svid.jwt'), 'jwt-svid');
    fs.writeFileSync(path.join(dir, 'svid.key'), 'pem-key');

    expect(workload.getJwtSvid()).toBe('jwt-svid');
    expect(workload.getSigningKeyPem()).toBe('pem-key');
  });

  test('fails closed when a configured workload file is absent', () => {
    expect(() => workload.getSigningKeyPem()).toThrow(/not readable/i);
  });

  test('invalidates cached material when the file changes', () => {
    const keyPath = path.join(dir, 'svid.key');
    fs.writeFileSync(keyPath, 'old-key');
    expect(workload.getSigningKeyPem()).toBe('old-key');
    fs.writeFileSync(keyPath, 'new-key');
    workload.invalidateForTests();
    expect(workload.getSigningKeyPem()).toBe('new-key');
  });
});
