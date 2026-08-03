'use strict';

/**
 * Option C wiring — processAgentMessage must attribute the model's answer
 * against the payloads the tools actually returned, and must DROP what it
 * cannot attribute rather than passing it through.
 *
 * The unit tests in groundedAnswer.test.js prove the attribution logic. These
 * prove it is actually reached on the LLM path, that the flag gates it, and
 * that a fabricated figure cannot survive the trip to the caller.
 *
 * Mock set mirrors demoAgentLangGraphService.modes.test.js (hermetic, no IO).
 */

const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));
jest.mock('../services/platformAgentRuntime', () => ({
  runPlatformLoop: jest.fn(async () => ({ ok: true, status: 200, data: 'PLATFORM_OK' })),
  buildPlatformRequest: jest.fn(),
}));
jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://gw.example'),
}));
jest.mock('../services/oauthService', () => ({
  performTokenExchange: jest.fn(async () => 'minted-gw-token'),
}));
jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return { ...real, parseHeuristic: jest.fn(() => ({ kind: 'none' })) };
});
// Stable singleton, NOT a fn created inside the factory. setup.js runs
// jest.resetModules() after every test, and processAgentMessage requires
// agentReasoningClient lazily — so a factory-local jest.fn() is replaced by a
// fresh implementation-less one from test 2 onward, and the loop returns
// undefined. The `mock` prefix is what lets jest hoist past this reference.
const mockRunReasonLoop = jest.fn();
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: mockRunReasonLoop,
}));
jest.mock('../services/llmProviderResolver', () => ({
  resolveLlmProvider: jest.fn(
    jest.requireActual('../services/llmProviderResolver').resolveLlmProvider
  ),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const nlIntentParser = require('../services/nlIntentParser');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');

function resetCfg(next = {}) {
  for (const k of Object.keys(_cfg)) delete _cfg[k];
  Object.assign(_cfg, next);
}

/** get_account_balance is a real banking tool, so its result is in-vertical. */
function loopReturning(answer) {
  return {
    ok: true,
    answer,
    toolsCalled: ['get_account_balance'],
    toolResults: [
      {
        name: 'get_account_balance',
        result: JSON.stringify({ accountId: 'acct-4021', balance: 1234.5, currency: 'USD' }),
      },
    ],
    inputTokens: 0,
    outputTokens: 0,
  };
}

async function ask(message = 'what is my balance') {
  return processAgentMessage({
    message,
    userId: 'u1',
    userToken: 'session-access-token',
    langchainConfig: {},
    req: { body: {} },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  nlIntentParser.parseHeuristic.mockReturnValue({ kind: 'none' });
  resetCfg({ agent_mode: 'llamacpp', ff_grounded_answers: 'true' });
});

describe('processAgentMessage — grounded answers (ff_grounded_answers ON)', () => {
  test('keeps the grounded claim with its source tool and scope', async () => {
    mockRunReasonLoop.mockResolvedValue(loopReturning('Your balance is $1,234.50.'));

    const result = await ask();

    expect(result.groundedAnswer.grounded).toBe(true);
    expect(result.groundedAnswer.claims).toHaveLength(1);
    expect(result.groundedAnswer.claims[0].sources).toEqual([
      { tool: 'get_account_balance', scope: 'read' },
    ]);
  });

  test('DROPS a fabricated figure and never returns its text anywhere', async () => {
    mockRunReasonLoop.mockResolvedValue(
      loopReturning('Your balance is $1,234.50. Your pending refund is $6,750.00.')
    );

    const result = await ask();

    expect(result.groundedAnswer.claims).toHaveLength(1);
    expect(result.groundedAnswer.claims[0].text).toBe('Your balance is $1,234.50.');
    expect(result.groundedAnswer.droppedCount).toBe(1);
    // The whole point: the fabricated number cannot reach a renderer via the
    // grounded payload, no matter which field it reads.
    expect(JSON.stringify(result.groundedAnswer)).not.toContain('6,750');
  });

  test('nothing grounds → grounded:false, the signal to degrade to the Option A card', async () => {
    mockRunReasonLoop.mockResolvedValue(loopReturning('You are doing great financially.'));

    const result = await ask();

    expect(result.groundedAnswer.grounded).toBe(false);
    expect(result.groundedAnswer.claims).toEqual([]);
  });

  test('a value only a FOREIGN vertical tool returned does not ground', async () => {
    mockRunReasonLoop.mockResolvedValue({
      ok: true,
      answer: 'Patient MRN-77301 has an appointment.',
      toolsCalled: ['get_patient_record'],
      toolResults: [
        { name: 'get_patient_record', result: JSON.stringify({ mrn: 'MRN-77301' }) },
      ],
      inputTokens: 0,
      outputTokens: 0,
    });

    const result = await ask();

    expect(result.groundedAnswer.grounded).toBe(false);
  });

  test('raw tool payloads are not forwarded to the caller', async () => {
    mockRunReasonLoop.mockResolvedValue(loopReturning('Your balance is $1,234.50.'));

    const result = await ask();

    expect(result.toolResults).toBeUndefined();
    expect(result.groundedAnswer.claims[0]).not.toHaveProperty('result');
  });
});

describe('processAgentMessage — grounded answers (flag OFF)', () => {
  test('no groundedAnswer field, and the model reply is untouched', async () => {
    resetCfg({ agent_mode: 'llamacpp' }); // ff_grounded_answers absent → OFF
    mockRunReasonLoop.mockResolvedValue(
      loopReturning('Your balance is $1,234.50. Your pending refund is $6,750.00.')
    );

    const result = await ask();

    expect(result.groundedAnswer).toBeUndefined();
    expect(result.reply).toContain('6,750');
  });
});
