'use strict';

/**
 * restorePremiumTierOnLogout — the logout-time backstop for an abandoned
 * group-gated (UC9) run.
 *
 * This is deliberately unit-tested in isolation (not through the
 * /api/auth/logout route) because that route lives directly on the Express
 * app in server.js, not in a requireable router module — booting the whole
 * app just to reach this one block would test far more than this file cares
 * about. Only pingOneGroupMembershipService is mocked; groupPolicy and
 * verticalManifest run for real against the banking manifest, same as
 * groupMembershipToggle.test.js.
 *
 * The failure mode this backstop exists to prevent is silent: a broken
 * session-field read just no-ops forever, and the first anyone knows is a
 * demo user stranded outside premiumTier denying UC2/UC37 on a shared
 * cluster. These tests exist so that regression is caught here instead.
 */

jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(() => true),
  setUserGroupMembership: jest.fn(),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const { verticalManifest } = require('../services/verticalManifest');
const { restorePremiumTierOnLogout } = require('../services/groupMembershipLogoutRestore');

describe('restorePremiumTierOnLogout', () => {
  beforeAll(() => { verticalManifest.init(); });

  beforeEach(() => {
    jest.clearAllMocks();
    membershipService.isReady.mockReturnValue(true);
    membershipService.setUserGroupMembership.mockResolvedValue({ changed: true, inGroup: true });
  });

  it('restores the resolved user into the active vertical\'s premiumTier group', async () => {
    const req = {
      session: {
        user: { username: 'demoUser', oauthId: 'user-123' },
        active_vertical: 'banking',
      },
    };

    await restorePremiumTierOnLogout(req);

    expect(membershipService.setUserGroupMembership).toHaveBeenCalledWith({
      username: 'demoUser',
      pingOneUserId: 'user-123',
      groupName: 'Banking_PremiumTier',
      inGroup: true,
    });
  });

  it('resolves an unresolvable user (no session.user) safely, without throwing', async () => {
    const req = { session: { active_vertical: 'banking' } };

    await expect(restorePremiumTierOnLogout(req)).resolves.toBeUndefined();
    // Still calls through with null identifiers — rejecting the write becomes
    // PingOne's call, not ours to pre-empt — but critically never throws, so
    // logout always completes.
    expect(membershipService.setUserGroupMembership).toHaveBeenCalledWith({
      username: null,
      pingOneUserId: null,
      groupName: 'Banking_PremiumTier',
      inGroup: true,
    });
  });

  it('resolves a request with no session object at all safely, without throwing', async () => {
    // verticalManifest.resolver.activeIdFor falls back to the process-global
    // active vertical when req.session is missing, so this still reaches the
    // service — with null identifiers — rather than crashing on req.session.user.
    await expect(restorePremiumTierOnLogout({})).resolves.toBeUndefined();
  });

  it('never rejects when setUserGroupMembership rejects — logout must still succeed', async () => {
    membershipService.setUserGroupMembership.mockRejectedValue(new Error('503 live_lookup_unavailable'));
    const req = {
      session: {
        user: { username: 'demoUser', oauthId: 'user-123' },
        active_vertical: 'banking',
      },
    };

    await expect(restorePremiumTierOnLogout(req)).resolves.toBeUndefined();
  });
});
