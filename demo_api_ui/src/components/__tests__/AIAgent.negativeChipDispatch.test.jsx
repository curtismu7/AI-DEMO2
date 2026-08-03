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

  it('denyTool chip calls the real tool and renders 403 as proof', async () => {
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

  it('a 2xx on a denyTool chip is reported as a broken control', async () => {
    const callMcpTool = vi.fn().mockResolvedValue({ success: true, result: {} });
    await dispatchNegativeChip(
      { mode: 'direct', denyTool: 'show_health_record', label: 'Authz DENY', message: 'show...' },
      { vertical: 'government', postSim: vi.fn(), callMcpTool, say },
    );
    expect(say.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/control is broken/);
  });
});
