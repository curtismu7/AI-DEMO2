/**
 * BOOTSTRAP_ALLOWLIST must cover the PingOne WORKER credential family.
 *
 * pingOneClientService.resolveWorkerCredentials tries PINGONE_WORKER_CLIENT_ID/SECRET
 * BEFORE pingone_mgmt_*, so a stale vault/LMDB copy of the worker secret outranks a
 * correct .env and wedges every getManagementToken() caller — /mgmt-api, scope-audit,
 * demoProvisioning, demoScenario.
 *
 * Observed live 2026-07-26: the vault held a secret for worker client 89ad8921 that
 * PingOne rejected while .env's was valid. The `basic` attempt failed invalid_client,
 * the basic->post self-heal in pingOneTokenAuth then surfaced "Unsupported
 * authentication method", which reads like an auth-METHOD misconfiguration and hides
 * the real cause (a stale secret). Loading the vault flipped a working mint into a 401.
 */
'use strict';

const { BOOTSTRAP_ALLOWLIST } = require('../../services/configStore');

describe('BOOTSTRAP_ALLOWLIST — PingOne worker credentials', () => {
  // Lowercase: getEffective() lowercases the key before the membership test.
  const WORKER_KEYS = [
    'pingone_worker_client_id',
    'pingone_worker_client_secret',
    'pingone_worker_token_client_id',
    'pingone_worker_token_client_secret',
  ];

  it.each(WORKER_KEYS)('%s is bootstrap-authoritative so .env wins over a stale vault value', (key) => {
    expect(BOOTSTRAP_ALLOWLIST.has(key)).toBe(true);
  });

  it('still covers the mgmt/management families it always did', () => {
    for (const key of [
      'pingone_mgmt_client_id',
      'pingone_mgmt_client_secret',
      'pingone_management_client_id',
      'pingone_management_client_secret',
    ]) {
      expect(BOOTSTRAP_ALLOWLIST.has(key)).toBe(true);
    }
  });

  it('keys are stored lowercase — an uppercase entry would never match getEffective', () => {
    for (const key of BOOTSTRAP_ALLOWLIST) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});
