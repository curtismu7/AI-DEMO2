'use strict';

// LANES is the single source of truth for the three gateway routes, and the panel
// prints what it says. The duplicate that used to live in privilegeMcpClient.js was
// display-only, so the UI could confidently show a path the code no longer called.
//
// resolveRoute is a trust boundary: the override reaches it from the browser, and
// the server attaches a virtual key to whatever URL comes out. It may steer the
// PATH on the gateway the server already chose, and nothing else.

jest.mock('../../services/llmFetch', () => ({ llmFetch: jest.fn() }));

const { llmFetch } = require('../../services/llmFetch');
const svc = require('../../services/privilegeLlmProxyService');

describe('LANES', () => {
  it('carries a route, a default model and a key env var for all three providers', () => {
    expect(Object.keys(svc.LANES).sort()).toEqual(['anthropic', 'google', 'openai']);
    for (const [name, lane] of Object.entries(svc.LANES)) {
      expect(lane.route).toMatch(/^\/llm\/[a-z]+\/v1\//);
      expect(lane.defaultModel).toBeTruthy();
      expect(lane.keyEnv).toBe(`PRIVILEGE_LLM_VIRTUAL_KEY_${name.toUpperCase()}`);
    }
  });

  it('keeps anthropic on the native Messages route', () => {
    // Verified live 2026-09-05: the gateway serves BOTH this and
    // /llm/anthropic/v1/chat/completions. Changing the default is not a bug fix.
    expect(svc.LANES.anthropic.route).toBe('/llm/anthropic/v1/messages');
    expect(svc.LANES.google.route).toBe('/llm/google/v1/chat/completions');
    expect(svc.LANES.openai.route).toBe('/llm/openai/v1/chat/completions');
  });
});

describe('resolveRoute', () => {
  it('falls back to the lane default when no override is given', () => {
    for (const empty of [undefined, null, '']) {
      expect(svc.resolveRoute('anthropic', empty)).toBe('/llm/anthropic/v1/messages');
    }
  });

  it('accepts another real route on the same gateway', () => {
    expect(svc.resolveRoute('anthropic', '/llm/anthropic/v1/chat/completions')).toBe(
      '/llm/anthropic/v1/chat/completions',
    );
  });

  // The whole reason the override is validated rather than passed through.
  it.each([
    ['an absolute URL to another host', 'https://evil.test/steal'],
    ['a protocol-relative URL', '//evil.test/steal'],
    ['path traversal', '/llm/anthropic/v1/../../../admin'],
    ['a path outside /llm', '/etc/passwd'],
    ['an admin path on the same host', '/admin/keys'],
    ['uppercase smuggling', '/LLM/anthropic/v1/messages'],
    ['a query string', '/llm/anthropic/v1/messages?x=1'],
  ])('rejects %s', (_label, bad) => {
    expect(() => svc.resolveRoute('anthropic', bad)).toThrow(/Invalid route/);
    try {
      svc.resolveRoute('anthropic', bad);
    } catch (e) {
      expect(e.code).toBe('llm_bad_route');
    }
  });

  it('rejects an over-long route rather than forwarding it', () => {
    expect(() => svc.resolveRoute('anthropic', `/llm/anthropic/v1/${'a'.repeat(200)}`)).toThrow(
      /Invalid route/,
    );
  });
});

describe('route override reaches the wire', () => {
  const env = { ...process.env };
  beforeEach(() => {
    llmFetch.mockReset();
    llmFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'ok' }], choices: [{ message: { content: 'ok' } }] }),
    });
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk';
  });
  afterEach(() => { process.env = { ...env }; });

  it('uses the override path but keeps the server-owned origin', async () => {
    await svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }], {
      route: '/llm/anthropic/v1/chat/completions',
    });
    expect(llmFetch.mock.calls[0][0]).toBe('https://gw.test/llm/anthropic/v1/chat/completions');
  });

  it('never lets an override change the host', async () => {
    await expect(
      svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }], { route: 'https://evil.test/x' }),
    ).rejects.toThrow(/Invalid route/);
    expect(llmFetch).not.toHaveBeenCalled();
  });
});

describe('readProviderLimits', () => {
  const withHeaders = (h) => ({ headers: { get: (k) => (k in h ? h[k] : null) } });

  it('reads the rate headers the gateway passes through', () => {
    const limits = svc.readProviderLimits(withHeaders({
      'x-ratelimit-limit-requests': '10000',
      'x-ratelimit-remaining-requests': '9999',
      'x-ratelimit-limit-tokens': '200000',
      'x-ratelimit-remaining-tokens': '199997',
      'x-ratelimit-reset-requests': '8.64s',
    }));

    expect(limits).toMatchObject({
      requestsLimit: 10000,
      requestsRemaining: 9999,
      tokensLimit: 200000,
      tokensRemaining: 199997,
      resetRequests: '8.64s',
    });
  });

  // No headers must read as "unknown", never as zero — a meter showing 0 of 0
  // would claim a cap was measured and exhausted when nothing was measured.
  it('returns null when the response carried no rate headers', () => {
    expect(svc.readProviderLimits(withHeaders({}))).toBeNull();
  });
});
