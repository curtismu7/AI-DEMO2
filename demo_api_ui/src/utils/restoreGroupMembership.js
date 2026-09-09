import apiClient from '../services/apiClient';

/**
 * Put the demo user back into the vertical's premiumTier group.
 *
 * Idempotent, and deliberately swallows every error: this runs on paths that are
 * already unhappy (an abandoned run, a logout), and a throw here would mask the
 * original failure. A stranded `out` state breaks UC2/UC37 — which share the
 * gated tool — and reddens /group-policy for everyone on a shared cluster, so
 * best-effort restore beats no restore.
 */
export async function restoreGroupMembership() {
  try {
    await apiClient.post(
      '/api/groups/membership/toggle',
      { inGroup: true, category: 'premiumTier' },
      { _noAuthBanner: true },
    );
  } catch (e) {
    console.warn('[restoreGroupMembership] could not restore membership:', e.message);
  }
}
