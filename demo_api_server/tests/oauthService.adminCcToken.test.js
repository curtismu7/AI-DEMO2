'use strict';
// tests/oauthService.adminCcToken.test.js
//
// getAdminClientCredentialsToken — client-credentials minter for the ADMIN app,
// used as the actor token in support-console RFC 8693 token exchanges (later tasks).
//
// Env-var resolution (why the setup below): configStore.getEffective() for
// admin_client_id/admin_client_secret reads process.env through ENV_FALLBACK_MAP
// (PINGONE_ADMIN_* / PINGONE_AI_CORE_* / PINGONE_CORE_* / VITE_PINGONE_*), env
// wins over LMDB, and LMDB here is a throwaway per-worker tmpdir — so setting
// PINGONE_ADMIN_CLIENT_ID/SECRET in the test drives this.config.clientId/Secret.
// PINGONE_ENVIRONMENT_ID is required for this.config.tokenEndpoint to resolve
// (empty otherwise), and PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH=post puts client_id in
// the form body (the default 'basic' puts it in the Authorization header instead).

jest.mock('axios');

const axios = require('axios');

const ADMIN_ENV_ALIASES = [
  'PINGONE_ADMIN_CLIENT_ID',
  'PINGONE_ADMIN_CLIENT_SECRET',
  'PINGONE_AI_CORE_CLIENT_ID',
  'PINGONE_AI_CORE_CLIENT_SECRET',
  'PINGONE_CORE_CLIENT_ID',
  'PINGONE_CORE_CLIENT_SECRET',
  'VITE_PINGONE_CLIENT_ID',
  'VITE_PINGONE_CLIENT_SECRET',
];

function clearAdminCredEnv() {
  for (const k of ADMIN_ENV_ALIASES) delete process.env[k];
}

describe('getAdminClientCredentialsToken', () => {
  let oauthService;
  const savedEnv = {};

  beforeAll(() => {
    for (const k of [...ADMIN_ENV_ALIASES, 'PINGONE_ENVIRONMENT_ID', 'PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH', 'PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH_METHOD']) {
      savedEnv[k] = process.env[k];
    }
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve('../services/oauthService')];
  });

  beforeEach(() => {
    clearAdminCredEnv();
    delete process.env.PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH;
    delete process.env.PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH_METHOD;
    axios.post.mockReset();
  });

  describe('with admin credentials configured via env', () => {
    beforeEach(() => {
      process.env.PINGONE_ADMIN_CLIENT_ID = 'admin-cid';
      process.env.PINGONE_ADMIN_CLIENT_SECRET = 'admin-secret';
      process.env.PINGONE_ENVIRONMENT_ID = 'test-env-id';
      process.env.PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH = 'post';
      jest.isolateModules(() => {
        oauthService = require('../services/oauthService');
      });
    });

    it('mints a client_credentials token for the admin client with the requested scope', async () => {
      axios.post.mockResolvedValue({ data: { access_token: 'cc-token-1' } });
      const token = await oauthService.getAdminClientCredentialsToken('write');
      expect(token).toBe('cc-token-1');
      const [url, body] = axios.post.mock.calls[0];
      expect(url).toContain('/as/token');
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('scope=write');
      expect(body).toContain('client_id=admin-cid');
    });
  });

  describe('with admin credentials missing', () => {
    beforeEach(() => {
      delete process.env.PINGONE_ENVIRONMENT_ID;
      jest.isolateModules(() => {
        oauthService = require('../services/oauthService');
      });
    });

    it('throws a named error when admin credentials are missing', async () => {
      await expect(oauthService.getAdminClientCredentialsToken('write'))
        .rejects.toThrow(/admin client credentials/i);
    });
  });
});
