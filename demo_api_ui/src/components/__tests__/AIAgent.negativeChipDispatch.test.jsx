import { describe, it, expect, vi } from 'vitest';
import { NEGATIVE_SIM_BY_TOOL, isNegativeChip, dispatchNegativeChip } from '../negativeChipDispatch';

const say = vi.fn();

describe('negative chip dispatch rail', () => {
  it('maps synthetic tools to sims', () => {
    expect(NEGATIVE_SIM_BY_TOOL.test_wrong_audience).toBe('wrong-aud');
    expect(NEGATIVE_SIM_BY_TOOL.test_wrong_scope).toBe('insufficient-scope');
  });

  it('identifies negative chips only', () => {
    expect(isNegativeChip({ mode: 'direct', tool: 'test_wrong_audience' })).toBe(true);
    expect(isNegativeChip({ mode: 'direct', denyTool: 'show_health_record' })).toBe(true);
    expect(isNegativeChip({ mode: 'direct', tool: 'get_balance' })).toBe(false);
    expect(isNegativeChip({ message: 'view my permits' })).toBe(false);
  });

  it('synthetic tool chip posts the mapped sim', async () => {
    const postSim = vi.fn().mockResolvedValue({ status: 401, errorCode: 'invalid_audience' });
    await dispatchNegativeChip(
      { mode: 'direct', tool: 'test_wrong_audience', label: 'DPoP', message: 'fire...' },
      { vertical: 'government', postSim, callMcpTool: vi.fn(), say },
    );
    expect(postSim).toHaveBeenCalledWith('wrong-aud', expect.objectContaining({ vertical: 'government' }));
  });

  it('denyTool chip calls the real tool and renders 403 as proof (axios error shape)', async () => {
    const callMcpTool = vi.fn().mockRejectedValue({ response: { status: 403, data: { error: 'mcp_authorization_denied', decisionId: 'dec-42' } } });
    await dispatchNegativeChip(
      { mode: 'direct', denyTool: 'show_health_record', label: 'Authz DENY', message: 'show...' },
      { vertical: 'government', postSim: vi.fn(), callMcpTool, say },
    );
    expect(callMcpTool).toHaveBeenCalledWith('show_health_record', {}, expect.objectContaining({ vertical: 'government' }));
    const text = say.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(text).toMatch(/Denied as designed/);
    expect(text).toMatch(/dec-42/);
  });

  it('denyTool chip renders 403 as proof from the real callMcpTool flat error shape', async () => {
    // demo_api_ui/src/services/demoAgentService.js's callMcpTool is fetch-based
    // and throws a FLAT error (statusCode/code/decisionId directly on the error
    // object, no axios `.response` wrapper) — this is the shape production
    // actually produces, so it must be covered independently of the axios-shaped
    // mock above.
    const callMcpTool = vi.fn().mockRejectedValue({ statusCode: 403, code: 'mcp_authorization_denied', decisionId: 'dec-flat' });
    await dispatchNegativeChip(
      { mode: 'direct', denyTool: 'show_health_record', label: 'Authz DENY', message: 'show...' },
      { vertical: 'government', postSim: vi.fn(), callMcpTool, say },
    );
    const text = say.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(text).toMatch(/Denied as designed/);
    expect(text).toMatch(/dec-flat/);
  });

  it('a 2xx on a denyTool chip is reported as a broken control', async () => {
    const callMcpTool = vi.fn().mockResolvedValue({ success: true, result: {} });
    await dispatchNegativeChip(
      { mode: 'direct', denyTool: 'show_health_record', label: 'Authz DENY', message: 'show...' },
      { vertical: 'government', postSim: vi.fn(), callMcpTool, say },
    );
    expect(say.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/control is broken/);
  });
});
