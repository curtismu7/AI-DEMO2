'use strict';

const express = require('express');
const request = require('supertest');
const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

describe('PF AI Agent RAR route', () => {
  test('starts only the PF PAR flow and binds it to a single pending PF callback', async () => {
    const values = {
      pf_ai_cimd_enabled: 'true', pf_ai_rar_enabled: 'true',
      pf_issuer: 'https://pf.example.test',
      pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
      pf_authorization_endpoint: 'https://pf.example.test/as/authorize',
      pf_token_endpoint: 'https://pf.example.test/as/token',
      pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
      pf_par_endpoint: 'https://pf.example.test/as/par',
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        issuer: 'https://pf.example.test',
        authorization_endpoint: 'https://pf.example.test/as/authorize',
        token_endpoint: 'https://pf.example.test/as/token',
        jwks_uri: 'https://pf.example.test/pf/JWKS',
        pushed_authorization_request_endpoint: 'https://pf.example.test/as/par',
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        request_uri: 'urn:ietf:params:oauth:request_uri:rar-request', expires_in: 90,
      }) });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = {
        oauthProvider: 'pingfederate',
        oauthTokens: { accessToken: 'pf-session-token' },
        user: { username: 'demouser' },
        pfAiAgent: {},
      };
      next();
    });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({
      configStore: { getEffective: (key) => values[String(key).toLowerCase()] || '' }, fetchImpl,
    }));

    const response = await request(app)
      .post('/api/pf-ai-agent/rar/start')
      .send({ scenario: 'allowed', userKey: 'demouser' })
      .expect(302);

    expect(response.headers.location).toContain('https://pf.example.test/as/authorize');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].body.get('client_id')).toContain('/cimd/client-metadata.json');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body.get('authorization_details'))[0].type)
      .toBe('banking_transaction');
    expect(response.headers.location).not.toContain('oauth/callback');
  });

  test('format=json returns the authorize URL and the redacted PAR trace instead of redirecting', async () => {
    const values = {
      pf_ai_cimd_enabled: 'true', pf_ai_rar_enabled: 'true',
      pf_issuer: 'https://pf.example.test',
      pf_discovery_endpoint: 'https://pf.example.test/.well-known/openid-configuration',
      pf_authorization_endpoint: 'https://pf.example.test/as/authorize',
      pf_token_endpoint: 'https://pf.example.test/as/token',
      pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
      pf_par_endpoint: 'https://pf.example.test/as/par',
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        issuer: 'https://pf.example.test',
        authorization_endpoint: 'https://pf.example.test/as/authorize',
        token_endpoint: 'https://pf.example.test/as/token',
        jwks_uri: 'https://pf.example.test/pf/JWKS',
        pushed_authorization_request_endpoint: 'https://pf.example.test/as/par',
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        request_uri: 'urn:ietf:params:oauth:request_uri:rar-request', expires_in: 90,
      }) });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = {
        oauthProvider: 'pingfederate',
        oauthTokens: { accessToken: 'pf-session-token' },
        user: { username: 'demouser' },
        pfAiAgent: {},
      };
      next();
    });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({
      configStore: { getEffective: (key) => values[String(key).toLowerCase()] || '' }, fetchImpl,
    }));

    const response = await request(app)
      .post('/api/pf-ai-agent/rar/start')
      .send({ scenario: 'allowed', userKey: 'demouser', format: 'json' })
      .expect(200);

    expect(response.body.authorizeUrl).toContain('https://pf.example.test/as/authorize');
    expect(response.body.trace.map((step) => step.id)).toEqual(['par', 'authorize']);
    expect(JSON.stringify(response.body)).not.toContain('pf-session-token');
  });

  test('format=json answers a refused PAR with an error code, not a redirect', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { oauthProvider: 'pingfederate', oauthTokens: { accessToken: 't' }, pfAiAgent: {} };
      next();
    });
    app.use('/api/pf-ai-agent', createPfAiAgentRouter({
      configStore: { getEffective: () => '' }, fetchImpl: jest.fn(),
    }));

    const response = await request(app)
      .post('/api/pf-ai-agent/rar/start').send({ format: 'json' }).expect(503);
    expect(response.body).toEqual({ error: 'PF_AI_RAR_NOT_CONFIGURED' });
  });

  describe('user limits lookup for the PingFederate processor', () => {
    const dataStore = {
      getUserByUsername: (username) => (username === 'demouser' ? { id: 'u1' } : undefined),
      getAccountsByUserId: () => [{ id: 'acct-a', currency: 'USD' }, { id: 'acct-b', currency: 'USD' }],
    };
    const appWith = (values) => {
      const app = express();
      app.use('/api/pf-ai-agent', createPfAiAgentRouter({
        configStore: { getEffective: (key) => values[String(key).toLowerCase()] || '' }, dataStore,
      }));
      return app;
    };
    const url = '/api/pf-ai-agent/rar/user-limits?username=demouser';

    test('returns the user\'s own accounts, limit and currency to a caller with the credential', async () => {
      const response = await request(appWith({ pf_ai_rar_lookup_secret: 'lookup-credential' }))
        .get(url).set('Authorization', 'Bearer lookup-credential').expect(200);
      expect(response.body).toEqual({
        user_id: 'demouser', account_ids: ['acct-a', 'acct-b'], transaction_limit: 5000, currency: 'USD',
      });
    });

    test('refuses a missing or wrong credential, and refuses everyone when none is configured', async () => {
      const app = appWith({ pf_ai_rar_lookup_secret: 'lookup-credential' });
      await request(app).get(url).expect(401);
      await request(app).get(url).set('Authorization', 'Bearer wrong-credential!').expect(401);
      await request(appWith({})).get(url).set('Authorization', 'Bearer ').expect(401);
    });

    test('answers 404 for a user with no banking record', async () => {
      await request(appWith({ pf_ai_rar_lookup_secret: 'lookup-credential' }))
        .get('/api/pf-ai-agent/rar/user-limits?username=nobody')
        .set('Authorization', 'Bearer lookup-credential').expect(404);
    });
  });

  // PingFederate signs a user in under its own spelling ("demouser"); the banking store
  // holds "demoUser". The lookup has to bridge that, or a correct sign-in is refused.
  describe('username matching for the user limits lookup', () => {
    const users = [
      { id: 'u1', username: 'demoUser' },
      { id: 'u2', username: 'Ada' },
      { id: 'u3', username: 'ada' },
    ];
    const store = {
      getUserByUsername: (name) => users.find((user) => user.username === name),
      getAllUsers: () => users,
      getAccountsByUserId: (id) => [{ id: `${id}-acct`, currency: 'USD' }],
    };
    const { userLimits } = require('../../services/pfAiAgentRarService');

    test('finds the store user ignoring case, answering with the name that was asked for', () => {
      expect(userLimits('demouser', store)).toMatchObject({ user_id: 'demouser', account_ids: ['u1-acct'] });
    });

    test('an exact match wins over a case-insensitive one', () => {
      expect(userLimits('ada', store).account_ids).toEqual(['u3-acct']);
    });

    test('refuses a case-insensitive match that is ambiguous', () => {
      expect(userLimits('ADA', store)).toBeNull();
    });

    test('still works against a store that cannot list its users', () => {
      const exactOnly = { getUserByUsername: store.getUserByUsername, getAccountsByUserId: store.getAccountsByUserId };
      expect(userLimits('demoUser', exactOnly)).not.toBeNull();
      expect(userLimits('demouser', exactOnly)).toBeNull();
    });
  });

  test('builds the detail from the user\'s own accounts, falling back to the fixed pair', async () => {
    const { buildAuthorizationDetail, userLimits } = require('../../services/pfAiAgentRarService');
    const limits = userLimits('demouser', {
      getUserByUsername: () => ({ id: 'u1' }),
      getAccountsByUserId: () => [{ id: 'acct-a', currency: 'USD' }, { id: 'acct-b', currency: 'USD' }],
    });
    expect(buildAuthorizationDetail('allowed', 'demouser', limits)).toMatchObject({
      user_id: 'demouser', source_account: 'acct-a', destination_account: 'acct-b',
    });
    expect(buildAuthorizationDetail('allowed', 'demouser')).toMatchObject({
      source_account: 'checking-100', destination_account: 'savings-200',
    });
  });
});
