'use strict';

// Established pattern for testing authenticateToken-gated routes booted via
// server.js + supertest (see src/__tests__/thresholds.route.test.js and 30+
// other route test files) — server.js mounts many routers that each pull in
// middleware/auth, so the mock must cover the full export surface, not just
// authenticateToken, or unrelated routes fail to load.
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    req.user = req.session.user;
    next();
  },
  requireSession: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
      req.user = req.session.user;
    }
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    if (req.session.user?.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  },
  requireOwnershipOrAdmin: (req, res, next) => next(),
  requireEndUser: (req, res, next) => next(),
  requireAIAgent: (req, res, next) => next(),
  requireDelegation: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
  verifyPassword: jest.fn(() => true),
  hashPassword: jest.fn((pwd) => pwd),
  determineClientType: jest.fn(() => 'enduser'),
  determineUserTypeFromToken: jest.fn(() => 'customer'),
  parseTokenScopes: jest.fn(() => []),
  hasRequiredScopes: jest.fn(() => true),
}));

const request = require('supertest');
const { runIntentBindingDemo } = require('../../services/attackSimulatorService');

describe('runIntentBindingDemo — structural (no creds needed)', () => {
  test('returns no_session_token when session is missing (permit action)', async () => {
    const result = await runIntentBindingDemo('permit', { session: { oauthTokens: {} } });
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });

  test('returns unknown_action for an unrecognized action', async () => {
    const result = await runIntentBindingDemo('nonsense', { session: { oauthTokens: { accessToken: 'x' } } });
    expect(result.status).toBe(400);
    expect(result.errorCode).toBe('unknown_action');
  });

  test('drift action delegates to the existing rar-exceeded attack sim', async () => {
    const result = await runIntentBindingDemo('drift', { session: { oauthTokens: {} } });
    // Same session-missing guard as runAttackSim('rar-exceeded', ...) — proves delegation, not a parallel no-op.
    expect(result.sim).toBe('rar-exceeded');
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });
});

describe('POST /api/demo/intent-binding/run — route guards', () => {
  let app;
  beforeAll(() => {
    // server.js boots the full app; reuse it the same way other route-guard
    // tests do (e.g. thresholds.route.test.js) — requires the middleware/auth
    // mock above so authenticateToken doesn't reject the request before the
    // action-validation guard under test ever runs.
    app = require('../../server');
  });

  test('rejects an unknown action with 400', async () => {
    const res = await request(app)
      .post('/api/demo/intent-binding/run')
      .send({ action: 'nonsense' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_action');
  });
});

// ── Finding 1 (drift amount no-op) regression coverage ──────────────────────
//
// The structural tests above never reach the gateway call (they exit at the
// no-session-token guard), so they cannot prove the drift path actually
// forwards `requestedAmount` down to the create_transfer call instead of the
// old hardcoded 500. Reaching that far requires mocking the gateway/token
// dependencies attackSimulatorService.js pulls in — mocking that the
// pre-existing structural tests did not need. Per the jest.isolateModules +
// jest.doMock pattern already used in this codebase (see
// configStore.envReconcile.test.js), each test below gets a fresh, isolated
// copy of attackSimulatorService with just enough mocked to reach
// _runRarExceeded's callToolViaGateway call without touching a real network,
// LMDB, or the gateway-admin-push path (short-circuited via
// ff_mcp_gateway_pinggateway: 'true').
describe('runIntentBindingDemo / runAttackSim — drift honors requestedAmount (Finding 1)', () => {
  /** Minimal unsigned JWT (header.payload.sig) — decodeJwt only needs 3 base64url segments. */
  function fakeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url');
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${header}.${body}.sig`;
  }
  const FAKE_EXCHANGED_TOKEN = fakeJwt({ sub: 'user-1', aud: 'https://gateway.example/mcp' });

  function mockDeps({ callToolImpl }) {
    jest.doMock('../../services/configStore', () => ({
      getEffective: jest.fn((key) => {
        if (key === 'ff_mcp_gateway_pinggateway') return 'true'; // skip real gateway-admin push
        if (key === 'pingone_resource_mcp_gateway_uri') return 'https://gateway.example/mcp';
        return '';
      }),
      setRaw: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../services/oauthService', () => ({
      performTokenExchange: jest.fn().mockResolvedValue(FAKE_EXCHANGED_TOKEN),
      performTokenExchangeAs: jest.fn().mockResolvedValue(FAKE_EXCHANGED_TOKEN),
    }));
    jest.doMock('../../services/mcpGatewayClient', () => ({
      callToolViaGateway: jest.fn(callToolImpl),
      getMcpGatewayHttpUrl: jest.fn(() => 'https://gateway.example'),
    }));
  }

  const req = {
    session: { oauthTokens: { accessToken: 'user-access-token' }, user: { sub: 'user-1' } },
  };

  test('drift action forwards a low requestedAmount to create_transfer — and it actually PERMITs (≤ $100 cap)', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        mockDeps({ callToolImpl: jest.fn().mockResolvedValue({ ok: true }) });
        const { runIntentBindingDemo: isolatedRun } = require('../../services/attackSimulatorService');
        const { callToolViaGateway } = require('../../services/mcpGatewayClient');

        isolatedRun('drift', req, 50)
          .then((result) => {
            // callToolViaGateway signature: (gatewayUrl, token, tool, params, opts)
            expect(callToolViaGateway).toHaveBeenCalledTimes(1);
            expect(callToolViaGateway.mock.calls[0][3]).toEqual({ amount: 50, from_account_id: 'sim-acc-002', to_account_id: 'sim-acc-001' });
            // The gateway call did not throw → this is the "unexpected permit" branch,
            // proving a $50 request against a $100 cap actually succeeds once the
            // amount is real (the UX implication flagged for the controller).
            expect(result.status).toBe(200);
            expect(result.errorCode).toBe('unexpected_permit');
            resolve();
          })
          .catch(reject);
      });
    });
  });

  test('drift action with no requestedAmount still defaults to 500 (UC14 attack-sim backward compat)', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const denyErr = Object.assign(new Error('rar exceeded'), { code: 'rar_amount_exceeded', httpStatus: 403 });
        mockDeps({ callToolImpl: jest.fn().mockRejectedValue(denyErr) });
        const { runAttackSim: isolatedRunAttackSim } = require('../../services/attackSimulatorService');
        const { callToolViaGateway } = require('../../services/mcpGatewayClient');

        // No 3rd arg — mirrors routes/attackSimulator.js's existing call site exactly.
        isolatedRunAttackSim('rar-exceeded', req)
          .then((result) => {
            expect(callToolViaGateway).toHaveBeenCalledTimes(1);
            expect(callToolViaGateway.mock.calls[0][3]).toEqual({ amount: 500, from_account_id: 'sim-acc-002', to_account_id: 'sim-acc-001' });
            expect(result.status).toBe(403);
            expect(result.errorCode).toBe('rar_amount_exceeded');
            resolve();
          })
          .catch(reject);
      });
    });
  });
});

// ── RAR on the real path: PingOne Authorize is the PDP ───────────────────────
//
// RAR sims call callToolViaGateway(null, ...) — they no longer pin to the
// Demo Agent Gateway, they let it self-resolve whichever gateway is active
// (PingGateway by default). PingGateway forwards TraT's RarAuthorizationDetails
// (incl. RarMaxAmount) to PingOne Authorize, which is the sole RAR PDP on that
// path. The Node Demo Agent Gateway's local requireRarIntent (rarEnforce.ts)
// is an optional belt-and-suspenders PEP that only arms when PingGateway is
// OFF (ff_mcp_gateway_pinggateway === 'false') AND ff_rar_gateway_enforcement
// is ON — with PingGateway active, arming it would 403 the sim token before
// Authorize ever sees the request (insufficient_scope on the Node-shaped
// token), so _runRarExceeded deliberately skips it in that case.
describe('RAR sims: PingOne Authorize enforces via the active gateway (self-resolved, not pinned)', () => {
  const DEMO_GW = 'http://demo-gw.example:3005';
  const MOCKED_PATHS = [
    '../../services/configStore',
    '../../services/oauthService',
    '../../services/mcpGatewayClient',
    '../../routes/mcpGatewayConfig',
    '../../services/hitlServiceClient',
  ];
  let savedDemoGwEnv;

  beforeAll(() => {
    savedDemoGwEnv = process.env.MCP_DEMO_GATEWAY_URL;
    delete process.env.MCP_DEMO_GATEWAY_URL; // force the configStore path
  });
  afterAll(() => {
    if (savedDemoGwEnv !== undefined) process.env.MCP_DEMO_GATEWAY_URL = savedDemoGwEnv;
    // doMock registrations here are NOT wrapped in isolateModules (see below),
    // so clear them before the next describe block runs.
    MOCKED_PATHS.forEach((p) => {
      jest.dontMock(p);
    });
    jest.resetModules();
  });

  function fakeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url');
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${header}.${body}.sig`;
  }
  const FAKE_EXCHANGED_TOKEN = fakeJwt({ sub: 'user-1', aud: 'https://gateway.example/mcp' });

  // Unlike the Finding-1 suite, these tests must observe LAZY requires
  // (_pushGatewayFlags requires routes/mcpGatewayConfig and _runRarPermit
  // requires hitlServiceClient at call time, i.e. after an await). A
  // jest.isolateModules window closes when its sync callback returns, so those
  // late requires would resolve OUTSIDE it and miss the mocks. Plain
  // resetModules + doMock keeps the registrations active for the whole test.
  function mockPinnedDeps({ callToolImpl, gatewayEnforce = false, pinggatewayOn = true }) {
    jest.resetModules();
    jest.doMock('../../services/configStore', () => ({
      getEffective: jest.fn((key) => {
        if (key === 'ff_mcp_gateway_pinggateway') return pinggatewayOn ? 'true' : 'false';
        if (key === 'mcp_demo_gateway_url') return DEMO_GW;
        if (key === 'pingone_resource_mcp_gateway_uri') return 'https://gateway.example/mcp';
        // Gateway-local RAR enforcement is opt-in; default OFF → PingOne Authorize enforces.
        if (key === 'ff_rar_gateway_enforcement') return gatewayEnforce ? 'true' : 'false';
        if (key === 'pingone_ai_agent_actor_client_id') return 'actor-1';
        return '';
      }),
      setRaw: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../services/oauthService', () => ({
      performTokenExchange: jest.fn().mockResolvedValue(FAKE_EXCHANGED_TOKEN),
      performTokenExchangeAs: jest.fn().mockResolvedValue(FAKE_EXCHANGED_TOKEN),
    }));
    jest.doMock('../../services/mcpGatewayClient', () => ({
      callToolViaGateway: jest.fn(callToolImpl),
      // Real getMcpGatewayHttpUrl() resolves mcp_demo_gateway_url when PingGateway
      // is off — mirror that branch so _pushGatewayFlags's fallback (no explicit
      // gatewayUrl passed) targets DEMO_GW in the pinggatewayOn:false scenario.
      getMcpGatewayHttpUrl: jest.fn(() => (pinggatewayOn ? 'https://pinggateway.example' : DEMO_GW)),
    }));
    jest.doMock('../../routes/mcpGatewayConfig', () => ({
      pushGatewayAdminConfig: jest.fn().mockResolvedValue({ ok: true }),
    }));
    jest.doMock('../../services/hitlServiceClient', () => ({
      createChallenge: jest.fn().mockResolvedValue({ challengeId: 'hitl-1' }),
      respondToChallenge: jest.fn().mockResolvedValue({ ok: true }),
    }));
    return {
      run: require('../../services/attackSimulatorService').runIntentBindingDemo,
      callToolViaGateway: require('../../services/mcpGatewayClient').callToolViaGateway,
      pushGatewayAdminConfig: require('../../routes/mcpGatewayConfig').pushGatewayAdminConfig,
      createChallenge: require('../../services/hitlServiceClient').createChallenge,
    };
  }

  const req = {
    session: { oauthTokens: { accessToken: 'user-access-token' }, user: { sub: 'user-1' } },
  };

  test('drift: tool call self-resolves the active gateway (null pin); gateway NOT armed by default (PingOne Authorize enforces RAR)', async () => {
    const denyErr = Object.assign(new Error('rar exceeded'), { code: 'rar_amount_exceeded', httpStatus: 403 });
    const { run, callToolViaGateway, pushGatewayAdminConfig } =
      mockPinnedDeps({ callToolImpl: jest.fn().mockRejectedValue(denyErr) });

    const result = await run('drift', req, 500);
    expect(callToolViaGateway).toHaveBeenCalledTimes(1);
    // null → callToolViaGateway resolves whichever gateway is active itself.
    expect(callToolViaGateway.mock.calls[0][0]).toBe(null);
    // Default OFF: the gateway's local requireRarIntent is not armed — the RAR cap
    // is enforced by PingOne Authorize's RarMaxAmount rule instead.
    expect(pushGatewayAdminConfig).not.toHaveBeenCalledWith(DEMO_GW, { requireRarIntent: true });
    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('rar_amount_exceeded');
  });

  test('drift: with ff_rar_gateway_enforcement ON and PingGateway off, the Demo Agent Gateway IS armed (belt-and-suspenders)', async () => {
    const denyErr = Object.assign(new Error('rar exceeded'), { code: 'rar_amount_exceeded', httpStatus: 403 });
    // armGateway requires !usePingGateway — local requireRarIntent arming only
    // applies to the Demo Agent Gateway; when PingGateway is active, RAR
    // enforcement is P1AZ's call alone (see _runRarExceeded).
    const { run, pushGatewayAdminConfig } =
      mockPinnedDeps({ callToolImpl: jest.fn().mockRejectedValue(denyErr), gatewayEnforce: true, pinggatewayOn: false });

    const result = await run('drift', req, 500);
    expect(pushGatewayAdminConfig).toHaveBeenCalledWith(DEMO_GW, { requireRarIntent: true });
    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('rar_amount_exceeded');
  });

  test('permit: account discovery + transfer both self-resolve the active gateway (null pin) and a within-cap request PERMITs', async () => {
    const { run, callToolViaGateway, pushGatewayAdminConfig } =
      mockPinnedDeps({ callToolImpl: jest.fn().mockResolvedValue({ ok: true }) });

    const result = await run('permit', req, 80);
    // First call discovers the token's own accounts, second is the transfer —
    // both let callToolViaGateway resolve the active gateway itself.
    expect(callToolViaGateway).toHaveBeenCalledTimes(2);
    expect(callToolViaGateway.mock.calls[0][0]).toBe(null);
    expect(callToolViaGateway.mock.calls[0][2]).toBe('get_my_accounts');
    expect(callToolViaGateway.mock.calls[1][0]).toBe(null);
    expect(callToolViaGateway.mock.calls[1][2]).toBe('create_transfer');
    // Default OFF: gateway not armed; PingOne Authorize is the RAR enforcement point.
    expect(pushGatewayAdminConfig).not.toHaveBeenCalledWith(DEMO_GW, { requireRarIntent: true });
    expect(result.status).toBe(200);
    expect(result.errorCode).toBeNull();
  });

  test('permit: discovered account ids are used and a backend isError result is NOT reported as PERMIT', async () => {
    // callToolViaGateway resolves to { result, gwAuditTrail } — mock the real wrapper shape.
    const accountsPayload = { result: { structuredContent: { success: true, count: 2, accounts: [{ id: 'acc-real-1' }, { id: 'acc-real-2' }] } }, gwAuditTrail: null };
    const callToolImpl = jest.fn()
      .mockResolvedValueOnce(accountsPayload)
      .mockResolvedValueOnce({ result: { isError: true, content: [{ type: 'text', text: 'Error: Banking API error: From account not found' }] }, gwAuditTrail: null });
    const { run, callToolViaGateway } = mockPinnedDeps({ callToolImpl });

    const result = await run('permit', req, 80);
    expect(callToolViaGateway.mock.calls[1][3]).toMatchObject({
      amount: 80, from_account_id: 'acc-real-1', to_account_id: 'acc-real-2',
    });
    expect(result.status).toBe(502);
    expect(result.errorCode).toBe('backend_execution_failed');
  });

  test('permit: HITL pre-approval binds agent + BOTH account ids, and the receipt rides the transfer args', async () => {
    // The gateway's receipt verification (hitl-service verifyReceipt) rejects a
    // challenge missing agentId ("belongs to a different agent") or missing an
    // account id the retry args carry ("has no bound from_account_id") — an
    // under-bound challenge re-challenges the demo instead of PERMITting.
    const accountsPayload = { result: { structuredContent: { success: true, count: 2, accounts: [{ id: 'acc-real-1' }, { id: 'acc-real-2' }] } }, gwAuditTrail: null };
    const callToolImpl = jest.fn()
      .mockResolvedValueOnce(accountsPayload)
      .mockResolvedValueOnce({ result: { content: [{ type: 'text', text: 'ok' }] }, gwAuditTrail: null });
    const { run, callToolViaGateway, createChallenge } = mockPinnedDeps({ callToolImpl });

    const result = await run('permit', req, 80);
    expect(createChallenge).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'create_transfer',
      agentId: 'actor-1',
      context: expect.objectContaining({
        amount: 80,
        from_account_id: 'acc-real-1',
        to_account_id: 'acc-real-2',
      }),
    }));
    expect(callToolViaGateway.mock.calls[1][3]).toMatchObject({ _hitl_challenge_id: 'hitl-1' });
    expect(result.status).toBe(200);
  });
});

// ── Finding 2 (live-mode flag leak) + PAR config resolution ──────────────────
describe('POST /api/demo/intent-binding/run — live mode restores ff_authorize_real (Finding 2)', () => {
  function bootIsolatedApp({ runResult, runError, config = {}, parImpl }) {
    const cfg = {
      ff_use_cases_launcher: 'true',
      ff_authorize_real: 'false',
      ...config,
    };
    jest.doMock('../../services/configStore', () => ({
      getEffective: jest.fn((key) => (cfg[key] !== undefined ? cfg[key] : '')),
      setRaw: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../services/attackSimulatorService', () => ({
      runIntentBindingDemo: jest.fn(() => (runError ? Promise.reject(runError) : Promise.resolve(runResult))),
    }));
    jest.doMock('../../services/parService', () => {
      const isParRedirectUriMismatch = (msg) =>
        /redirect uri mismatch/i.test(String((msg && msg.message) || msg || ''));
      const pushAuthorizationRequest = jest.fn(
        parImpl
          || (() => Promise.resolve({
            requestUri: 'urn:ietf:params:oauth:request_uri:test',
            expiresIn: 60,
          })),
      );
      const pushAuthorizationRequestWithRedirectFallback = jest.fn(
        async (endpoint, clientId, clientSecret, payload, candidates) => {
          let lastErr = null;
          const tried = [];
          for (const redirect_uri of candidates || []) {
            tried.push(redirect_uri);
            try {
              const result = await pushAuthorizationRequest(
                endpoint,
                clientId,
                clientSecret,
                { ...payload, redirect_uri },
              );
              return {
                ...result,
                redirectUri: redirect_uri,
                triedRedirects: tried,
                usedFallback: tried.length > 1,
              };
            } catch (err) {
              lastErr = err;
              if (!isParRedirectUriMismatch(err)) throw err;
            }
          }
          throw lastErr || new Error('PAR push failed: Redirect URI mismatch');
        },
      );
      return {
        pushAuthorizationRequest,
        pushAuthorizationRequestWithRedirectFallback,
        isParRedirectUriMismatch,
      };
    });
    // Resolve PAR from env id the same way production does (configStore mock
    // above returns '' for pingone_environment_id unless cfg supplies it).
    jest.doMock('../../services/oauthEndpointResolver', () => ({
      getParEndpoint: jest.fn(() => {
        const envId = cfg.pingone_environment_id;
        if (!envId) return '';
        const region = cfg.pingone_region || 'com';
        return `https://auth.pingone.${region}/${envId}/as/par`;
      }),
    }));
    const express = require('express');
    const supertest = require('supertest');
    const intentBindingRouter = require('../../routes/intentBinding');
    const configStore = require('../../services/configStore');
    const {
      pushAuthorizationRequest,
      pushAuthorizationRequestWithRedirectFallback,
    } = require('../../services/parService');
    const app = express();
    app.use(express.json());
    app.use('/api/demo/intent-binding', intentBindingRouter);
    return {
      app,
      supertest,
      configStore,
      pushAuthorizationRequest,
      pushAuthorizationRequestWithRedirectFallback,
    };
  }

  test('live:true returns 503 when actor credentials missing', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const { app, supertest } = bootIsolatedApp({
          runResult: { sim: 'rar-permit', useCaseId: 'rar-intent-verified', status: 200, errorCode: null, reason: 'PERMIT', tokenChainEvents: [] },
          config: {
            pingone_environment_id: 'env-1',
            public_app_url: 'https://api.ping.demo:4000',
          },
        });
        supertest(app)
          .post('/api/demo/intent-binding/run')
          .send({ action: 'permit', requestedAmount: 50, live: true })
          .then((res) => {
            expect(res.status).toBe(503);
            expect(res.body.error).toBe('par_config_missing');
            resolve();
          })
          .catch(reject);
      });
    });
  });

  test('live:true pushes PAR with derived endpoint and actor redirect', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const { app, supertest, pushAuthorizationRequest } = bootIsolatedApp({
          runResult: { sim: 'rar-permit', status: 200, tokenChainEvents: [] },
          config: {
            pingone_environment_id: 'env-1',
            public_app_url: 'https://api.ping.demo:4000',
            pingone_ai_agent_actor_client_id: 'actor-client',
            pingone_ai_agent_actor_client_secret: 'actor-secret',
          },
        });
        supertest(app)
          .post('/api/demo/intent-binding/run')
          .send({ action: 'permit', requestedAmount: 80, live: true })
          .then((res) => {
            expect(res.status).toBe(200);
            expect(res.body.sim).toBe('par-permit');
            expect(res.body.requestUri).toBe('urn:ietf:params:oauth:request_uri:test');
            // Reel frames on the learning page replay this exchange — the
            // pushed form must be present and must never carry the secret.
            expect(res.body.parRequest.url).toBe('https://auth.pingone.com/env-1/as/par');
            expect(res.body.parRequest.form.client_secret).toBe('<redacted>');
            expect(res.body.parRequest.form.authorization_details[0].amount).toBe(80);
            expect(res.body.parResponse).toEqual({
              request_uri: 'urn:ietf:params:oauth:request_uri:test',
              expires_in: 60,
            });
            expect(pushAuthorizationRequest).toHaveBeenCalledWith(
              'https://auth.pingone.com/env-1/as/par',
              'actor-client',
              'actor-secret',
              expect.objectContaining({
                redirect_uri: 'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
              }),
            );
            resolve();
          })
          .catch(reject);
      });
    });
  });

  test('live:true $80 permit uses local.ping-devops PUBLIC_APP_URL redirect', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const { app, supertest, pushAuthorizationRequest } = bootIsolatedApp({
          runResult: { sim: 'rar-permit', status: 200, tokenChainEvents: [] },
          config: {
            pingone_environment_id: 'env-1',
            public_app_url: 'https://local.ping-devops.com:4000',
            pingone_ai_agent_actor_client_id: 'actor-client',
            pingone_ai_agent_actor_client_secret: 'actor-secret',
          },
        });
        supertest(app)
          .post('/api/demo/intent-binding/run')
          .send({ action: 'permit', requestedAmount: 80, live: true })
          .then((res) => {
            expect(res.status).toBe(200);
            expect(res.body.sim).toBe('par-permit');
            expect(res.body.errorCode).toBeNull();
            expect(pushAuthorizationRequest).toHaveBeenCalledWith(
              expect.any(String),
              'actor-client',
              'actor-secret',
              expect.objectContaining({
                redirect_uri: 'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback',
                authorization_details: [expect.objectContaining({ amount: 80 })],
              }),
            );
            resolve();
          })
          .catch(reject);
      });
    });
  });

  test('live:true falls back to api.ping.demo when local redirect mismatches', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const localUri = 'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback';
        const apiUri = 'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback';
        const { app, supertest, pushAuthorizationRequest } = bootIsolatedApp({
          runResult: { sim: 'rar-permit', status: 200, tokenChainEvents: [] },
          config: {
            pingone_environment_id: 'env-1',
            public_app_url: 'https://local.ping-devops.com:4000',
            pingone_ai_agent_actor_client_id: 'actor-client',
            pingone_ai_agent_actor_client_secret: 'actor-secret',
          },
          parImpl: (_ep, _id, _sec, payload) => {
            if (payload.redirect_uri === localUri) {
              return Promise.reject(new Error('PAR push failed: Redirect URI mismatch'));
            }
            return Promise.resolve({
              requestUri: 'urn:ietf:params:oauth:request_uri:fallback',
              expiresIn: 60,
            });
          },
        });
        supertest(app)
          .post('/api/demo/intent-binding/run')
          .send({ action: 'permit', requestedAmount: 80, live: true })
          .then((res) => {
            expect(res.status).toBe(200);
            expect(res.body.sim).toBe('par-permit');
            expect(res.body.redirectUri).toBe(apiUri);
            expect(res.body.tokenChainEvents.some((e) => e.id === 'par-redirect-fallback')).toBe(true);
            expect(pushAuthorizationRequest).toHaveBeenCalledTimes(2);
            resolve();
          })
          .catch(reject);
      });
    });
  });

  test('live:true classifies Redirect URI mismatch (par_redirect_uri_mismatch)', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const { app, supertest } = bootIsolatedApp({
          runResult: { sim: 'rar-permit', status: 200, tokenChainEvents: [] },
          config: {
            pingone_environment_id: 'env-1',
            public_app_url: 'https://local.ping-devops.com:4000',
            pingone_ai_agent_actor_client_id: 'actor-client',
            pingone_ai_agent_actor_client_secret: 'actor-secret',
          },
          parImpl: () => Promise.reject(new Error('PAR push failed: Redirect URI mismatch')),
        });
        supertest(app)
          .post('/api/demo/intent-binding/run')
          .send({ action: 'permit', requestedAmount: 80, live: true })
          .then((res) => {
            expect(res.status).toBe(200);
            expect(res.body.errorCode).toBe('par_redirect_uri_mismatch');
            expect(res.body.tokenChainEvents[0]).toMatchObject({ id: 'par-push', status: 'error' });
            expect(res.body.reason).toMatch(/local\.ping-devops\.com/);
            resolve();
          })
          .catch(reject);
      });
    });
  });

  test('live unset (false/absent) never touches ff_authorize_real', async () => {
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const { app, supertest, configStore } = bootIsolatedApp({
          runResult: { sim: 'rar-permit', useCaseId: 'rar-intent-verified', status: 200, errorCode: null, reason: 'PERMIT', tokenChainEvents: [] },
        });
        supertest(app)
          .post('/api/demo/intent-binding/run')
          .send({ action: 'permit', requestedAmount: 50 })
          .then((res) => {
            expect(res.status).toBe(200);
            expect(res.body.live).toBe(false);
            expect(configStore.setRaw).not.toHaveBeenCalled();
            resolve();
          })
          .catch(reject);
      });
    });
  });
});
