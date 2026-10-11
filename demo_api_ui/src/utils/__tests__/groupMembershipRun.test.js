import { vi } from 'vitest';
import apiClient from '../../services/apiClient';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
import { armGroupMembership, restoreGroupMembershipAfterRun, restoreGroupPolicyFlagAfterRun } from '../groupMembershipRun';

vi.mock('../../services/apiClient', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn() },
}));

beforeEach(() => {
  apiClient.post.mockReset();
  tokenChainTraceStore.reset();
});

test('a use case with no group requirement arms nothing', async () => {
  await expect(armGroupMembership({ useCaseId: 'delegated-access-with-proof' }, 'banking'))
    .resolves.toBeNull();
  expect(apiClient.post).not.toHaveBeenCalled();
});

// The bug this pins: the toggle used to send no verticalId, so the route fell
// back to the CURRENTLY active vertical. Running UC9 for Super Sports while
// sitting on banking stripped Banking_PremiumTier and left the sporting-goods
// group intact — the chip then PERMITted against a declared DENY_403.
test('arms the run target vertical, not whatever vertical is active', async () => {
  apiClient.post.mockResolvedValue({ data: { verified: true, inGroup: false } });
  await armGroupMembership({ useCaseId: 'group-entitlement-check', requiresGroup: 'out' }, 'sporting-goods');
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/groups/membership/toggle',
    { inGroup: false, category: 'premiumTier', verticalId: 'sporting-goods' },
    expect.anything(),
  );
});

test('throws when PingOne does not confirm the membership it was asked for', async () => {
  apiClient.post.mockResolvedValue({ data: { verified: true, inGroup: true } });
  await expect(armGroupMembership({ requiresGroup: 'out' }, 'sporting-goods'))
    .rejects.toThrow(/membership not verified/);
});

// The bug this pins: restore used to fire in the .then of /api/use-cases/demo/run,
// which only RETURNS the trigger text. The chip is dispatched later, by AIAgent,
// after the launcher navigates — so restore put the user back INTO premiumTier
// while UC9's chip was still in flight and UC9 raced to PERMIT.
test('restore waits for the chip run to reach a terminal verdict', async () => {
  apiClient.post.mockResolvedValue({ data: { verified: true, inGroup: true } });
  restoreGroupMembershipAfterRun('sporting-goods');
  expect(apiClient.post).not.toHaveBeenCalled();

  tokenChainTraceStore.beginTrace({ prompt: 'show me the premium report' });
  expect(apiClient.post).not.toHaveBeenCalled();

  tokenChainTraceStore.completeTrace(false);
  await vi.waitFor(() => {
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/groups/membership/toggle',
      { inGroup: true, category: 'premiumTier', verticalId: 'sporting-goods' },
      expect.anything(),
    );
  });

  // Every later emit on the same run must not re-fire the restore.
  tokenChainTraceStore.completeTrace(false);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

// The presenter asked for the flag to be a demo step's own doing: turn
// ff_authorize_group_policy ON when the step runs, OFF again when it ends —
// so the demo never leaves the authorization surface changed behind it.
test('restoreGroupPolicyFlagAfterRun waits for the run verdict, then flips the flag off', async () => {
  restoreGroupPolicyFlagAfterRun();
  expect(apiClient.patch).not.toHaveBeenCalled();

  // A run that has not settled must not restore yet.
  tokenChainTraceStore.beginTrace({ prompt: 'check my sensitive account details' });
  expect(apiClient.patch).not.toHaveBeenCalled();

  tokenChainTraceStore.completeTrace(false);
  await vi.waitFor(() => {
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/admin/feature-flags',
      { updates: { ff_authorize_group_policy: false } },
      expect.anything(),
    );
  });

  // Every later emit must not re-fire.
  tokenChainTraceStore.completeTrace(false);
  expect(apiClient.patch).toHaveBeenCalledTimes(1);
});
