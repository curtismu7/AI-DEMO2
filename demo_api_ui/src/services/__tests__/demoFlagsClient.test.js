import { describe, test, expect, vi, beforeEach } from 'vitest';
import apiClient from '../apiClient';
import { enableUseCaseFlags, disableUseCaseFlags } from '../demoFlagsClient';

vi.mock('../apiClient', () => ({ default: { post: vi.fn() } }));

describe('enableUseCaseFlags', () => {
  beforeEach(() => vi.clearAllMocks());

  test('posts the useCaseId and returns the response data', async () => {
    apiClient.post.mockResolvedValue({ data: { success: true, flags: ['ff_rar'] } });
    const result = await enableUseCaseFlags('par-rar-intent-verified');
    expect(apiClient.post).toHaveBeenCalledWith('/api/demo-flags/enable', {
      useCaseId: 'par-rar-intent-verified',
    });
    expect(result).toEqual({ success: true, flags: ['ff_rar'] });
  });
});

describe('disableUseCaseFlags', () => {
  beforeEach(() => vi.clearAllMocks());

  test('posts the useCaseId and returns the response data', async () => {
    apiClient.post.mockResolvedValue({ data: { success: true, flags: ['ff_rar'] } });
    const result = await disableUseCaseFlags('par-rar-intent-verified');
    expect(apiClient.post).toHaveBeenCalledWith('/api/demo-flags/disable', {
      useCaseId: 'par-rar-intent-verified',
    });
    expect(result).toEqual({ success: true, flags: ['ff_rar'] });
  });
});
