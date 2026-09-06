'use strict';

// The Sept 2026 "Plan C" LLM gateway clients (privilegeLlmProxyService,
// llamacppLlmService) share one transport module (llmFetch.js), while
// agentGatewayClient (tool discovery) is a separate axios-based client with
// its own env var (AGENT_GATEWAY_URL). Nothing wires them together, but a run
// through demoAgentRoutes/agentRun exercises both in the same request, and
// llmFetch's shared retry/timeout logic runs for every LLM lane. These tests
// prove that running them concurrently produces no cross-talk (one lane's
// request/response never leaks into another's) and that a failure in one
// client leaves the others' outcomes untouched — real llmFetch is used
// (only global fetch is mocked) so the shared module's own logic is exercised,
// not bypassed.

jest.mock('axios');
jest.mock('../../services/mcpChallengeProbe', () => ({
  probeMcpChallenge: jest.fn().mockResolvedValue({
    status: 401, challenge: null, metadata: null, events: [],
  }),
}));

function jsonRes(status, body) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
  };
}

const ENV_KEYS = [
  'AGENT_GATEWAY_URL',
  'PRIVILEGE_LLM_GATEWAY_URL',
  'PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC',
  'PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI',
  'LLAMACPP_BASE_URL',
  'LLAMACPP_MODEL',
];
const savedEnv = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  delete global.fetch;
});

describe('AI gateway client + LLM gateway clients coexisting', () => {
  it('resolves each client independently with no cross-talk when run concurrently', async () => {
    process.env.AGENT_GATEWAY_URL = 'http://agent-gw.test:8080';
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk-a';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI = 'vk-o';
    process.env.LLAMACPP_BASE_URL = 'http://127.0.0.1:8090';
    process.env.LLAMACPP_MODEL = 'local-test-model';

    const axios = require('axios');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const privilege = require('../../services/privilegeLlmProxyService');
    const llamacpp = require('../../services/llamacppLlmService');

    axios.post.mockResolvedValueOnce({
      data: { result: { tools: [{ name: 'get_my_accounts' }] } },
    });

    const fetchCalls = [];
    global.fetch = jest.fn((url) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u === 'https://gw.test/llm/anthropic/v1/messages') {
        return Promise.resolve(jsonRes(200, { content: [{ text: 'claude-reply' }] }));
      }
      if (u === 'https://gw.test/llm/openai/v1/chat/completions') {
        return Promise.resolve(jsonRes(200, { choices: [{ message: { content: 'openai-reply' } }] }));
      }
      if (u === 'http://127.0.0.1:8090/v1/chat/completions') {
        return Promise.resolve(jsonRes(200, { choices: [{ message: { content: 'llama-reply' } }] }));
      }
      return Promise.resolve(jsonRes(404, {}));
    });

    const [toolsResult, claudeText, openaiText, llamaText] = await Promise.all([
      agentGatewayClient.getAvailableTools({}, 'cc-token'),
      privilege.callPrivilegeClaude([{ role: 'user', content: 'hi' }]),
      privilege.callPrivilegeOpenAI([{ role: 'user', content: 'hi' }]),
      llamacpp.callLlamaCpp([{ role: 'user', content: 'hi' }]),
    ]);

    expect(toolsResult.tools.map((t) => t.name)).toEqual(['get_my_accounts']);
    expect(claudeText).toBe('claude-reply');
    expect(openaiText).toBe('openai-reply');
    expect(llamaText).toBe('llama-reply');

    // The agent gateway call went through axios only; the LLM lanes went
    // through fetch only — neither transport saw the other's target.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('http://agent-gw.test:8080/tools/list');
    expect(fetchCalls.some((u) => u.includes('agent-gw.test'))).toBe(false);
    expect(fetchCalls.slice().sort()).toEqual([
      'http://127.0.0.1:8090/v1/chat/completions',
      'https://gw.test/llm/anthropic/v1/messages',
      'https://gw.test/llm/openai/v1/chat/completions',
    ]);
  });

  it('a failure in one client does not affect the others running concurrently', async () => {
    process.env.AGENT_GATEWAY_URL = 'http://agent-gw.test:8080';
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://gw.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk-a';
    process.env.LLAMACPP_BASE_URL = 'http://127.0.0.1:8090';
    process.env.LLAMACPP_MODEL = 'local-test-model';

    const axios = require('axios');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const privilege = require('../../services/privilegeLlmProxyService');
    const llamacpp = require('../../services/llamacppLlmService');

    // Agent gateway denies the request (Ping Authorize DENY via JSON-RPC error).
    axios.post.mockResolvedValueOnce({
      data: { error: { code: 'insufficient_scope', message: 'no scope', data: { decision: 'DENY' } } },
    });

    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u === 'https://gw.test/llm/anthropic/v1/messages') {
        return Promise.resolve(jsonRes(200, { content: [{ text: 'claude-still-fine' }] }));
      }
      // 404 (not 429/5xx) so llmFetch's shared retry path isn't triggered here —
      // this failure must stay this lane's alone, not slow down or retry the others.
      if (u === 'http://127.0.0.1:8090/v1/chat/completions') {
        return Promise.resolve(jsonRes(404, { error: 'no such model' }));
      }
      return Promise.resolve(jsonRes(404, {}));
    });

    const [gatewayOutcome, claudeOutcome, llamaOutcome] = await Promise.allSettled([
      agentGatewayClient.getAvailableTools({}, 'cc-token'),
      privilege.callPrivilegeClaude([{ role: 'user', content: 'hi' }]),
      llamacpp.callLlamaCpp([{ role: 'user', content: 'hi' }]),
    ]);

    expect(gatewayOutcome.status).toBe('rejected');
    expect(gatewayOutcome.reason.code).toBe('insufficient_scope');

    expect(llamaOutcome.status).toBe('rejected');
    expect(llamaOutcome.reason.message).toMatch(/llama\.cpp chat\/completions failed: 404/);

    // The lane that should have succeeded is unaffected by the other two failing.
    expect(claudeOutcome.status).toBe('fulfilled');
    expect(claudeOutcome.value).toBe('claude-still-fine');
  });

  it('each client resolves its own env vars, never falling back to another client\'s', async () => {
    delete process.env.AGENT_GATEWAY_URL;
    process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://privilege-only.test';
    process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk-a';
    delete process.env.LLAMACPP_BASE_URL;
    delete process.env.LLAMACPP_MODEL;

    const axios = require('axios');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const privilege = require('../../services/privilegeLlmProxyService');
    const llamacpp = require('../../services/llamacppLlmService');

    axios.post.mockResolvedValueOnce({ data: { result: { tools: [] } } });
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u === 'https://privilege-only.test/llm/anthropic/v1/messages') {
        return Promise.resolve(jsonRes(200, { content: [{ text: 'claude-ok' }] }));
      }
      if (u === 'http://127.0.0.1:8090/v1/models') {
        return Promise.resolve(jsonRes(200, { data: [{ id: 'default-local-model' }] }));
      }
      if (u === 'http://127.0.0.1:8090/v1/chat/completions') {
        return Promise.resolve(jsonRes(200, { choices: [{ message: { content: 'llama default host ok' } }] }));
      }
      return Promise.resolve(jsonRes(404, {}));
    });

    await agentGatewayClient.getAvailableTools({}, 'cc-token');
    const claudeText = await privilege.callPrivilegeClaude([{ role: 'user', content: 'hi' }]);
    const llamaText = await llamacpp.callLlamaCpp([{ role: 'user', content: 'hi' }]);

    // agentGatewayClient fell back to ITS OWN localhost:8080 default, not the
    // Privilege gateway host that happens to be configured in this test.
    expect(axios.post.mock.calls[0][0]).toBe('http://localhost:8080/tools/list');
    // llamacpp fell back to ITS OWN default (127.0.0.1:8090), not the Privilege
    // gateway host either — the three env vars stayed fully independent.
    expect(claudeText).toBe('claude-ok');
    expect(llamaText).toBe('llama default host ok');
  });

  // llmDirectCompare is the third of the Sept 2026 lanes: it calls a DIRECT
  // provider host AND the Privilege gateway host in the same operation (4 fetches
  // per compare()), which is the shared llmFetch module under the most concurrent
  // load any single caller puts on it. Run it alongside tool discovery and a plain
  // llama.cpp call to prove that load doesn't leak into either.
  it('llmDirectCompare (4 fetches at once) coexists with tool discovery and llama.cpp', async () => {
    process.env.AGENT_GATEWAY_URL = 'http://agent-gw.test:8080';
    process.env.LLAMACPP_BASE_URL = 'http://127.0.0.1:8090';
    process.env.LLAMACPP_MODEL = 'local-test-model';

    const axios = require('axios');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const llamacpp = require('../../services/llamacppLlmService');
    const { compare } = require('../../services/llmDirectCompare');

    axios.post.mockResolvedValueOnce({
      data: { result: { tools: [{ name: 'get_my_transactions' }] } },
    });

    const fetchCalls = [];
    global.fetch = jest.fn((url) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u === 'https://api.anthropic.com/v1/models') return Promise.resolve(jsonRes(200, { data: [{ id: 'claude-a' }] }));
      if (u === 'https://gw.test/llm/anthropic/v1/models') return Promise.resolve(jsonRes(200, { data: [{ id: 'claude-a' }] }));
      if (u === 'https://api.anthropic.com/v1/messages') return Promise.resolve(jsonRes(200, { content: [{ text: 'direct-Paris' }] }));
      if (u === 'https://gw.test/llm/anthropic/v1/messages') return Promise.resolve(jsonRes(200, { content: [{ text: 'gateway-Paris' }] }));
      if (u === 'http://127.0.0.1:8090/v1/chat/completions') return Promise.resolve(jsonRes(200, { choices: [{ message: { content: 'llama-reply' } }] }));
      return Promise.resolve(jsonRes(404, {}));
    });

    const [toolsResult, compareResult, llamaText] = await Promise.all([
      agentGatewayClient.getAvailableTools({}, 'cc-token'),
      compare({
        provider: 'anthropic',
        directKey: 'direct-key',
        gatewayBase: 'https://gw.test',
        virtualKey: 'vk-a',
        model: 'claude-haiku-4-5-20251001',
        prompt: 'capital of france?',
      }),
      llamacpp.callLlamaCpp([{ role: 'user', content: 'hi' }]),
    ]);

    expect(toolsResult.tools.map((t) => t.name)).toEqual(['get_my_transactions']);
    expect(llamaText).toBe('llama-reply');
    expect(compareResult.completion.direct.json.content[0].text).toBe('direct-Paris');
    expect(compareResult.completion.gateway.json.content[0].text).toBe('gateway-Paris');

    // The tool-discovery call went through axios only; llama.cpp's single fetch
    // never picked up one of compare()'s four concurrent responses (or vice versa).
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(fetchCalls.filter((u) => u === 'http://127.0.0.1:8090/v1/chat/completions')).toHaveLength(1);
    expect(fetchCalls.some((u) => u.includes('agent-gw.test'))).toBe(false);
  });
});

// llmCircuitBreaker is the shared, module-level state (a `provider -> {failures,
// openUntil}` Map) that geminiNlIntent.js consults before routing to any LLM lane.
// It is the one piece of real shared mutable state between lanes — the tests above
// share a transport module (llmFetch) but no mutable state — so it is the place a
// bug would let one lane's failures silently gate a completely different lane.
describe('llmCircuitBreaker isolation across LLM lanes', () => {
  const breaker = require('../../services/llmCircuitBreaker');

  afterEach(() => breaker._resetAll());

  it('tripping one provider key never opens another', () => {
    for (let i = 0; i < breaker.BREAKER_THRESHOLD; i++) breaker.recordFailure('llamacpp');

    expect(breaker.isOpen('llamacpp')).toBe(true);
    // geminiNlIntent.js uses separate keys per lane ('privilege_llm' for Gemini,
    // 'privilege_claude' for Claude, plus 'google', 'helix', 'lmstudio', 'mlx') —
    // none of them may read as open just because llamacpp's did.
    expect(breaker.isOpen('privilege_llm')).toBe(false);
    expect(breaker.isOpen('privilege_claude')).toBe(false);
    expect(breaker.isOpen('google')).toBe(false);
  });

  it('a caller\'s open breaker does not block a different caller\'s direct client call', async () => {
    process.env.LLAMACPP_BASE_URL = 'http://127.0.0.1:8090';
    process.env.LLAMACPP_MODEL = 'local-test-model';
    for (let i = 0; i < breaker.BREAKER_THRESHOLD; i++) breaker.recordFailure('llamacpp');
    expect(breaker.isOpen('llamacpp')).toBe(true);

    // llamacppLlmService itself has no breaker awareness — gating is each CALLER's
    // own responsibility (geminiNlIntent.js checks isOpen() before calling it).
    // a2aOrchestratorService.js and agentFrameworkOrchestrator.js call callLlamaCpp
    // directly with no such check, so one caller tripping the breaker must never
    // silently block a different caller reaching the same underlying client.
    const llamacpp = require('../../services/llamacppLlmService');
    global.fetch = jest.fn(() => Promise.resolve(jsonRes(200, {
      choices: [{ message: { content: 'still reachable' } }],
    })));

    const text = await llamacpp.callLlamaCpp([{ role: 'user', content: 'hi' }]);
    expect(text).toBe('still reachable');
    expect(global.fetch).toHaveBeenCalled();
  });
});
