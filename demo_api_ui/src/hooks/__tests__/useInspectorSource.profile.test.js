import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useInspectorSource } from '../useInspectorSource';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: { tools: [] } });
  apiClient.post.mockResolvedValue({ data: {} });
});

describe('useInspectorSource — custom profile support', () => {
  it('loads tools with no profile query when no profileId is given', async () => {
    renderHook(() => useInspectorSource('custom'));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith('/api/mcp/inspector/custom-tools');
  });

  it('appends ?profile=<id> when a profileId is given', async () => {
    renderHook(() => useInspectorSource('custom', { profileId: 'custom-1' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith('/api/mcp/inspector/custom-tools?profile=custom-1');
  });

  it('reloads tools when profileId changes', async () => {
    const { rerender } = renderHook(
      ({ profileId }) => useInspectorSource('custom', { profileId }),
      { initialProps: { profileId: 'custom-1' } },
    );
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/mcp/inspector/custom-tools?profile=custom-1'));

    rerender({ profileId: 'custom-2' });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/mcp/inspector/custom-tools?profile=custom-2'));
  });

  it('includes profile in the invoke payload', async () => {
    apiClient.get.mockResolvedValue({
      data: { tools: [{ name: 'get_balance', inputSchema: { properties: {}, required: [] } }] },
    });
    apiClient.post.mockResolvedValue({ data: { result: { ok: true } } });

    const { result } = renderHook(() => useInspectorSource('custom', { profileId: 'custom-1' }));
    await waitFor(() => expect(result.current.tools.length).toBe(1));

    act(() => result.current.setSelectedTool(result.current.tools[0]));
    await act(async () => { await result.current.handleExecute(); });

    expect(apiClient.post).toHaveBeenCalledWith('/api/mcp/inspector/custom-invoke', {
      tool: 'get_balance',
      params: {},
      profile: 'custom-1',
    });
  });
});
