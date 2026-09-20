'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/oauthService');
jest.mock('../../services/authAccessAuditService', () => ({ startLoginAudit: jest.fn(), resumeLoginAudit: jest.fn(), finishLoginAudit: jest.fn() }));
jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: () => 'https://ai-demo.ping-devops.com',
  getAdminRedirectUri: () => 'https://ai-demo.ping-devops.com/api/auth/oauth/callback',
  validateRedirectUriOrigin: () => ({ ok: true }),
  getExpectedFrontendOrigin: () => 'https://ai-demo.ping-devops.com',
}));
jest.mock('../../services/pkceStateCookie', () => ({ setPkceCookie: jest.fn(), readPkceCookie: jest.fn(() => null), clearPkceCookie: jest.fn() }));
jest.mock('../../services/authStateCookie', () => ({ setAuthCookie: jest.fn(), clearAuthCookie: jest.fn() }));
jest.mock('../../data/store', () => ({ getUserByUsername: jest.fn(), createUser: jest.fn(), updateUser: jest.fn() }));

const oauthService = require('../../services/oauthService');
const dataStore = require('../../data/store');
const audit = require('../../services/authAccessAuditService');

const token = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('admin OAuth hosted access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HOSTED_ACCESS_GATE_ENABLED = 'true';
    process.env.HOSTED_ACCESS_ALLOWED_DOMAINS = 'pingidentity.com,pingone.com';
    process.env.HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL = 'true';
  });
  afterEach(() => {
    delete process.env.HOSTED_ACCESS_GATE_ENABLED;
    delete process.env.HOSTED_ACCESS_ALLOWED_DOMAINS;
    delete process.env.HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL;
  });

  test('rejects an external identity before admin user mutation', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at', id_token: token({ sub: 'external-1', nonce: 'nonce-1', email: 'rival@competitor.example', email_verified: true }),
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'external-1', email: 'rival@competitor.example', email_verified: true });
    const app = express();
    app.use((req, _res, next) => {
      req.sessionID = 'session-1';
      req.session = {
        oauthState: 'state-1', oauthNonce: 'nonce-1', oauthCodeVerifier: 'verifier',
        oauthRedirectUri: 'https://ai-demo.ping-devops.com/api/auth/oauth/callback',
        hostedLoginAudit: { loginType: 'admin', startedAt: Date.now(), terminal: false },
        save(cb) { cb(null); }, regenerate(cb) { cb(null); }, destroy(cb) { cb(null); },
      };
      next();
    });
    app.use('/api/auth/oauth', require('../../routes/oauth'));

    const res = await request(app).get('/api/auth/oauth/callback').query({ code: 'code-1', state: 'state-1' });
    expect(res.status).toBe(403);
    expect(dataStore.createUser).not.toHaveBeenCalled();
    expect(dataStore.updateUser).not.toHaveBeenCalled();
    expect(audit.finishLoginAudit).toHaveBeenCalledWith(
      expect.any(Object), expect.objectContaining({ outcome: 'denied', reasonCode: 'domain_not_allowed' }),
    );
  });
});
