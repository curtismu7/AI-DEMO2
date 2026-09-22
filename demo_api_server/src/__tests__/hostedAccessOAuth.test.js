'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/hostedAccessOAuthService', () => ({
  generateState: jest.fn(),
  generateCodeVerifier: jest.fn(),
  generateAuthorizationUrl: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  validateIdentity: jest.fn(),
}));
jest.mock('../../services/pingOneUserLookupService', () => ({
  resolvePingOneIdentifier: jest.fn(),
}));
jest.mock('../../config/hostedAccess', () => ({
  clientId: 'front-door-client',
  redirectUri: 'https://ai-demo.ping-devops.com/api/auth/hosted-access/callback',
}));
jest.mock('../../services/authAccessAuditService', () => ({
  startLoginAudit: jest.fn(),
  resumeLoginAudit: jest.fn(),
  finishLoginAudit: jest.fn(),
}));
jest.mock('../../services/hostedAccessPolicy', () => ({
  loadHostedAccessPolicy: jest.fn(() => ({ enabled: true, domains: ['pingidentity.com'], fingerprint: 'policy-1' })),
  evaluateHostedIdentity: jest.fn(() => ({
    allowed: true,
    reason: 'allowed',
    subject: 'frontdoor-subject',
    email: 'person@pingidentity.com',
    domain: 'pingidentity.com',
  })),
  coherentHostedIdentityClaims: jest.fn((idClaims, userInfo) => ({ ...idClaims, ...userInfo })),
  stampHostedAccessApproval: jest.fn((session, decision, policy) => {
    session.hostedAccessApproval = { subject: decision.subject, policyFingerprint: policy.fingerprint };
    return session.hostedAccessApproval;
  }),
  hasCurrentHostedAccessApproval: jest.fn(() => false),
}));
jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'https://ai-demo.ping-devops.com'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
}));

const hostedOAuth = require('../../services/hostedAccessOAuthService');
const audit = require('../../services/authAccessAuditService');
const hostedPolicy = require('../../services/hostedAccessPolicy');
const { stampHostedAccessApproval } = hostedPolicy;

function appFor({ hostedSession, applicationSession = {} } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = applicationSession;
    req.hostedSession = hostedSession;
    next();
  });
  app.use('/api/auth/hosted-access', require('../../routes/hostedAccess'));
  return app;
}

describe('hosted front-door OAuth', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    hostedPolicy.loadHostedAccessPolicy.mockReturnValue({ enabled: true, domains: ['pingidentity.com'], fingerprint: 'policy-1' });
    hostedPolicy.coherentHostedIdentityClaims.mockImplementation((idClaims, userInfo) => ({ ...idClaims, ...userInfo }));
    hostedPolicy.evaluateHostedIdentity.mockReturnValue({
      allowed: true, reason: 'allowed', subject: 'frontdoor-subject',
      email: 'person@pingidentity.com', domain: 'pingidentity.com',
    });
    hostedPolicy.stampHostedAccessApproval.mockImplementation((session, decision, policy) => {
      session.hostedAccessApproval = { subject: decision.subject, policyFingerprint: policy.fingerprint };
      return session.hostedAccessApproval;
    });
    hostedOAuth.generateState.mockReturnValue('a'.repeat(64));
    hostedOAuth.generateCodeVerifier.mockReturnValue('verifier');
    hostedOAuth.generateAuthorizationUrl.mockReturnValue('https://auth.pingone.com/authorize?client_id=front-door');
    hostedOAuth.exchangeCodeForToken.mockResolvedValue({ access_token: 'front-door-token', id_token: 'front-door-id-token' });
    hostedOAuth.validateIdentity.mockResolvedValue({ idTokenClaims: { nonce: 'nonce-1' }, userInfo: { sub: 'frontdoor-subject', email: 'person@pingidentity.com', email_verified: true } });
  });

  test('front-door callback creates admission only and preserves the demo application session', async () => {
    const applicationSession = { user: { id: 'demo-user' }, oauthTokens: { accessToken: 'demo-token' } };
    const hostedSession = {
      hostedOAuthState: 'state-1',
      hostedOAuthCodeVerifier: 'verifier',
      hostedOAuthNonce: 'nonce-1',
      hostedOAuthRedirectUri: 'https://ai-demo.ping-devops.com/api/auth/hosted-access/callback',
      save: jest.fn((cb) => cb(null)),
      destroy: jest.fn((cb) => cb(null)),
    };

    const res = await request(appFor({ hostedSession, applicationSession }))
      .get('/api/auth/hosted-access/callback')
      .query({ code: 'frontdoor-code', state: 'state-1' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://ai-demo.ping-devops.com/');
    expect(applicationSession).toEqual({ user: { id: 'demo-user' }, oauthTokens: { accessToken: 'demo-token' } });
    expect(hostedOAuth.exchangeCodeForToken).toHaveBeenCalledWith('frontdoor-code', 'verifier', expect.any(String));
    expect(stampHostedAccessApproval).toHaveBeenCalled();
    expect(hostedSession.save).toHaveBeenCalled();
  });

  test('front-door logout destroys only the front-door session', async () => {
    const applicationSession = { user: { id: 'demo-user' }, oauthTokens: { accessToken: 'demo-token' } };
    const hostedSession = { destroy: jest.fn((cb) => cb(null)) };
    const res = await request(appFor({ hostedSession, applicationSession }))
      .get('/api/auth/hosted-access/logout');

    expect(res.status).toBe(302);
    expect(hostedSession.destroy).toHaveBeenCalled();
    expect(applicationSession).toEqual({ user: { id: 'demo-user' }, oauthTokens: { accessToken: 'demo-token' } });
  });

  test('generateAuthorizationUrl appends login_hint when provided', () => {
    jest.dontMock('../../services/hostedAccessOAuthService');
    jest.doMock('../../config/hostedAccess', () => ({
      clientId: 'front-door-client',
      redirectUri: 'https://cb',
      scopes: ['openid', 'profile'],
      authorizationEndpoint: 'https://auth.pingone.com/authorize',
    }));
    const real = jest.requireActual('../../services/hostedAccessOAuthService');
    const url = real.generateAuthorizationUrl({
      state: 's', codeVerifier: 'v', redirectUri: 'https://cb', nonce: 'n',
      loginHint: 'cmuir+demo-user@pingone.com',
    });
    expect(url).toContain('login_hint=cmuir%2Bdemo-user%40pingone.com');
    const urlNoHint = real.generateAuthorizationUrl({ state: 's', codeVerifier: 'v', redirectUri: 'https://cb', nonce: 'n' });
    expect(urlNoHint).not.toContain('login_hint');
  });

  test('login with identifier resolves user and passes it as login_hint', async () => {
    const { resolvePingOneIdentifier } = require('../../services/pingOneUserLookupService');
    resolvePingOneIdentifier.mockResolvedValue({ user: { username: 'cmuir+demo-user@pingone.com', email: 'cmuir+demo-user@pingone.com' }, error: null });
    const hostedSession = { save: jest.fn((cb) => cb(null)) };
    const res = await request(appFor({ hostedSession }))
      .get('/api/auth/hosted-access/login')
      .query({ identifier: 'cmuir+demo-user@pingone.com' });

    expect(res.status).toBe(302);
    expect(resolvePingOneIdentifier).toHaveBeenCalledWith('cmuir+demo-user@pingone.com');
  });

  test('login with unresolvable identifier starts OAuth without login_hint', async () => {
    const { resolvePingOneIdentifier } = require('../../services/pingOneUserLookupService');
    resolvePingOneIdentifier.mockResolvedValue({ user: null, error: 'not_found' });
    const hostedSession = { save: jest.fn((cb) => cb(null)) };
    const res = await request(appFor({ hostedSession }))
      .get('/api/auth/hosted-access/login')
      .query({ identifier: 'nobody@nowhere.example' });

    expect(res.status).toBe(302);
    expect(resolvePingOneIdentifier).toHaveBeenCalledWith('nobody@nowhere.example');
    expect(String(res.headers.location)).not.toContain('login_hint');
  });
});
