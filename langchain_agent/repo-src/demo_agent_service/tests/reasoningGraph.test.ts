// banking_agent_service/tests/reasoningGraph.test.ts
import { reasonOnce } from '../src/reasoningGraph';
import type { ReasonRequest } from '../src/reasonContract';

jest.mock('../src/helixToolAdapter', () => {
  const actual = jest.requireActual('../src/helixToolAdapter');
  return { ...actual, helixReason: jest.fn() };
});
jest.mock('../src/helixClient', () => ({ callHelix: jest.fn() }));
const { helixReason, HelixUnparseableError } = require('../src/helixToolAdapter');

const baseReq: ReasonRequest = {
  messages: [{ role: 'user', content: 'show transactions' }],
  tools: [{ name: 'get_my_transactions', description: 'x', inputSchema: { type: 'object', properties: {} } }],
  provider: 'helix',
  helixConfig: {},
};

describe('reasonOnce — helix provider via adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adapter returns tool_calls → ReasonResponse tool_calls', async () => {
    helixReason.mockResolvedValueOnce({ tool_calls: [{ id: 'i', name: 'get_my_transactions', args: {} }] });
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('tool_calls');
    if (out.type === 'tool_calls') expect(out.calls[0].name).toBe('get_my_transactions');
  });

  test('adapter returns content → ReasonResponse final', async () => {
    helixReason.mockResolvedValueOnce({ content: 'your balance is fine' });
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.answer).toBe('your balance is fine');
      expect(out.reasoningUnavailable).toBeFalsy();
    }
  });

  test('HelixUnparseableError → final with reasoningUnavailable:true (no fabricated answer)', async () => {
    helixReason.mockRejectedValueOnce(new HelixUnparseableError('nope'));
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.reasoningUnavailable).toBe(true);
      expect(out.answer).toBe('');
    }
  });

  test('helix transport error → final with reasoningUnavailable:true', async () => {
    helixReason.mockRejectedValueOnce(new Error('Helix poll failed: 502'));
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') expect(out.reasoningUnavailable).toBe(true);
  });
});
