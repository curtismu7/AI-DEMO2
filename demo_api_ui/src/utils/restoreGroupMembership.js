import apiClient from '../services/apiClient';

/**
 * Put the demo user back into the vertical's premiumTier group.
 *
 * Idempotent, and deliberately swallows every error: this runs on paths that are
 * already unhappy (an abandoned run, a logout), and a throw here would mask the
 * original failure. A stranded `out` state breaks UC2/UC37 — which share the
 * gated tool — and reddens /group-policy for everyone on a shared cluster, so
 * best-effort restore beats no restore.
 *
 * @param {string} [verticalId] vertical whose premiumTier group to restore. Omit
 *   only when the caller has no run in hand — the route then falls back to the
 *   session's active vertical, which is NOT necessarily the one that was armed.
 */
export async function restoreGroupMembership(verticalId) {
  try {
    await apiClient.post(
      '/api/groups/membership/toggle',
      {
        inGroup: true,
        category: 'premiumTier',
        ...(verticalId ? { verticalId } : {}),
      },
      { _noAuthBanner: true },
    );
  } catch (e) {
    console.warn('[restoreGroupMembership] could not restore membership:', e.message);
  }
}
