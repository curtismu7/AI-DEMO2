'use strict';

const { llamaCppTarget, privilegeLlmConfigured } = require('../services/privilegeLlmTarget');

const DIRECT = { base: 'http://llm-proxy:8090', route: '/v1/chat/completions' };
const ENV = { PRIVILEGE_LLM_GATEWAY_URL: 'https://gw.example/', PRIVILEGE_LLM_VIRTUAL_KEY_CUSTOM: 'sk-test' };

describe('llamaCppTarget', () => {
  it('direct (the default) keeps today\'s unmediated llama.cpp call: no auth, caller\'s model', () => {
    const t = llamaCppTarget({ direct: DIRECT, model: 'm1', env: {} });
    expect(t).toEqual({ via: 'direct', url: 'http://llm-proxy:8090/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, model: 'm1' });
  });

  it('via Privilege calls the custom lane on the gateway with the virtual key and the lane\'s default model', () => {
    const t = llamaCppTarget({ viaPrivilege: true, direct: DIRECT, env: ENV });
    expect(t.via).toBe('privilege');
    expect(t.url).toBe('https://gw.example/llm/custom/v1/chat/completions');
    expect(t.headers.Authorization).toBe('Bearer sk-test');
    expect(typeof t.model).toBe('string');
    expect(t.model.length).toBeGreaterThan(0);
  });

  it('an explicit model wins on the Privilege path', () => {
    expect(llamaCppTarget({ viaPrivilege: true, direct: DIRECT, env: ENV, model: 'gpt-4o-mini' }).model).toBe('gpt-4o-mini');
  });

  it('fails clearly, never silently falling back to direct, when Privilege is asked for but not configured', () => {
    expect(() => llamaCppTarget({ viaPrivilege: true, direct: DIRECT, env: {} })).toThrow(/PRIVILEGE_LLM_GATEWAY_URL/);
    expect(() => llamaCppTarget({ viaPrivilege: true, direct: DIRECT, env: { PRIVILEGE_LLM_GATEWAY_URL: 'https://gw.example' } })).toThrow(/PRIVILEGE_LLM_VIRTUAL_KEY_CUSTOM/);
  });

  it('a route override may only steer the path to a gateway LLM route shape', () => {
    expect(llamaCppTarget({ viaPrivilege: true, direct: DIRECT, env: ENV, route: '/llm/custom/v1/chat/completions' }).url).toContain('/llm/custom/v1/');
    expect(() => llamaCppTarget({ viaPrivilege: true, direct: DIRECT, env: ENV, route: '/admin/secrets' })).toThrow(/Invalid route/);
  });
});

describe('privilegeLlmConfigured', () => {
  it('is true only with both the gateway URL and the custom-lane key', () => {
    expect(privilegeLlmConfigured(ENV)).toBe(true);
    expect(privilegeLlmConfigured({ PRIVILEGE_LLM_GATEWAY_URL: 'https://gw.example' })).toBe(false);
    expect(privilegeLlmConfigured({ PRIVILEGE_LLM_VIRTUAL_KEY_CUSTOM: 'sk-test' })).toBe(false);
    expect(privilegeLlmConfigured({})).toBe(false);
  });
});
