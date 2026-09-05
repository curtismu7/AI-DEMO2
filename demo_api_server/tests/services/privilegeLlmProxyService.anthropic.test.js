'use strict';

// The Anthropic lane is the one that does NOT share the OpenAI-compatible wire
// shape, so it is the lane where a refactor toward "they're all the same" breaks
// something silently: `system` is a top-level field rather than a message role,
// the reply lives at content[0].text rather than choices[0].message.content, and
// the anthropic-version header is mandatory. It shipped configured and untested
// (the key is set in demo_api_server/.env); these are the contract's teeth.

jest.mock('../../services/llmFetch', () => ({ llmFetch: jest.fn() }));

const { llmFetch } = require('../../services/llmFetch');
const svc = require('../../services/privilegeLlmProxyService');

const OK = {
  ok: true,
  status: 200,
  json: async () => ({ content: [{ text: 'hello from claude' }] }),
};

describe('callPrivilegeClaude', () => {
  const env = { ...process.env };

  beforeEach(() => {
    llmFetch.mockReset();
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk-anthropic';
    delete process.env.PRIVILEGE_LLM_MODEL_ANTHROPIC;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('posts to the native Messages route with the virtual key and version header', async () => {
    llmFetch.mockResolvedValue(OK);

    const text = await svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }]);

    expect(text).toBe('hello from claude');
    const [url, init] = llmFetch.mock.calls[0];
    expect(url).toBe('https://gw.test/llm/anthropic/v1/messages');
    expect(init.headers.Authorization).toBe('Bearer vk-anthropic');
    // Mandatory for the native API — a missing version header is a 400 at the provider.
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('keeps a trailing slash on the gateway URL from doubling the path', async () => {
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test/';
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }]);

    expect(llmFetch.mock.calls[0][0]).toBe('https://gw.test/llm/anthropic/v1/messages');
  });

  // The wire-shape difference that a "unify the lanes" refactor would erase.
  it('lifts system out of messages into a top-level field', async () => {
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeClaude([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);

    const body = JSON.parse(llmFetch.mock.calls[0][1].body);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('joins multiple system turns and omits the field when there are none', async () => {
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeClaude([
      { role: 'system', content: 'be terse' },
      { role: 'system', content: 'cite sources' },
      { role: 'user', content: 'hi' },
    ]);
    expect(JSON.parse(llmFetch.mock.calls[0][1].body).system).toBe('be terse\n\ncite sources');

    llmFetch.mockClear();
    await svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }]);
    // undefined, not '' — an empty system field is not the same as no system.
    expect(JSON.parse(llmFetch.mock.calls[0][1].body)).not.toHaveProperty('system');
  });

  it('defaults the model but lets config override it', async () => {
    llmFetch.mockResolvedValue(OK);

    await svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }]);
    expect(JSON.parse(llmFetch.mock.calls[0][1].body).model).toBe(svc.DEFAULT_MODEL_ANTHROPIC);

    llmFetch.mockClear();
    await svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }], { anthropic_model: 'claude-opus-5' });
    expect(JSON.parse(llmFetch.mock.calls[0][1].body).model).toBe('claude-opus-5');
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

    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'llm_policy_denied',
      reason: 'blocked by policy: no PII',
      provider: 'anthropic',
    });
  });

  it('does not mark a 500 as a policy denial', async () => {
    llmFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    });

    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.not.toMatchObject({
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

    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.not.toMatchObject({
      code: 'llm_policy_denied',
    });
    // It still surfaces, with the provider named and the message intact.
    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /\(anthropic\) 400: Your credit balance is too low/,
    );
  });

  it('names the missing config rather than failing at the provider', async () => {
    delete process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC;
    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC not configured/,
    );

    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk';
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /PRIVILEGE_LLM_GATEWAY_URL not configured/,
    );

    // Neither case may reach the network — the point is that the app never
    // ships a request that the provider would reject with a bare 401.
    expect(llmFetch).not.toHaveBeenCalled();
  });

  // An empty 200 is the failure that reads as success.
  it('rejects an empty response rather than returning an empty string', async () => {
    llmFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [] }) });

    await expect(svc.callPrivilegeClaude([{ role: 'user', content: 'hi' }])).rejects.toThrow(/empty/i);
  });
});
