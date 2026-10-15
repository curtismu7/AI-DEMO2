'use strict';

const { warmOnce, buildPrefix } = require('../services/llamaWarmup');

const quiet = { log: { log: () => {} } };
const up = async () => ({ ok: true });
const prefix = () => ({ tools: [{ name: 't' }], systemPrompt: 'SYS' });

describe('llama warm-up', () => {
  it('does nothing when llama.cpp is not configured', async () => {
    const reason = jest.fn();
    expect(await warmOnce({ env: {}, reason, ...quiet })).toEqual({ warmed: false, why: 'no_llamacpp' });
    expect(reason).not.toHaveBeenCalled();
  });

  it('does not touch a tier that is down or unreachable (the tiers swap, so poking one would start it)', async () => {
    const reason = jest.fn();
    const env = { LLAMACPP_BASE_URL: 'http://llm-proxy:8090' };
    expect((await warmOnce({ env, fetchFn: async () => ({ ok: false }), reason, ...quiet })).why).toBe('tier_down');
    expect((await warmOnce({ env, fetchFn: async () => { throw new Error('ECONNREFUSED'); }, reason, ...quiet })).why).toBe('tier_unreachable');
    expect(reason).not.toHaveBeenCalled();
  });

  it('sends one model call with the vertical prefix, never executing a tool', async () => {
    const reason = jest.fn(async (params) => { await params.executeTool('x', {}); return { ok: true }; });
    const urls = [];
    const result = await warmOnce({
      env: { LLAMACPP_BASE_URL: 'http://llm-proxy:8090/v1', LLAMACPP_MODEL: 'gpt-oss-20b' },
      fetchFn: async (url) => { urls.push(url); return { ok: true }; },
      reason, prefix, ...quiet,
    });
    expect(urls).toEqual(['http://llm-proxy:8090/health']);
    expect(result.warmed).toBe(true);
    expect(reason).toHaveBeenCalledTimes(1);
    expect(reason.mock.calls[0][0]).toMatchObject({ provider: 'llamacpp', model: 'gpt-oss-20b', systemPrompt: 'SYS', maxIterations: 1, tools: [{ name: 't' }] });
  });

  it('reports a failed model call instead of throwing', async () => {
    const result = await warmOnce({ env: { LLAMACPP_BASE_URL: 'http://x' }, fetchFn: up, reason: async () => ({ ok: false }), prefix, ...quiet });
    expect(result.warmed).toBe(false);
  });

  it('builds the same airlines tools a real Dot call offers', () => {
    const { tools, systemPrompt } = buildPrefix('airlines');
    expect(tools.length).toBeGreaterThan(5);
    expect(typeof systemPrompt).toBe('string');
  });
});
