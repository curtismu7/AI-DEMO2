// Tests the loop guard in runReasonLoop: terminal results and stuck
// (same-call + same-result) repeats must stop the loop; legitimate repeat-reads
// whose result CHANGED must not.
jest.mock('axios');
jest.mock('../../services/configStore', () => ({ getEffective: () => 'test-secret' }));

const axios = require('axios');
const { runReasonLoop } = require('../../services/agentReasoningClient');

/** Queue scripted reasoning-service responses; each axios.post() shifts one. */
function scriptResponses(responses) {
  const q = [...responses];
  axios.post.mockImplementation(async () => ({ data: q.shift() }));
}

const baseParams = (executeTool, extra = {}) => ({
  messages: [{ role: 'user', content: 'show my accounts' }],
  tools: [],
  provider: 'anthropic',
  model: 'm',
  maxIterations: 10,
  executeTool,
  ...extra,
});

beforeEach(() => {
  axios.post.mockReset();
});

test('returns tool_terminal with the envelope when a tool result is terminal', async () => {
  scriptResponses([
    { type: 'tool_calls', calls: [{ id: '1', name: 'get_my_accounts', args: {} }] },
  ]);
  const executeTool = jest.fn(async () =>
    JSON.stringify({ requiresCustomerLogin: true, terminal: true, code: 'admin_token_on_customer' }),
  );
  const r = await runReasonLoop(baseParams(executeTool));
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('tool_terminal');
  expect(r.toolResult.requiresCustomerLogin).toBe(true);
  expect(executeTool).toHaveBeenCalledTimes(1); // stopped immediately, no retry
});

test('stops with repeated_tool_call when the same call yields the same result twice', async () => {
  scriptResponses([
    { type: 'tool_calls', calls: [{ id: '1', name: 'get_my_accounts', args: {} }] },
    { type: 'tool_calls', calls: [{ id: '2', name: 'get_my_accounts', args: {} }] },
  ]);
  const executeTool = jest.fn(async () => JSON.stringify({ accounts: [] }));
  const r = await runReasonLoop(baseParams(executeTool));
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('repeated_tool_call');
  expect(executeTool).toHaveBeenCalledTimes(2);
});

test('does NOT stop when the same call yields a CHANGED result (state progress)', async () => {
  scriptResponses([
    { type: 'tool_calls', calls: [{ id: '1', name: 'get_balance', args: {} }] },
    { type: 'tool_calls', calls: [{ id: '2', name: 'get_balance', args: {} }] },
    { type: 'final', answer: 'Balance updated to $50.' },
  ]);
  let bal = 100;
  const executeTool = jest.fn(async () => {
    bal -= 50;
    return JSON.stringify({ balance: bal });
  });
  const r = await runReasonLoop(baseParams(executeTool));
  expect(r.ok).toBe(true);
  expect(r.answer).toBe('Balance updated to $50.');
  expect(executeTool).toHaveBeenCalledTimes(2);
});

test('returns the final answer on a normal completion', async () => {
  scriptResponses([{ type: 'final', answer: 'Here are your accounts.' }]);
  const r = await runReasonLoop(baseParams(jest.fn()));
  expect(r.ok).toBe(true);
  expect(r.answer).toBe('Here are your accounts.');
});

test('surfaces reasoning_unavailable when the reasoning service throws', async () => {
  axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
  const r = await runReasonLoop(baseParams(jest.fn()));
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('reasoning_unavailable');
});
