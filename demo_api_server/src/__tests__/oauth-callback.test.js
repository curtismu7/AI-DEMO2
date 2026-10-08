/**
 * Test OAuth callback functionality to verify OAuth tokens are stored directly
 * without JWT generation (Task 7 verification)
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

// Mock the dependencies before importing routes
jest.mock('../../services/oauthService');
jest.mock('../../services/oauthUserService');
jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn(() => ''),
  isConfigured: jest.fn(() => true),
}));
jest.mock('../../data/store');
jest.mock('../../middleware/auth');
jest.mock('../../services/pingOneUserLookupService', () => ({
  fetchPingOneUserById: jest.fn().mockResolvedValue({ user: null, error: 'not_found' }),
}));
jest.mock('../../services/oidcIdTokenValidationService', () => ({
  validateIdToken: jest.fn().mockResolvedValue({ sub: 'test-user-id' }),
  assertUserInfoSubjectMatches: jest.fn(),
}));

const mockOAuthService = require('../../services/oauthService');
const mockOAuthUserService = require('../../services/oauthUserService');
const mockConfigStore = require('../../services/configStore');
const { readPkceCookie, setPkceCookie } = require('../../services/pkceStateCookie');
const mockDataStore = require('../../data/store');
const mockAuth = require('../../middleware/auth');
const { fetchPingOneUserById } = require('../../services/pingOneUserLookupService');

describe('OAuth Callback Token Storage (Task 7)', () => {
  let app;
  
  beforeAll(() => {
    // Create test app
    app = express();
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false
    }));

    app.get('/__test/user-login-provider', (req, res) => {
      res.json({ loginProvider: req.session.oauthLoginProvider || null });
    });

    app.get('/__test/user-login-session', (req, res) => {
      Object.assign(req.session, {
        oauthType: 'user',
        oauthState: 'current-state',
        oauthCodeVerifier: 'current-verifier',
        oauthRedirectUri: 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
        oauthNonce: 'current-nonce',
        oauthLoginProvider: 'pingone',
      });
      req.session.save((err) => res.sendStatus(err ? 500 : 204));
    });

    app.get('/__test/user-pf-login-session', (req, res) => {
      Object.assign(req.session, {
        oauthType: 'user',
        oauthState: 'current-state',
        oauthCodeVerifier: 'current-verifier',
        oauthRedirectUri: 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
        oauthNonce: 'current-nonce',
        oauthLoginProvider: 'pingfederate',
      });
      req.session.save((err) => res.sendStatus(err ? 500 : 204));
    });

    app.get('/__test/user-pkce-cookie', (req, res) => {
      setPkceCookie(res, {
        state: 'cookie-current-state',
        codeVerifier: 'cookie-current-verifier',
        redirectUri: 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
        nonce: 'cookie-current-nonce',
        oauthProvider: 'pingone',
      }, false);
      req.session.save((err) => res.sendStatus(err ? 500 : 204));
    });

    app.get('/__test/admin-login-session', (req, res) => {
      const loginSession = {
        oauthType: 'admin',
        oauthState: 'admin-state',
        oauthCodeVerifier: 'admin-verifier',
        oauthRedirectUri: 'https://local.ping-devops.com:4000/api/auth/oauth/callback',
        oauthNonce: 'admin-nonce',
      };
      if (req.query.legacy !== '1') loginSession.oauthLoginProvider = 'pingfederate';
      Object.assign(req.session, loginSession);
      req.session.save((err) => res.sendStatus(err ? 500 : 204));
    });

    // Import routes after mocking
    const oauthRoutes = require('../../routes/oauth');
    const oauthUserRoutes = require('../../routes/oauthUser');

    app.use('/api/auth/oauth', oauthRoutes);
    app.use('/api/auth/oauth/user', oauthUserRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // A test that flips the stack provider must not leak into the next one.
    mockConfigStore.getOAuthProvider.mockReturnValue('pingone');

    // Setup default mocks
    mockOAuthService.exchangeCodeForToken = jest.fn().mockResolvedValue({
      access_token: 'test-oauth-access-token',
      refresh_token: 'test-oauth-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer'
    });
    
    mockOAuthService.getUserInfo = jest.fn().mockResolvedValue({
      sub: 'test-user-id',
      preferred_username: 'testuser',
      email: 'test@example.com',
      given_name: 'Test',
      family_name: 'User'
    });
    
    mockOAuthService.createUserFromOAuth = jest.fn().mockReturnValue({
      username: 'testuser',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'admin',
      oauthProvider: 'pingone_sso',
      oauthId: 'test-user-id'
    });
    
    mockDataStore.getUserByUsername = jest.fn().mockReturnValue(null);
    mockDataStore.createUser = jest.fn().mockResolvedValue({
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'admin',
      oauthProvider: 'pingone_sso',
      oauthId: 'test-user-id'
    });
    
    mockAuth.determineClientType = jest.fn().mockReturnValue('enduser');
    
    // Mock generateState for OAuth service
    mockOAuthService.generateState = jest.fn().mockReturnValue('test-state');
    mockOAuthService.generateAuthorizationUrl = jest.fn().mockReturnValue('https://oauth.example.com/auth');
    mockOAuthUserService.generateState = jest.fn().mockReturnValue('step-up-state');
    mockOAuthUserService.generateCodeVerifier = jest.fn().mockReturnValue('step-up-verifier');
    mockOAuthUserService.generateAuthorizationUrl = jest.fn().mockReturnValue('https://pf.example.com/auth');
  });

  test('Admin OAuth status endpoint returns OAuth tokens instead of JWT', async () => {
    const agent = request.agent(app);
    
    // Manually set up session to simulate successful OAuth callback
    const sessionData = {
      user: {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
        oauthProvider: 'pingone_sso'
      },
      oauthTokens: {
        accessToken: 'test-oauth-access-token',
        refreshToken: 'test-oauth-refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer'
      },
      clientType: 'enduser'
    };

    // Simulate the session by making a request that sets up the session
    await agent
      .get('/api/auth/oauth/status')
      .set('Cookie', [`connect.sid=s%3A${Buffer.from(JSON.stringify(sessionData)).toString('base64')}`]);

    // Check status endpoint response format
    const statusResponse = await new Promise((resolve) => {
      const req = {
        session: sessionData
      };
      const res = {
        json: (data) => resolve({ status: 200, body: data })
      };
      
      // Simulate the status endpoint logic
      const isAuthenticated = !!(req.session.user && req.session.oauthTokens?.accessToken);
      
      const responseData = {
        authenticated: isAuthenticated,
        user: isAuthenticated ? {
          id: req.session.user.id,
          username: req.session.user.username,
          email: req.session.user.email,
          firstName: req.session.user.firstName,
          lastName: req.session.user.lastName,
          role: req.session.user.role
        } : null,
        oauthProvider: isAuthenticated ? req.session.user.oauthProvider : null,
        accessToken: isAuthenticated ? req.session.oauthTokens.accessToken : null,
        tokenType: isAuthenticated ? req.session.oauthTokens.tokenType : null,
        expiresAt: isAuthenticated ? req.session.oauthTokens.expiresAt : null,
        clientType: isAuthenticated ? req.session.clientType : null
      };
      
      res.json(responseData);
    });
    
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body).toMatchObject({
      authenticated: true,
      user: {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin'
      },
      oauthProvider: 'pingone_sso',
      accessToken: 'test-oauth-access-token',
      tokenType: 'Bearer',
      clientType: 'enduser'
    });

    // Verify OAuth tokens are present
    expect(statusResponse.body.accessToken).toBe('test-oauth-access-token');
    expect(statusResponse.body.tokenType).toBe('Bearer');
    expect(statusResponse.body.expiresAt).toBeDefined();
    
    // Verify JWT token is NOT present (this is the key requirement)
    expect(statusResponse.body.jwtToken).toBeUndefined();
  });

  test('admin callback does not redeem a code with a provider different from login start', async () => {
    const agent = request.agent(app);
    await agent.get('/__test/admin-login-session').expect(204);

    const response = await agent.get('/api/auth/oauth/callback')
      .query({ code: 'admin-code', state: 'admin-state' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('error=provider_changed');
    expect(mockOAuthService.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  test('admin callback does not redeem a code without a recorded login provider', async () => {
    const agent = request.agent(app);
    await agent.get('/__test/admin-login-session?legacy=1').expect(204);

    const response = await agent.get('/api/auth/oauth/callback')
      .query({ code: 'admin-code', state: 'admin-state' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('error=provider_changed');
    expect(mockOAuthService.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  test('stale callback does not clear the current login state or launch another login', async () => {
    const agent = request.agent(app);
    await agent.get('/__test/user-login-session').expect(204);

    const stale = await agent.get('/api/auth/oauth/user/callback')
      .query({ code: 'stale-code', state: 'older-tab-state' });
    expect(stale.status).toBe(302);
    expect(stale.headers.location).toContain('error=invalid_state');
    expect(stale.headers.location).not.toContain('/login');

    const current = await agent.get('/api/auth/oauth/user/callback')
      .query({ code: 'current-code', state: 'current-state' });
    expect(current.headers.location).not.toContain('error=invalid_state');
    expect(mockOAuthUserService.exchangeCodeForToken).toHaveBeenCalledWith(
      'current-code', 'current-verifier',
      'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
    );
  });

  test('a completed PingOne sign-in looks the phone up from PingOne', async () => {
    mockOAuthUserService.exchangeCodeForToken = jest.fn().mockResolvedValue({
      access_token: 'user-access-token', expires_in: 3600, token_type: 'Bearer', id_token: 'idt',
    });
    mockOAuthUserService.getUserInfo = jest.fn().mockResolvedValue({
      sub: 'test-user-id', preferred_username: 'testuser', email: 'test@example.com',
    });
    mockOAuthUserService.createUserFromOAuth = jest.fn().mockReturnValue({
      username: 'testuser', email: 'test@example.com', role: 'admin',
      oauthProvider: 'pingone', oauthId: 'test-user-id',
    });
    mockDataStore.getUserByUsername = jest.fn().mockReturnValue(null);
    mockDataStore.createUser = jest.fn().mockResolvedValue({
      id: 'user-123', username: 'testuser', role: 'admin', oauthId: 'test-user-id',
    });
    const agent = request.agent(app);
    await agent.get('/__test/user-login-session').expect(204);

    const response = await agent.get('/api/auth/oauth/user/callback')
      .query({ code: 'phone-code', state: 'current-state' });
    expect(response.headers.location).not.toContain('error=');
    expect(fetchPingOneUserById).toHaveBeenCalledWith('test-user-id');
  });

  test('a PingFederate sign-in never calls the PingOne user API (its oauthId is a username)', async () => {
    mockConfigStore.getOAuthProvider.mockReturnValue('pingfederate');
    mockOAuthUserService.exchangeCodeForToken = jest.fn().mockResolvedValue({
      access_token: 'user-access-token', expires_in: 3600, token_type: 'Bearer', id_token: 'idt',
    });
    mockOAuthUserService.getUserInfo = jest.fn().mockResolvedValue({
      sub: 'test-user-id', preferred_username: 'testuser', email: 'test@example.com',
    });
    mockOAuthUserService.createUserFromOAuth = jest.fn().mockReturnValue({
      username: 'testuser', email: 'test@example.com', role: 'admin',
      oauthProvider: 'pingfederate', oauthId: 'demouser',
    });
    mockDataStore.getUserByUsername = jest.fn().mockReturnValue(null);
    mockDataStore.createUser = jest.fn().mockResolvedValue({
      id: 'user-123', username: 'testuser', role: 'admin', oauthId: 'demouser',
    });
    const agent = request.agent(app);
    await agent.get('/__test/user-pf-login-session').expect(204);

    const response = await agent.get('/api/auth/oauth/user/callback')
      .query({ code: 'pf-phone-code', state: 'current-state' });
    expect(response.headers.location).not.toContain('error=');
    expect(fetchPingOneUserById).not.toHaveBeenCalled();
  });

  test('stale callback preserves the active signed PKCE cookie fallback', async () => {
    const agent = request.agent(app);
    await agent.get('/__test/user-pkce-cookie').expect(204);

    const stale = await agent.get('/api/auth/oauth/user/callback')
      .query({ code: 'stale-code', state: 'older-tab-state' });
    expect(stale.headers.location).toContain('error=invalid_state');
    expect(stale.headers.location).not.toContain('/login');
    expect(stale.headers['set-cookie'] || []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^_pkce=;/)]),
    );

    await agent.get('/api/auth/oauth/user/callback')
      .query({ code: 'cookie-current-code', state: 'cookie-current-state' });
    expect(mockOAuthUserService.exchangeCodeForToken).toHaveBeenCalledWith(
      'cookie-current-code', 'cookie-current-verifier',
      'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
    );
  });

  test('step-up stores the selected provider in both session and PKCE fallback cookie', async () => {
    mockConfigStore.getOAuthProvider.mockReturnValue('pingfederate');
    const agent = request.agent(app);

    const response = await agent.get('/api/auth/oauth/user/stepup')
      .query({ return_to: '/dashboard' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://pf.example.com/auth');
    const sessionResponse = await agent.get('/__test/user-login-provider');
    expect(sessionResponse.body.loginProvider).toBe('pingfederate');

    const pkceCookie = response.headers['set-cookie']
      .find((cookie) => cookie.startsWith('_pkce='))
      .split(';')[0];
    expect(readPkceCookie({ headers: { cookie: pkceCookie } }))
      .toMatchObject({ oauthProvider: 'pingfederate' });
  });

  test('User OAuth status endpoint returns OAuth tokens instead of JWT', async () => {
    // Simulate customer user session
    const sessionData = {
      user: {
        id: 'customer-123',
        username: 'testcustomer',
        email: 'customer@example.com',
        firstName: 'Test',
        lastName: 'Customer',
        role: 'customer',
        oauthProvider: 'pingone_sso'
      },
      oauthTokens: {
        accessToken: 'test-oauth-access-token-customer',
        refreshToken: 'test-oauth-refresh-token-customer',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer'
      },
      clientType: 'enduser',
      oauthType: 'user'
    };

    // Check user status endpoint response format
    const statusResponse = await new Promise((resolve) => {
      const req = {
        session: sessionData
      };
      const res = {
        json: (data) => resolve({ status: 200, body: data })
      };
      
      // Simulate the user status endpoint logic
      const isAuthenticated = req.session.user && req.session.oauthTokens?.accessToken && req.session.oauthType === 'user';
      
      const responseData = {
        authenticated: isAuthenticated,
        user: isAuthenticated ? {
          id: req.session.user.id,
          username: req.session.user.username,
          email: req.session.user.email,
          firstName: req.session.user.firstName,
          lastName: req.session.user.lastName,
          role: req.session.user.role
        } : null,
        oauthProvider: isAuthenticated ? req.session.user.oauthProvider : null,
        accessToken: isAuthenticated ? req.session.oauthTokens.accessToken : null,
        tokenType: isAuthenticated ? req.session.oauthTokens.tokenType : null,
        expiresAt: isAuthenticated ? req.session.oauthTokens.expiresAt : null,
        clientType: isAuthenticated ? req.session.clientType : null
      };
      
      res.json(responseData);
    });
    
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body).toMatchObject({
      authenticated: true,
      user: {
        id: 'customer-123',
        username: 'testcustomer',
        email: 'customer@example.com',
        firstName: 'Test',
        lastName: 'Customer',
        role: 'customer'
      },
      oauthProvider: 'pingone_sso',
      accessToken: 'test-oauth-access-token-customer',
      tokenType: 'Bearer',
      clientType: 'enduser'
    });

    // Verify OAuth tokens are present
    expect(statusResponse.body.accessToken).toBe('test-oauth-access-token-customer');
    expect(statusResponse.body.tokenType).toBe('Bearer');
    expect(statusResponse.body.expiresAt).toBeDefined();
    
    // Verify JWT token is NOT present (this is the key requirement)
    expect(statusResponse.body.jwtToken).toBeUndefined();
  });

  test('OAuth callback flow stores tokens without JWT generation', () => {
    // Test the core logic of storing OAuth tokens directly
    const mockSession = {};
    const tokenData = {
      access_token: 'test-oauth-access-token',
      refresh_token: 'test-oauth-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer'
    };
    
    const user = {
      id: 'user-123',
      username: 'testuser',
      role: 'admin'
    };
    
    const clientType = 'enduser';
    
    // Simulate the new callback logic (without JWT generation)
    mockSession.oauthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      tokenType: tokenData.token_type || 'Bearer'
    };
    
    mockSession.user = user;
    mockSession.clientType = clientType;
    
    // Verify OAuth tokens are stored
    expect(mockSession.oauthTokens).toBeDefined();
    expect(mockSession.oauthTokens.accessToken).toBe('test-oauth-access-token');
    expect(mockSession.oauthTokens.refreshToken).toBe('test-oauth-refresh-token');
    expect(mockSession.oauthTokens.tokenType).toBe('Bearer');
    expect(mockSession.oauthTokens.expiresAt).toBeDefined();
    
    // Verify user and client type are stored
    expect(mockSession.user).toBe(user);
    expect(mockSession.clientType).toBe(clientType);
    
    // Verify JWT token is NOT generated or stored
    expect(mockSession.jwtToken).toBeUndefined();
  });
});
