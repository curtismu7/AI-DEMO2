jest.mock('../services/verticalOpsData', () => ({ getCustomerContext: jest.fn() }));
jest.mock('../services/agentReasoningClient', () => ({ runReasonLoop: jest.fn() }));
jest.mock('../services/llmProviderResolver', () => ({ resolveLlmProvider: () => ({ provider: 'helix', model: undefined }) }));

const { getCustomerContext } = require('../services/verticalOpsData');
const { runReasonLoop } = require('../services/agentReasoningClient');
const { processOpsMessage } = require('../services/opsAssistantService');

describe('processOpsMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes NO tools and returns the grounded answer envelope', async () => {
    getCustomerContext.mockReturnValue({ customer: { name: 'Maya Chen' }, records: { appointments: [] } });
    runReasonLoop.mockResolvedValue({ ok: true, answer: 'She has no open appointments.', inputTokens: 12, outputTokens: 8 });

    const out = await processOpsMessage({ vertical: 'healthcare', query: 'maya', message: 'summarize open items' });

    expect(runReasonLoop).toHaveBeenCalledTimes(1);
    expect(runReasonLoop.mock.calls[0][0].tools).toEqual([]); // read-only
    expect(out).toMatchObject({ reply: 'She has no open appointments.', success: true, toolsCalled: [], agentConfigured: true });
  });

  test('returns a helpful reply (success) when no customer resolves', async () => {
    getCustomerContext.mockReturnValue({ customer: null, records: null });
    const out = await processOpsMessage({ vertical: 'healthcare', query: 'nobody', message: 'hi' });
    expect(out.success).toBe(true);
    expect(out.reply).toMatch(/look up a customer/i);
    expect(runReasonLoop).not.toHaveBeenCalled();
  });

  test('returns success:false with error when the reason loop fails', async () => {
    getCustomerContext.mockReturnValue({ customer: { name: 'X' }, records: {} });
    runReasonLoop.mockResolvedValue({ ok: false, reason: 'reasoning_unavailable' });
    const out = await processOpsMessage({ vertical: 'healthcare', query: 'x', message: 'hi' });
    expect(out.success).toBe(false);
    expect(out.error).toBe('reasoning_unavailable');
  });
});
