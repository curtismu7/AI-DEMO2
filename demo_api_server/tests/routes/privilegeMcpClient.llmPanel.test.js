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
  listModels: jest.fn(),
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
  proxy.listModels.mockReset();
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
  it('reports whether the server can run the direct side unaided', async () => {
    process.env.LLM_DIRECT_ANTHROPIC_KEY = 'server-side-direct-key';
    delete process.env.LLM_DIRECT_OPENAI_KEY;

    const res = await request(app()).get('/api/privilege-mcp/llm/config');

    const a = res.body.lanes.find((l) => l.provider === 'anthropic');
    const o = res.body.lanes.find((l) => l.provider === 'openai');
    expect(a.directKeyConfigured).toBe(true);
    expect(a.directKeyEnv).toBe('LLM_DIRECT_ANTHROPIC_KEY');
    expect(o.directKeyConfigured).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('server-side-direct-key');
  });

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

  // A model-allowlist probe (GET /llm/models below, run once per candidate)
  // needs to stay cheap whether or not the model turns out to be allowed.
  it('passes maxTokens through as the provider-facing max_tokens', async () => {
    proxy.callPrivilegeClaude.mockResolvedValue('ok');

    await post({ provider: 'anthropic', prompt: 'hi', model: 'claude-haiku-4-5-20251001', maxTokens: 1 });

    // objectContaining: the route also passes a `meta` transport-facts collector
    // (see "POST /llm/call transport facts" below) — this test only pins that
    // maxTokens reaches the lane as max_tokens, not the full options shape.
    expect(proxy.callPrivilegeClaude).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hi' }],
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001', max_tokens: 1 }),
    );
  });
});

// ── Model catalog (compare against the allowlist) ───────────────────────────
// The provider's own /models list is not filtered to what a virtual key can
// actually use — Privilege enforces that per chat-completions call, as a 403.
// This endpoint exists so a rejected model name reads as "not allowed for
// this key" rather than "unrecognized model", by showing it IS a real model.

describe('GET /llm/models', () => {
  function get(provider) {
    return request(app()).get('/api/privilege-mcp/llm/models').query({ provider });
  }

  it('returns the model ids from the provider catalog', async () => {
    proxy.listModels.mockResolvedValue({
      status: 200,
      ok: true,
      data: { object: 'list', data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] },
    });

    const res = await get('openai');

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(proxy.listModels).toHaveBeenCalledWith('openai');
  });

  it('falls back to the raw body when the catalog is not the expected shape', async () => {
    proxy.listModels.mockResolvedValue({ status: 401, ok: false, data: { error: { message: 'API key is invalid.' } } });

    const res = await get('anthropic');

    expect(res.status).toBe(200);
    expect(res.body.models).toBeNull();
    expect(res.body.raw).toMatchObject({ error: { message: 'API key is invalid.' } });
  });

  it('answers 503 when the provider is not configured', async () => {
    proxy.listModels.mockRejectedValue(new Error('PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE not configured'));

    const res = await get('google');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });

  it('rejects an unknown provider without calling anything', async () => {
    const res = await get('llama');

    expect(res.status).toBe(400);
    expect(proxy.listModels).not.toHaveBeenCalled();
  });
});

// ── /llm/raw: the gateway as a REST endpoint ────────────────────────────────
// This one interprets nothing. It exists so a human can see what the gateway
// really returns when the console's verdict looks wrong.

jest.mock('../../services/llmFetch', () => ({ llmFetch: jest.fn() }));
const { llmFetch } = require('../../services/llmFetch');

describe('POST /llm/raw', () => {
  const env = { ...process.env };
  const raw = (body) => request(app()).post('/api/privilege-mcp/llm/raw').send(body);

  beforeEach(() => {
    llmFetch.mockReset();
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'virtual-key-for-tests';
  });
  afterEach(() => { process.env = { ...env }; });

  it('sends the body verbatim to the chosen path and returns the raw response', async () => {
    llmFetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Paris' } }] }),
    });

    const res = await raw({
      provider: 'anthropic',
      path: '/llm/anthropic/v1/chat/completions',
      body: { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.status).toBe(200);
    expect(res.body.request.url).toBe('https://gw.test/llm/anthropic/v1/chat/completions');
    expect(res.body.response.status).toBe(200);
    expect(res.body.response.json.choices[0].message.content).toBe('Paris');
    // Verbatim: no max_tokens injected, no system extracted, nothing normalised.
    expect(JSON.parse(llmFetch.mock.calls[0][1].body)).toEqual({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  // An upstream 4xx is the ANSWER here, not this endpoint's failure — returning a
  // 4xx of our own would let the UI's error path swallow the body being asked for.
  it('returns 200 with the upstream status as data when the gateway refuses', async () => {
    llmFetch.mockResolvedValue({
      ok: false, status: 403,
      text: async () => JSON.stringify({ error: { message: 'model x not allowed for this key' } }),
    });

    const res = await raw({ provider: 'anthropic', body: { model: 'x' } });

    expect(res.status).toBe(200);
    expect(res.body.response.status).toBe(403);
    expect(res.body.response.json.error.message).toMatch(/not allowed for this key/);
  });

  it('masks the virtual key in the echoed request', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    const res = await raw({ provider: 'anthropic', body: { model: 'x' } });

    expect(res.body.request.headers.Authorization).toMatch(/^Bearer virtual-k•+ests$/);
    expect(JSON.stringify(res.body)).not.toContain('virtual-key-for-tests');
  });

  it('sends the anthropic-version header only on the anthropic lane', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    await raw({ provider: 'anthropic', body: { model: 'x' } });
    expect(llmFetch.mock.calls[0][1].headers['anthropic-version']).toBe('2023-06-01');
  });

  it.each([
    ['another host', 'https://evil.test/x'],
    ['an admin path', '/admin/keys'],
  ])('rejects %s without calling the gateway', async (_l, path) => {
    const res = await raw({ provider: 'anthropic', path, body: {} });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('llm_bad_route');
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it('rejects a non-object body rather than posting it', async () => {
    const res = await raw({ provider: 'anthropic', body: 'not json' });
    expect(res.status).toBe(400);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  // /v1/models is GET-only and takes no body — added for the combined LLM
  // Gateway page's path dropdown.
  it('sends a GET with no body when method is GET', async () => {
    llmFetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'claude-haiku-4-5-20251001' }] }),
    });

    const res = await raw({ provider: 'anthropic', path: '/llm/anthropic/v1/models', method: 'GET' });

    expect(res.status).toBe(200);
    expect(res.body.request.method).toBe('GET');
    expect(res.body.request.body).toBeUndefined();
    expect(llmFetch.mock.calls[0][1].method).toBe('GET');
    expect(llmFetch.mock.calls[0][1].body).toBeUndefined();
    // No Content-Type on a bodiless request.
    expect(llmFetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  it('rejects a body sent alongside method GET', async () => {
    const res = await raw({ provider: 'anthropic', path: '/llm/anthropic/v1/models', method: 'GET', body: { x: 1 } });
    expect(res.status).toBe(400);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it('rejects an unsupported method rather than forwarding it', async () => {
    const res = await raw({ provider: 'anthropic', method: 'DELETE', body: { model: 'x' } });
    expect(res.status).toBe(400);
    expect(llmFetch).not.toHaveBeenCalled();
  });

  it('still defaults to POST when method is omitted (existing callers unaffected)', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    await raw({ provider: 'anthropic', body: { model: 'x' } });
    expect(llmFetch.mock.calls[0][1].method).toBe('POST');
  });
});

// ── /llm/compare ────────────────────────────────────────────────────────────
jest.mock('../../services/llmDirectCompare', () => ({ compare: jest.fn() }));
const directCompare = require('../../services/llmDirectCompare');

describe('POST /llm/compare', () => {
  const env = { ...process.env };
  const cmp = (body) => request(app()).post('/api/privilege-mcp/llm/compare').send(body);

  beforeEach(() => {
    directCompare.compare.mockReset();
    directCompare.compare.mockResolvedValue({ provider: 'anthropic', models: {}, completion: {} });
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'virtual-key-for-tests';
  });
  afterEach(() => { process.env = { ...env }; });

  it('passes the operator key to the direct side and the virtual key to the gateway side', async () => {
    await cmp({ provider: 'anthropic', directKey: 'operator-supplied', model: 'm', prompt: 'hi' });

    expect(directCompare.compare).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      directKey: 'operator-supplied',
      virtualKey: 'virtual-key-for-tests',
      model: 'm',
      prompt: 'hi',
    }));
  });

  // The whole bargain of the paste-a-key field: used once, then gone.
  it('never echoes the operator key back', async () => {
    directCompare.compare.mockResolvedValue({ provider: 'anthropic', models: { direct: {} }, completion: {} });

    const res = await cmp({ provider: 'anthropic', directKey: 'operator-supplied' });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('operator-supplied');
  });

  it('refuses when neither the request nor the server has a direct key', async () => {
    delete process.env.LLM_DIRECT_ANTHROPIC_KEY;

    const res = await cmp({ provider: 'anthropic' });

    expect(res.status).toBe(400);
    // The message names the variable, so an operator knows what to set.
    expect(res.body.error).toMatch(/LLM_DIRECT_ANTHROPIC_KEY/);
    expect(directCompare.compare).not.toHaveBeenCalled();
  });

  it('uses the server key when no key was pasted', async () => {
    process.env.LLM_DIRECT_ANTHROPIC_KEY = 'server-side-direct-key';

    await cmp({ provider: 'anthropic' });

    expect(directCompare.compare).toHaveBeenCalledWith(
      expect.objectContaining({ directKey: 'server-side-direct-key' }),
    );
  });

  // So a different key can be tried without an .env edit and a restart.
  it('lets a pasted key override the server one', async () => {
    process.env.LLM_DIRECT_ANTHROPIC_KEY = 'server-side-direct-key';

    await cmp({ provider: 'anthropic', directKey: 'pasted-key' });

    expect(directCompare.compare).toHaveBeenCalledWith(
      expect.objectContaining({ directKey: 'pasted-key' }),
    );
  });

  // ANTHROPIC_API_KEY drives seven other services; the comparison must not reach for it.
  it('does not fall back to ANTHROPIC_API_KEY', async () => {
    delete process.env.LLM_DIRECT_ANTHROPIC_KEY;
    process.env.ANTHROPIC_API_KEY = 'the-app-wide-key';

    const res = await cmp({ provider: 'anthropic' });

    expect(res.status).toBe(400);
    expect(directCompare.compare).not.toHaveBeenCalled();
  });

  it('falls back to the lane default model when none is given', async () => {
    await cmp({ provider: 'anthropic', directKey: 'k' });
    expect(directCompare.compare).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    );
  });

  it('rejects an unknown provider', async () => {
    const res = await cmp({ provider: 'nope', directKey: 'k' });
    expect(res.status).toBe(400);
    expect(directCompare.compare).not.toHaveBeenCalled();
  });
});

// ── LM Studio: the local lane ───────────────────────────────────────────────
describe('LM Studio lane', () => {
  const env = { ...process.env };
  beforeEach(() => {
    llmFetch.mockReset();
    process.env.LMSTUDIO_BASE_URL = 'http://lmstudio.test:1234';
  });
  afterEach(() => { process.env = { ...env }; });

  it('advertises itself apart from the Privilege lanes', async () => {
    const res = await request(app()).get('/api/privilege-mcp/llm/config');

    expect(res.body.local.provider).toBe('lmstudio');
    expect(res.body.local.baseUrl).toBe('http://lmstudio.test:1234');
    // Measured: a small budget returns HTTP 200 with an empty string.
    expect(res.body.local.defaultMaxTokens).toBe(512);
    // It is NOT a Privilege lane — it must never appear among them.
    expect(res.body.lanes.map((l) => l.provider)).not.toContain('lmstudio');
  });

  it('lists the models LM Studio reports right now', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen3.8-27b' }, { id: 'gemma' }] }) });

    const res = await request(app()).get('/api/privilege-mcp/llm/models/lmstudio');

    expect(res.body.models).toEqual(['qwen3.8-27b', 'gemma']);
    expect(llmFetch.mock.calls[0][0]).toBe('http://lmstudio.test:1234/v1/models');
  });

  // Unreachable is the normal case when LM Studio is not running; an empty list
  // would read as "no models", which is a different problem entirely.
  it('names the address when LM Studio is unreachable', async () => {
    llmFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app()).get('/api/privilege-mcp/llm/models/lmstudio');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/http:\/\/lmstudio\.test:1234/);
  });

  it('posts the body verbatim and never involves a virtual key', async () => {
    llmFetch.mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Paris' } }] }),
    });

    const res = await request(app()).post('/api/privilege-mcp/llm/raw')
      .send({ provider: 'lmstudio', body: { model: 'qwen3.8-27b', messages: [], max_tokens: 512 } });

    expect(res.status).toBe(200);
    expect(res.body.request.url).toBe('http://lmstudio.test:1234/v1/chat/completions');
    expect(res.body.response.json.choices[0].message.content).toBe('Paris');
    // No gateway origin anywhere in the request it made.
    expect(JSON.stringify(res.body)).not.toContain('mcpgw');
    expect(res.body.request.headers.Authorization).toMatch(/•/);
  });

  it('still refuses a non-object body', async () => {
    const res = await request(app()).post('/api/privilege-mcp/llm/raw')
      .send({ provider: 'lmstudio', body: 'nope' });
    expect(res.status).toBe(400);
    expect(llmFetch).not.toHaveBeenCalled();
  });
});
