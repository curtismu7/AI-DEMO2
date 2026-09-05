'use strict';

// The comparison answers one question: does Privilege narrow what a key can SEE, or
// only what it may CALL? That only means something if both sides ask the same thing
// the same way, so the wire shape and the headers are what these tests pin.

jest.mock('../../services/llmFetch', () => ({ llmFetch: jest.fn() }));

const { llmFetch } = require('../../services/llmFetch');
const { compare, modelIds, DIRECT } = require('../../services/llmDirectCompare');

const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });

function routeByUrl(map) {
  llmFetch.mockImplementation((url) => {
    for (const [needle, res] of Object.entries(map)) {
      if (String(url).includes(needle)) return Promise.resolve(res);
    }
    return Promise.resolve(ok({}));
  });
}

const ARGS = {
  provider: 'anthropic',
  directKey: 'direct-key-for-tests',
  gatewayBase: 'https://gw.test',
  virtualKey: 'virtual-key-for-tests',
  model: 'claude-haiku-4-5-20251001',
  prompt: 'hi',
};

beforeEach(() => llmFetch.mockReset());

describe('modelIds', () => {
  it('reads either list shape and sorts, so two providers can be diffed', () => {
    expect(modelIds({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['a', 'b']);
    // Google returns "models/gemini-…"; the prefix would make every id look unique.
    expect(modelIds({ models: [{ name: 'models/gemini-2.0-flash' }] })).toEqual(['gemini-2.0-flash']);
    expect(modelIds(null)).toEqual([]);
  });
});

describe('compare', () => {
  it('asks both sides the same question, with each side authenticated its own way', async () => {
    routeByUrl({
      'api.anthropic.com/v1/models': ok({ data: [{ id: 'claude-a' }] }),
      'gw.test/llm/anthropic/v1/models': ok({ data: [{ id: 'claude-a' }] }),
      'api.anthropic.com/v1/messages': ok({ content: [{ text: 'Paris' }] }),
      'gw.test/llm/anthropic/v1/messages': ok({ content: [{ text: 'Paris' }] }),
    });

    const r = await compare(ARGS);

    const calls = llmFetch.mock.calls;
    const direct = calls.find(([u]) => String(u) === 'https://api.anthropic.com/v1/messages')[1];
    const gateway = calls.find(([u]) => String(u) === 'https://gw.test/llm/anthropic/v1/messages')[1];

    // Direct uses the provider's own scheme; the gateway takes the virtual key.
    expect(direct.headers['x-api-key']).toBe('direct-key-for-tests');
    expect(gateway.headers.Authorization).toBe('Bearer virtual-key-for-tests');
    // Same body both ways, or the comparison compares nothing.
    expect(direct.body).toBe(gateway.body);
    expect(r.completion.requestBody).toEqual({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  // Found live: without it the gateway's list 400s and the page reads "0 models",
  // which looks exactly like Privilege hiding the catalogue.
  it('sends anthropic-version on BOTH model lists, not just the completions', async () => {
    routeByUrl({ models: ok({ data: [] }) });

    await compare(ARGS);

    const modelCalls = llmFetch.mock.calls.filter(([u]) => String(u).endsWith('/models'));
    expect(modelCalls).toHaveLength(2);
    for (const [, init] of modelCalls) {
      expect(init.headers['anthropic-version']).toBe('2023-06-01');
    }
  });

  it('omits the version header for lanes that have no such thing', async () => {
    routeByUrl({ models: ok({ data: [] }) });
    await compare({ ...ARGS, provider: 'openai' });
    for (const [, init] of llmFetch.mock.calls) {
      expect(init.headers['anthropic-version']).toBeUndefined();
    }
  });

  it('reports identical lists as "constrains calling, not seeing"', async () => {
    routeByUrl({
      'api.anthropic.com/v1/models': ok({ data: [{ id: 'a' }, { id: 'b' }] }),
      'gw.test/llm/anthropic/v1/models': ok({ data: [{ id: 'b' }, { id: 'a' }] }),
    });

    const r = await compare(ARGS);

    expect(r.models.identical).toBe(true);
    expect(r.models.onlyDirect).toEqual([]);
  });

  it('names the models the gateway withholds', async () => {
    routeByUrl({
      'api.anthropic.com/v1/models': ok({ data: [{ id: 'a' }, { id: 'secret' }] }),
      'gw.test/llm/anthropic/v1/models': ok({ data: [{ id: 'a' }] }),
    });

    const r = await compare(ARGS);

    expect(r.models.identical).toBe(false);
    expect(r.models.onlyDirect).toEqual(['secret']);
  });

  // An empty direct list must never read as "the gateway hid everything".
  it('does not call an unauthenticated direct side identical to anything', async () => {
    routeByUrl({
      'api.anthropic.com': { ok: false, status: 401, text: async () => '{"error":{"message":"invalid x-api-key"}}' },
      'gw.test/llm/anthropic/v1/models': ok({ data: [] }),
    });

    const r = await compare(ARGS);

    expect(r.models.direct.status).toBe(401);
    expect(r.models.identical).toBe(false);
  });

  it('records a transport failure per side instead of losing the whole comparison', async () => {
    llmFetch.mockImplementation((url) => (String(url).includes('api.anthropic.com')
      ? Promise.reject(new Error('getaddrinfo ENOTFOUND'))
      : Promise.resolve(ok({ data: [{ id: 'a' }] }))));

    const r = await compare(ARGS);

    expect(r.models.direct.error).toMatch(/ENOTFOUND/);
    expect(r.models.gateway.count).toBe(1);
  });

  it('knows a direct endpoint for every lane the gateway offers', () => {
    expect(Object.keys(DIRECT).sort()).toEqual(['anthropic', 'google', 'openai']);
    // Anthropic has no /chat/completions of its own, so that lane compares on /messages.
    expect(DIRECT.anthropic.completionPath).toBe('/messages');
    expect(DIRECT.openai.completionPath).toBe('/chat/completions');
  });

  it('refuses a provider it has no direct endpoint for', async () => {
    await expect(compare({ ...ARGS, provider: 'nope' })).rejects.toMatchObject({ code: 'llm_no_direct' });
  });
});
