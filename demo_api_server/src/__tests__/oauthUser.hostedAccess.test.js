'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/oauthUserService');
jest.mock('../../services/authAccessAuditService', () => ({
  startLoginAudit: jest.fn(),
  resumeLoginAudit: jest.fn(),
  finishLoginAudit: jest.fn(),
}));

const oauthService = require('../../services/oauthUserService');
const audit = require('../../services/authAccessAuditService');
const oauthUserRouter = require('../../routes/oauthUser');

const token = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function appFor(seed) {
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'session-1';
    req.session = {
      ...seed,
      save(cb) { cb(null); },
      regenerate(cb) { cb(null); },
      destroy(cb) { this.destroyed = true; cb(null); },
    };
    next();
  });
  app.use('/api/auth/oauth/user', oauthUserRouter);
  return app;
}

describe('customer OAuth hosted access', () => {
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

  test('rejects an unapproved domain before creating a local user', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at',
      id_token: token({ sub: 'external-1', nonce: 'nonce-1', email: 'rival@competitor.example', email_verified: true }),
    });
    oauthService.getUserInfo.mockResolvedValue({
      sub: 'external-1', email: 'rival@competitor.example', email_verified: true,
    });

    const res = await request(appFor({
      oauthState: 'state-1', oauthNonce: 'nonce-1', oauthCodeVerifier: 'verifier',
      oauthRedirectUri: 'https://ai-demo.ping-devops.com/api/auth/oauth/user/callback',
      hostedLoginAudit: { loginType: 'user', startedAt: Date.now(), terminal: false },
    })).get('/api/auth/oauth/user/callback').query({ code: 'code-1', state: 'state-1' });

    expect(res.status).toBe(403);
    expect(res.text).toContain('Access restricted to authorized Ping employees.');
    expect(oauthService.createUserFromOAuth).not.toHaveBeenCalled();
    expect(audit.finishLoginAudit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ outcome: 'denied', reasonCode: 'domain_not_allowed' }),
    );
  });

  test('rejects a Ping email whose verification claim is absent', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at', id_token: token({ sub: 'user-1', nonce: 'nonce-1', email: 'person@pingone.com' }),
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'user-1', email: 'person@pingone.com' });
    const res = await request(appFor({
      oauthState: 'state-1', oauthNonce: 'nonce-1', oauthCodeVerifier: 'verifier',
      oauthRedirectUri: 'https://ai-demo.ping-devops.com/api/auth/oauth/user/callback',
      hostedLoginAudit: { loginType: 'user', startedAt: Date.now(), terminal: false },
    })).get('/api/auth/oauth/user/callback').query({ code: 'code-1', state: 'state-1' });
    expect(res.status).toBe(403);
    expect(audit.finishLoginAudit).toHaveBeenCalledWith(
      expect.any(Object), expect.objectContaining({ reasonCode: 'email_unverified' }),
    );
  });
});
