// banking_api_server/tests/agentReasoningLoop.regression.test.js
jest.mock('axios');
const axios = require('axios');
const { runReasonLoop } = require('../services/agentReasoningClient');

describe('runReasonLoop', () => {
  beforeEach(() => jest.clearAllMocks());

  test('final answer in one round', async () => {
    axios.post.mockResolvedValueOnce({ data: { type: 'final', answer: 'hi', messages: [] } });
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'hello' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 10 });
    expect(out).toEqual({ ok: true, answer: 'hi', inputTokens: 0, outputTokens: 0 });
  });

  test('one tool round then final — BFF executes the tool', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { type: 'tool_calls', calls: [{ id: '1', name: 'get_x', args: {} }], messages: [] } })
      .mockResolvedValueOnce({ data: { type: 'final', answer: 'done', messages: [] } });
    const calls = [];
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async (n) => { calls.push(n); return 'r'; }, maxIterations: 10 });
    expect(calls).toEqual(['get_x']);
    // toolsCalled reports the tools the loop actually executed. It used to be
    // dropped, so the caller returned a hardcoded toolsCalled: [] and no
    // LLM-path use case could ever satisfy 'tool-dispatched' evidence.
    expect(out).toEqual({ ok: true, answer: 'done', toolsCalled: ['get_x'], inputTokens: 0, outputTokens: 0 });
  });

  test('reasoningUnavailable:true → heuristic-fallback signal', async () => {
    axios.post.mockResolvedValueOnce({ data: { type: 'final', answer: '', reasoningUnavailable: true } });
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 10 });
    expect(out).toEqual({ ok: false, reason: 'reasoning_unavailable' });
  });

  test(':3006 transport failure → reasoning-unavailable signal, not a throw', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 10 });
    expect(out).toEqual({ ok: false, reason: 'reasoning_unavailable' });
  });

  test('recursion cap enforced BFF-side', async () => {
    axios.post.mockResolvedValue({ data: { type: 'tool_calls', calls: [{ id: '1', name: 'loop', args: {} }], messages: [] } });
    const out = await runReasonLoop({ messages: [{ role: 'user', content: 'x' }], tools: [], provider: 'helix', executeTool: async () => 'r', maxIterations: 3 });
    // The repeated-tool-call guard short-circuits after the 2nd identical call+result pair
    // (same sig "loop|{}", same result "r") — returns repeated_tool_call before max_iterations.
    expect(out).toEqual({ ok: false, reason: 'repeated_tool_call', toolResult: null });
    expect(axios.post.mock.calls.length).toBe(2);
  });
});
