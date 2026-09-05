'use strict';

// A Privilege policy denial is the DEMO, not an error state. It gets its own
// status and its own code so the panel can render it as "Privilege stopped
// this" rather than as a broken feature.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/privilegeLlmProxyService', () => ({
  // Only the network calls are faked. LANES and resolveRoute stay REAL so this
  // suite proves the router serves the routes the service actually calls, and
  // enforces the same override validation — a stubbed lane table would let the
  // two drift apart, which is the bug this consolidation removes.
  ...jest.requireActual('../../services/privilegeLlmProxyService'),
  callPrivilegeGemini: jest.fn(),
  callPrivilegeClaude: jest.fn(),
  callPrivilegeOpenAI: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const session = require('express-session');

const proxy = require('../../services/privilegeLlmProxyService');
const router = require('../../routes/privilegeMcpClient');

function app() {
  return express()
    .use(session({ secret: 't', resave: false, saveUninitialized: true }))
    .use('/api/privilege-mcp', router);
}

function post(body) {
  return request(app()).post('/api/privilege-mcp/llm/call').send(body);
}

beforeEach(() => {
  proxy.callPrivilegeClaude.mockReset();
  proxy.callPrivilegeGemini.mockReset();
  proxy.callPrivilegeOpenAI.mockReset();
});

describe('POST /llm/call', () => {
  it.each([
    ['anthropic', 'callPrivilegeClaude', '/llm/anthropic/v1/messages'],
    ['google', 'callPrivilegeGemini', '/llm/google/v1/chat/completions'],
    ['openai', 'callPrivilegeOpenAI', '/llm/openai/v1/chat/completions'],
  ])('routes %s to the right lane and reports the route used', async (provider, fn, route) => {
    proxy[fn].mockResolvedValue('the answer');

    const res = await post({ provider, prompt: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('the answer');
    expect(res.body.provider).toBe(provider);
    // The panel shows the gateway route — that is what makes the demo legible.
    expect(res.body.route).toBe(route);
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('answers a policy denial with 403 and a structured reason, not a 500', async () => {
    const err = new Error('blocked by policy: no PII');
    err.code = 'llm_policy_denied';
    err.reason = 'blocked by policy: no PII';
    err.provider = 'anthropic';
    proxy.callPrivilegeClaude.mockRejectedValue(err);

    const res = await post({ provider: 'anthropic', prompt: 'my SSN is 123' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('llm_policy_denied');
    expect(res.body.reason).toMatch(/no PII/);
    expect(res.body.provider).toBe('anthropic');
    // BFF error shape: `error`, never `message`.
    expect(typeof res.body.error).toBe('string');
    expect(res.body.message).toBeUndefined();
  });

  it('answers 503 when the provider is not configured', async () => {
    proxy.callPrivilegeOpenAI.mockRejectedValue(
      new Error('PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured'),
    );

    const res = await post({ provider: 'openai', prompt: 'hi' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });

  it('rejects an unknown provider without calling anything', async () => {
    const res = await post({ provider: 'llama', prompt: 'hi' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
    expect(proxy.callPrivilegeClaude).not.toHaveBeenCalled();
    expect(proxy.callPrivilegeGemini).not.toHaveBeenCalled();
    expect(proxy.callPrivilegeOpenAI).not.toHaveBeenCalled();
  });

  it.each([[''], ['   '], [undefined]])('rejects an empty prompt (%p)', async (prompt) => {
    const res = await post({ provider: 'anthropic', prompt });

    expect(res.status).toBe(400);
    expect(proxy.callPrivilegeClaude).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected failure as 502 rather than crashing the route', async () => {
    proxy.callPrivilegeClaude.mockRejectedValue(new Error('socket hang up'));

    const res = await post({ provider: 'anthropic', prompt: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/socket hang up/);
  });
});

// ── Per-lane probe surface ───────────────────────────────────────────────────
// The panel lets an operator retarget a lane's path and model and test it, which
// is how you tell "Privilege denied it" from "the provider key behind the virtual
// key is dead" without reaching for curl.

describe('GET /llm/config', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('reports each lane so the panel prefills what the SERVER calls', async () => {
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    const res = await request(app()).get('/api/privilege-mcp/llm/config');

    expect(res.status).toBe(200);
    expect(res.body.gatewayUrl).toBe('https://gw.test');
    expect(res.body.lanes.map((l) => l.provider).sort()).toEqual(['anthropic', 'google', 'openai']);
    const anthropic = res.body.lanes.find((l) => l.provider === 'anthropic');
    expect(anthropic.route).toBe('/llm/anthropic/v1/messages');
    expect(anthropic.model).toBeTruthy();
  });

  // The virtual key is the one thing that must never reach the browser — the whole
  // point of the indirection is that the provider key stays server-side.
  it('reports only WHETHER a key is set, never the key', async () => {
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'sk-orion-supersecret';
    delete process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI;

    const res = await request(app()).get('/api/privilege-mcp/llm/config');

    const anthropic = res.body.lanes.find((l) => l.provider === 'anthropic');
    const openai = res.body.lanes.find((l) => l.provider === 'openai');
    expect(anthropic.keyConfigured).toBe(true);
    expect(openai.keyConfigured).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('supersecret');
  });
});

describe('POST /llm/call overrides', () => {
  it('passes a valid route and model through to the lane', async () => {
    proxy.callPrivilegeClaude.mockResolvedValue('ok');

    const res = await post({
      provider: 'anthropic',
      prompt: 'hi',
      route: '/llm/anthropic/v1/chat/completions',
      model: 'claude-opus-5',
    });

    expect(res.status).toBe(200);
    // The route REPORTED back is the overridden one, not the lane default —
    // otherwise the panel would show a path the call did not use.
    expect(res.body.route).toBe('/llm/anthropic/v1/chat/completions');
    // objectContaining, not an exact match: the route also passes a `meta`
    // collector the console needs. What this test pins is that the override
    // reaches the lane, not the full shape of the options bag.
    expect(proxy.callPrivilegeClaude).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      expect.objectContaining({ route: '/llm/anthropic/v1/chat/completions', model: 'claude-opus-5' }),
    );
  });

  it.each([
    ['another host', 'https://evil.test/steal'],
    ['an admin path', '/admin/keys'],
    ['traversal', '/llm/anthropic/v1/../../admin'],
  ])('rejects %s as a 400 without calling the provider', async (_label, route) => {
    const res = await post({ provider: 'anthropic', prompt: 'hi', route });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('llm_bad_route');
    expect(proxy.callPrivilegeClaude).not.toHaveBeenCalled();
  });

  it('falls back to the lane default when no override is sent', async () => {
    proxy.callPrivilegeClaude.mockResolvedValue('ok');

    const res = await post({ provider: 'anthropic', prompt: 'hi' });

    expect(res.body.route).toBe('/llm/anthropic/v1/messages');
    const [, opts] = proxy.callPrivilegeClaude.mock.calls[0];
    expect(opts.route).toBeUndefined();
    expect(opts.model).toBeUndefined();
  });
});

// ── Console transport facts ─────────────────────────────────────────────────
// The LLM Gateway console leads with "did this reach the model?", because that is
// the difference between Privilege doing its job and a dead provider credential.
// The route must report it on all three outcomes, not just the happy one.

describe('POST /llm/call transport facts', () => {
  it('reports reachedProvider true and the provider limits on a reply', async () => {
    proxy.callPrivilegeClaude.mockImplementation(async (_m, config) => {
      // The service fills the caller's meta with what the response headers carried.
      if (config && config.meta) config.meta.limits = { requestsLimit: 10000, requestsRemaining: 9999 };
      return 'ok';
    });

    const res = await post({ provider: 'anthropic', prompt: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body.reachedProvider).toBe(true);
    expect(res.body.providerLimits).toEqual({ requestsLimit: 10000, requestsRemaining: 9999 });
  });

  // The claim the console makes on a denial: nothing was sent, nothing was billed.
  it('reports reachedProvider false on a policy denial', async () => {
    const denial = new Error('blocked');
    denial.code = 'llm_policy_denied';
    denial.reason = 'no PII';
    denial.provider = 'anthropic';
    proxy.callPrivilegeClaude.mockRejectedValue(denial);

    const res = await post({ provider: 'anthropic', prompt: 'hi' });

    expect(res.status).toBe(403);
    expect(res.body.reachedProvider).toBe(false);
  });

  // The opposite diagnosis, and the pair is indistinguishable without this flag.
  it('reports reachedProvider true when the provider itself refused', async () => {
    proxy.callPrivilegeClaude.mockRejectedValue(
      new Error('Privilege LLM proxy (anthropic) 401: API key is invalid.'),
    );

    const res = await post({ provider: 'anthropic', prompt: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.reachedProvider).toBe(true);
    expect(res.body.route).toBe('/llm/anthropic/v1/messages');
  });
});
