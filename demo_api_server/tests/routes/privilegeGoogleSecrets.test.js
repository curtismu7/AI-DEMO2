'use strict';

// privilegeGoogleSecrets route: the Privilege Hubs Google-secrets demo path.
// Contract under test:
//   - requireSession guards the endpoint (mocked open here; see the sibling
//     privilegeDecisionDemo spec for the session contract it shares)
//   - tool must be on the fixed allowlist (400 otherwise) — not a general MCP proxy
//   - args must be a plain JSON object, size-capped; reveal must be boolean
//   - a gateway 403 is reported as decision 'denied', by the gateway — a real
//     policy refusal, not an error
//   - a successful tools/call is relayed with secret-looking tokens MASKED in
//     both modes; the browser never receives the full raw credential
//   - 503 with a clear message when the agent key is not configured

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  requireSession: (req, res, next) => next(),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((name) => (name === 'PRIVILEGE_A2A_MAIN_AGENT_KEY' ? 'sk-orion-test-key' : undefined)),
}));

const { router, ALLOWED_TOOLS, maskSecrets } = require('../../routes/privilegeGoogleSecrets');

const FAKE_SECRET = 'AIzaSyD-1234567890abcdefghijklmnopqrstuvwx';

function sse(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function makeApp(fetchImpl) {
  global.fetch = jest.fn(fetchImpl);
  const app = express();
  app.use(express.json());
  app.use('/api/privilege-google-secrets', router);
  return app;
}

function gatewayMock(toolResultText) {
  return (url, init) => {
    if (String(init?.body).includes('"method":"initialize"')) {
      return Promise.resolve({
        ok: true, status: 200, headers: new Map([['mcp-session-id', 'sid-1']]), text: () => Promise.resolve(sse({ result: { protocolVersion: '2025-03-26' } })),
      });
    }
    return Promise.resolve({
      ok: true, status: 200, headers: new Map(), text: () => Promise.resolve(sse({ result: { content: [{ type: 'text', text: toolResultText }], isError: false } })),
    });
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('POST /api/privilege-google-secrets/fetch', () => {
  it('exposes the allowlist', () => {
    expect(ALLOWED_TOOLS.has('get_google_secret')).toBe(true);
    expect(ALLOWED_TOOLS.has('get_google_billing_secret')).toBe(true);
  });

  it('refuses a tool that is not on the allowlist', async () => {
    const app = makeApp(() => { throw new Error('fetch must not be called'); });
    const res = await request(app).post('/api/privilege-google-secrets/fetch').send({ tool: 'read_anything' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowlist/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses non-object args and non-boolean reveal', async () => {
    const app = makeApp(() => { throw new Error('fetch must not be called'); });
    const res = await request(app).post('/api/privilege-google-secrets/fetch').send({ tool: 'get_google_secret', args: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON object/);
    const res2 = await request(app).post('/api/privilege-google-secrets/fetch').send({ tool: 'get_google_secret', reveal: 'yes' });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/boolean/);
  });

  it('reports a gateway 403 as decision denied, not an error', async () => {
    const app = makeApp((url, init) => {
      if (String(init?.body).includes('"method":"initialize"')) {
        return Promise.resolve({
          ok: true, status: 200, headers: new Map([['mcp-session-id', 'sid-1']]), text: () => Promise.resolve(sse({ result: { protocolVersion: '2025-03-26' } })),
        });
      }
      return Promise.resolve({ ok: false, status: 403, headers: new Map(), text: () => Promise.resolve('policy denied') });
    });
    const res = await request(app).post('/api/privilege-google-secrets/fetch')
      .send({ tool: 'get_google_billing_secret', args: { secret: 'projects/demo/secrets/google-billing-credential' } });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('denied');
    expect(res.body.by).toBe('privilege-gateway');
    expect(res.body.status).toBe(403);
  });

  it('masks secret-looking tokens in the relayed result', async () => {
    const app = makeApp(gatewayMock(`{"credential":"${FAKE_SECRET}"}`));
    const res = await request(app).post('/api/privilege-google-secrets/fetch')
      .send({ tool: 'get_google_secret', args: { secret: 'projects/demo/secrets/google-agent-credential' } });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('allowed');
    expect(res.body.upstream).not.toContain(FAKE_SECRET);
    expect(res.body.upstream).toMatch(/\[MASKED:/);
  });

  it('503s with a clear message when the agent key is not configured', async () => {
    const app = await new Promise((resolveApp) => {
      jest.isolateModules(() => {
        jest.doMock('../../services/configStore', () => ({ getEffective: () => undefined }));
        const { router: isolatedRouter } = require('../../routes/privilegeGoogleSecrets');
        const a = express();
        a.use(express.json());
        a.use('/api/privilege-google-secrets', isolatedRouter);
        resolveApp(a);
      });
    });
    delete process.env.PRIVILEGE_A2A_MAIN_AGENT_KEY;
    const res = await request(app).post('/api/privilege-google-secrets/fetch').send({ tool: 'get_google_secret', args: {} });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/agent key is not configured/);
  });
});

describe('maskSecrets', () => {
  it('keeps a tail but hides the body of long tokens', () => {
    const out = maskSecrets(`secret is ${FAKE_SECRET}`);
    expect(out).not.toContain(FAKE_SECRET);
    expect(out).toMatch(/•{8}/);
  });

  it('masks bearer tokens', () => {
    expect(maskSecrets('Bearer sk-abc123def456ghi789')).toBe('Bearer [MASKED]');
  });
});
