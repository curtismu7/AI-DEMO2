'use strict';

jest.mock('../../services/privilegeLlmProxyService', () => ({
  callPrivilegeGemini: jest.fn(),
}));

const saved = {};

// setup.js resets the module registry after each test — require inside.
function load() {
  const { callPrivilegeGemini } = require('../../services/privilegeLlmProxyService');
  const { check } = require('../../services/checks/privilegeLlmFirstCheck');
  return { callPrivilegeGemini, check };
}

describe('llm.privilege_first check', () => {
  beforeEach(() => {
    saved.url = process.env.PRIVILEGE_LLM_GATEWAY_URL;
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://mcpgw.example';
  });
  afterEach(() => {
    if (saved.url === undefined) delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    else process.env.PRIVILEGE_LLM_GATEWAY_URL = saved.url;
  });

  test('applies only when the flag is on', () => {
    const { check } = load();
    expect(check.appliesWhen({ ff_privilege_llm_first: true })).toBe(true);
    expect(check.appliesWhen({ ff_privilege_llm_first: false })).toBe(false);
  });

  test('pass when the lane answers', async () => {
    const { check, callPrivilegeGemini } = load();
    callPrivilegeGemini.mockResolvedValue('READY');
    expect((await check.run()).status).toBe('pass');
  });

  test('pass on a policy denial — the gate is live', async () => {
    const { check, callPrivilegeGemini } = load();
    callPrivilegeGemini.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'llm_policy_denied' }));
    const r = await check.run();
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/denied by policy/);
  });

  test('fail on a transport error', async () => {
    const { check, callPrivilegeGemini } = load();
    callPrivilegeGemini.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await check.run()).status).toBe('fail');
  });

  test('fail when the gateway URL is unset', async () => {
    const { check, callPrivilegeGemini } = load();
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    expect((await check.run()).status).toBe('fail');
    expect(callPrivilegeGemini).not.toHaveBeenCalled();
  });
});
