import apiClient from './apiClient';

export const TEMPORARY_P1AZ_FLAG_IDS = [
  'ff_mcp_gateway_pinggateway',
  'ff_authorize_real',
];

/**
 * Temporarily arms the live P1AZ path for a presenter-led test.
 * Only flags changed by this lease are restored, and only if they still have
 * the lease value when the timer expires.
 */
export async function armTemporaryP1azFlags({
  client = apiClient,
  leaseMs = 60_000,
  onRestored,
} = {}) {
  const { data } = await client.get('/api/admin/feature-flags', { _silent: true });
  const current = Object.fromEntries(
    (data?.flags || [])
      .filter((flag) => TEMPORARY_P1AZ_FLAG_IDS.includes(flag.id))
      .map((flag) => [flag.id, flag.value === true]),
  );
  const changed = Object.fromEntries(
    TEMPORARY_P1AZ_FLAG_IDS
      .filter((id) => current[id] === false)
      .map((id) => [id, false]),
  );
  const updates = Object.fromEntries(
    TEMPORARY_P1AZ_FLAG_IDS
      .filter((id) => current[id] === false)
      .map((id) => [id, true]),
  );

  if (Object.keys(updates).length) {
    await client.patch(
      '/api/admin/feature-flags',
      { updates },
      { _noAuthBanner: true },
    );
  }

  const timer = setTimeout(async () => {
    try {
      const latest = await client.get('/api/admin/feature-flags', { _silent: true });
      const restore = Object.fromEntries(
        Object.entries(changed).filter(([id]) =>
          latest?.data?.flags?.find((flag) => flag.id === id)?.value === true,
        ),
      );
      if (Object.keys(restore).length) {
        await client.patch(
          '/api/admin/feature-flags',
          { updates: restore },
          { _noAuthBanner: true },
        );
      }
      onRestored?.();
    } catch (_) {
      // A lease expiry must never surface an auth banner over the running demo.
    }
  }, leaseMs);

  return () => clearTimeout(timer);
}
