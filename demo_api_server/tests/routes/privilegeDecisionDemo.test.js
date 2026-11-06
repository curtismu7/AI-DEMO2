'use strict';

// privilegeDecisionDemo route: the live-Privilege decision path for the five
// platform-update pages. Contract under test:
//   - requireSession guards the endpoint (no session → 401)
//   - tool must be on the fixed allowlist (400 otherwise) — this endpoint is
//     not a general MCP proxy
//   - args must be a plain JSON object, size-capped
//   - a gateway 403 is reported as decision 'denied', by the gateway, not an
//     error — that IS the demo's point (a real policy decision)
//   - a successful tools/call relays the tool's text and latency

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  requireSession: (req, res, next) => next(),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((name) => (name === 'PRIVILEGE_A2A_MAIN_AGENT_KEY' ? 'sk-orion-test-key' : undefined)),
}));

const { router, ALLOWED_TOOLS, GATEWAY_URL } = require('../../routes/privilegeDecisionDemo');

function sse(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function makeApp(fetchImpl) {
  global.fetch = jest.fn(fetchImpl);
  const app = express();
  app.use(express.json());
  app.use('/api/privilege', router);
  return app;
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('POST /api/privilege/decision', () => {
  it('exposes the allowlist and the proven gateway URL', () => {
    expect(ALLOWED_TOOLS.has('list_entitlements')).toBe(true);
    expect(ALLOWED_TOOLS.has('sensitive_patient_records')).toBe(true);
    expect(GATEWAY_URL).toMatch(/applications\.procyon\.ai:8643\/mcp$/);
  });

  it('refuses a tool that is not on the allowlist', async () => {
    const app = makeApp(() => { throw new Error('fetch must not be called'); });
    const res = await request(app).post('/api/privilege/decision').send({ tool: 'rm_rf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/allowlist/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses non-object args', async () => {
    const app = makeApp(() => { throw new Error('fetch must not be called'); });
    const res = await request(app).post('/api/privilege/decision').send({ tool: 'list_entitlements', args: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON object/);
  });

  it('refuses oversized args without calling the gateway', async () => {
    const app = makeApp(() => { throw new Error('fetch must not be called'); });
    const res = await request(app).post('/api/privilege/decision')
      .send({ tool: 'list_entitlements', args: { user: 'x'.repeat(3000) } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/);
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
    const res = await request(app).post('/api/privilege/decision').send({ tool: 'list_entitlements', args: { user: 'alice' } });
    require('fs').writeFileSync('/tmp/dbg403.json', JSON.stringify({status:res.status, body:res.body}));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.decision).toBe('denied');
    expect(res.body.by).toBe('privilege-gateway');
    expect(res.body.status).toBe(403);
  });

  it('relays a successful tools/call result and latency', async () => {
    const app = makeApp((url, init) => {
      if (String(init?.body).includes('"method":"initialize"')) {
        return Promise.resolve({
          ok: true, status: 200, headers: new Map([['mcp-session-id', 'sid-1']]), text: () => Promise.resolve(sse({ result: { protocolVersion: '2025-03-26' } })),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Map(), text: () => Promise.resolve(sse({ result: { content: [{ type: 'text', text: '{"user":{"id":"alice","found":true}}' }], isError: false } })),
      });
    });
    const res = await request(app).post('/api/privilege/decision').send({ tool: 'list_entitlements', args: { user: 'alice' } });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('allowed');
    expect(JSON.parse(res.body.upstream).user.found).toBe(true);
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('503s with a clear message when the agent key is not configured', async () => {
    // Isolated registry: configStore with no key, then require the route fresh
    // so its module-level configStore binding is the empty one.
    const app = await new Promise((resolveApp) => {
      jest.isolateModules(() => {
        jest.doMock('../../services/configStore', () => ({ getEffective: () => undefined }));
        const { router: isolatedRouter } = require('../../routes/privilegeDecisionDemo');
        const a = express();
        a.use(express.json());
        a.use('/api/privilege', isolatedRouter);
        resolveApp(a);
      });
    });
    delete process.env.PRIVILEGE_A2A_MAIN_AGENT_KEY;
    const res = await request(app).post('/api/privilege/decision').send({ tool: 'list_entitlements', args: {} });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/agent key is not configured/);
  });
});
