import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import useLiveFlags from '../useLiveFlags';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

describe('useLiveFlags', () => {
  beforeEach(() => vi.clearAllMocks());

  test('loads flags into a map keyed by id', async () => {
    apiClient.get.mockResolvedValue({
      data: { flags: [{ id: 'ff_rar', value: 'false' }, { id: 'ciba_enabled', value: 'true' }] },
    });
    const { result } = renderHook(() => useLiveFlags());
    await waitFor(() => expect(result.current.flagsLoading).toBe(false));
    expect(result.current.flagMap).toEqual({ ff_rar: 'false', ciba_enabled: 'true' });
  });

  test('a failed load resolves to an empty map (gates stay closed, not stuck loading)', async () => {
    apiClient.get.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLiveFlags());
    await waitFor(() => expect(result.current.flagsLoading).toBe(false));
    expect(result.current.flagMap).toEqual({});
  });
});
