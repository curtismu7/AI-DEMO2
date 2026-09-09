import { vi } from 'vitest';
import apiClient from '../../services/apiClient';
import { restoreGroupMembership } from '../restoreGroupMembership';

vi.mock('../../services/apiClient', () => ({
  default: { post: vi.fn() },
}));

beforeEach(() => { apiClient.post.mockReset(); });

test('restores the demo user into premiumTier', async () => {
  apiClient.post.mockResolvedValue({ data: { verified: true, inGroup: true } });
  await restoreGroupMembership();
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/groups/membership/toggle',
    { inGroup: true, category: 'premiumTier' },
    expect.anything(),
  );
});

// Restore runs on paths that are already failing (abandoned run, logout). It must
// never throw a second error over the first one.
test('never throws, even when the toggle fails', async () => {
  apiClient.post.mockRejectedValue(new Error('503 live_lookup_unavailable'));
  await expect(restoreGroupMembership()).resolves.toBeUndefined();
});
