import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMcpToolTransport } from '../useMcpToolTransport';

vi.mock('../../services/demoAgentService', () => ({
  callMcpTool: vi.fn().mockResolvedValue({ result: { via: 'direct' }, tokenEvents: [{ id: 'user-token' }] }),
}));
vi.mock('../../services/privilegeMcpService', () => ({
  callMcpToolViaPrivilege: vi.fn().mockResolvedValue({ result: { via: 'privilege' }, tokenEvents: [] }),
}));

import { callMcpTool as directCallMcpTool } from '../../services/demoAgentService';
import { callMcpToolViaPrivilege } from '../../services/privilegeMcpService';

describe('useMcpToolTransport', () => {
  beforeEach(() => vi.clearAllMocks());

  test('transport "direct" dispatches to demoAgentService.callMcpTool', async () => {
    const { result } = renderHook(() => useMcpToolTransport('direct'));
    const outcome = await result.current('get_my_accounts', { a: 1 }, { useCaseId: 'uc1' });
    expect(directCallMcpTool).toHaveBeenCalledWith('get_my_accounts', { a: 1 }, { useCaseId: 'uc1' });
    expect(callMcpToolViaPrivilege).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: { via: 'direct' }, tokenEvents: [{ id: 'user-token' }] });
  });

  test('transport "privilege" dispatches to callMcpToolViaPrivilege', async () => {
    const { result } = renderHook(() => useMcpToolTransport('privilege'));
    const outcome = await result.current('get_my_accounts', { a: 1 });
    expect(callMcpToolViaPrivilege).toHaveBeenCalledWith('get_my_accounts', { a: 1 }, {});
    expect(directCallMcpTool).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: { via: 'privilege' }, tokenEvents: [] });
  });

  test('defaults params/opts when the caller omits them, for either transport', async () => {
    const { result } = renderHook(() => useMcpToolTransport('direct'));
    await result.current('list_transactions');
    expect(directCallMcpTool).toHaveBeenCalledWith('list_transactions', {}, {});
  });
});
