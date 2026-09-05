'use strict';

// A Privilege policy denial is the DEMO, not an error state. It gets its own
// status and its own code so the panel can render it as "Privilege stopped
// this" rather than as a broken feature.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/privilegeLlmProxyService', () => ({
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
