'use strict';

// The OpenAI lane must behave exactly like the other two at the contract level:
// same llm_policy_denied code on a policy denial, same named failure when a key
// is missing. It differs only in wire shape — OpenAI-compatible, like the
// Google lane, NOT the Anthropic one (no anthropic-version header, `system`
// stays a message role, reply at choices[0].message.content).

jest.mock('../../services/llmFetch', () => ({ llmFetch: jest.fn() }));

const { llmFetch } = require('../../services/llmFetch');
const svc = require('../../services/privilegeLlmProxyService');

const OK = {
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'hello from openai' } }] }),
};

describe('callPrivilegeOpenAI', () => {
  const env = { ...process.env };

  beforeEach(() => {
    llmFetch.mockReset();
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI = 'vk-openai';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('posts to the OpenAI-compatible route with the virtual key', async () => {
    llmFetch.mockResolvedValue(OK);

    const text = await svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }]);

    expect(text).toBe('hello from openai');
    const [url, init] = llmFetch.mock.calls[0];
    expect(url).toBe('https://gw.test/llm/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer vk-openai');
    // OpenAI-compatible, not Anthropic: no anthropic-version header.
    expect(init.headers['anthropic-version']).toBeUndefined();
  });

  it('keeps a trailing slash on the gateway URL from doubling the path', async () => {
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test/';
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }]);

    expect(llmFetch.mock.calls[0][0]).toBe('https://gw.test/llm/openai/v1/chat/completions');
  });

  it('sends system as a message role, not a top-level field', async () => {
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeOpenAI([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);

    const body = JSON.parse(llmFetch.mock.calls[0][1].body);
    expect(body.system).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be terse' });
  });

  // The security story: a denial is a structured, attributable outcome, not a
  // generic error the UI renders as a failure.
  // Both statuses still deny when the body is the GATEWAY's own shape. What
  // changed is that a provider's envelope no longer counts — see the test below.
  it.each([403, 400])('turns a %s into llm_policy_denied carrying the reason', async (status) => {
    llmFetch.mockResolvedValue({
      ok: false,
      status,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'blocked by policy: no PII' } }),
    });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'llm_policy_denied',
      reason: 'blocked by policy: no PII',
      provider: 'openai',
    });
  });

  it('does not mark a 500 as a policy denial', async () => {
    llmFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.not.toMatchObject({
      code: 'llm_policy_denied',
    });
  });

  // A provider failure is NOT the product working. On 2026-09-05 Anthropic's
  // "Your credit balance is too low" (a 400) rendered in the demo as "Privilege
  // denied this call" — claiming a policy block that never happened.
  it('does not call a provider-shaped 400 a policy denial', async () => {
    llmFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Your credit balance is too low' },
        request_id: 'req_011Cem3bkAocAcTqx8YJnGEw',
      }),
    });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.not.toMatchObject({
      code: 'llm_policy_denied',
    });
    // It still surfaces, with the provider named and the message intact.
    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /\(openai\) 400: Your credit balance is too low/,
    );
  });

  it('names the missing config rather than failing at the provider', async () => {
    delete process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI;
    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured/,
    );

    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI = 'vk';
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /PRIVILEGE_LLM_GATEWAY_URL not configured/,
    );

    // Neither case may reach the network.
    expect(llmFetch).not.toHaveBeenCalled();
  });

  // An empty 200 is the failure that reads as success.
  it('rejects an empty response rather than returning an empty string', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) });

    await expect(svc.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }])).rejects.toThrow(/empty/i);
  });

  it('leaves the two existing lanes exported and untouched', () => {
    expect(typeof svc.callPrivilegeGemini).toBe('function');
    expect(typeof svc.callPrivilegeClaude).toBe('function');
  });
});
