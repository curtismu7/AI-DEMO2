'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/hostedAccessOAuthService');
jest.mock('../../services/authAccessAuditService', () => ({
  startLoginAudit: jest.fn(),
  resumeLoginAudit: jest.fn(),
  finishLoginAudit: jest.fn(),
}));
jest.mock('../../services/hostedAccessPolicy', () => ({
  loadHostedAccessPolicy: jest.fn(() => ({ enabled: true, domains: ['pingidentity.com'], fingerprint: 'policy-1' })),
  evaluateHostedIdentity: jest.fn(() => ({ allowed: false, reason: 'domain_not_allowed', subject: 'rival' })),
  coherentHostedIdentityClaims: jest.fn((idClaims, userInfo) => ({ ...idClaims, ...userInfo })),
  stampHostedAccessApproval: jest.fn(),
  hasCurrentHostedAccessApproval: jest.fn(() => false),
}));
jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'https://ai-demo.ping-devops.com'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
}));

const hostedOAuth = require('../../services/hostedAccessOAuthService');
const audit = require('../../services/authAccessAuditService');
const hostedPolicy = require('../../services/hostedAccessPolicy');

function appFor({ hostedSession, applicationSession }) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = applicationSession;
    req.hostedSession = hostedSession;
    next();
  });
  app.use('/api/auth/hosted-access', require('../../routes/hostedAccess'));
  return app;
}

test('front-door callback rejects an unapproved identity without mutating either session', async () => {
  hostedOAuth.exchangeCodeForToken.mockResolvedValue({ access_token: 'front-door-token', id_token: 'front-door-id-token' });
  hostedOAuth.validateIdentity.mockResolvedValue({ idTokenClaims: { nonce: 'nonce-1' }, userInfo: { sub: 'rival', email: 'rival@example.com', email_verified: true } });
  const applicationSession = { user: { id: 'demo-user' }, oauthTokens: { accessToken: 'demo-token' } };
  const hostedSession = {
    hostedOAuthState: 'state-1', hostedOAuthCodeVerifier: 'verifier', hostedOAuthNonce: 'nonce-1',
    hostedOAuthRedirectUri: 'https://ai-demo.ping-devops.com/api/auth/hosted-access/callback',
    save: jest.fn((cb) => cb(null)), destroy: jest.fn((cb) => cb(null)),
  };
  const res = await request(appFor({ hostedSession, applicationSession }))
    .get('/api/auth/hosted-access/callback')
    .query({ code: 'frontdoor-code', state: 'state-1' });

  expect(res.status).toBe(403);
  expect(res.text).toContain('Access restricted to authorized Ping employees.');
  expect(applicationSession).toEqual({ user: { id: 'demo-user' }, oauthTokens: { accessToken: 'demo-token' } });
  expect(hostedSession.save).not.toHaveBeenCalled();
  expect(hostedOAuth.exchangeCodeForToken).toHaveBeenCalled();
  expect(hostedOAuth.validateIdentity).toHaveBeenCalled();
  expect(hostedPolicy.evaluateHostedIdentity).toHaveBeenCalled();
  expect(audit.finishLoginAudit).toHaveBeenCalledWith(
    expect.any(Object), expect.objectContaining({ outcome: 'denied', reasonCode: 'domain_not_allowed' }),
  );
});
