import { describe, expect, it, vi } from 'vitest';
import { armTemporaryP1azFlags } from '../temporaryP1azFlags';

describe('armTemporaryP1azFlags', () => {
  it('enables the live gateway and P1AZ flags, then restores changed values after the lease', async () => {
    vi.useFakeTimers();
    const client = {
      get: vi.fn()
        .mockResolvedValueOnce({
          data: {
            flags: [
              { id: 'ff_mcp_gateway_pinggateway', value: false },
              { id: 'ff_authorize_real', value: false },
            ],
          },
        })
        .mockResolvedValue({
        data: {
          flags: [
            { id: 'ff_mcp_gateway_pinggateway', value: true },
            { id: 'ff_authorize_real', value: true },
          ],
        },
      }),
      patch: vi.fn().mockResolvedValue({ data: { updated: true } }),
    };

    await armTemporaryP1azFlags({ client, leaseMs: 60_000 });

    expect(client.patch).toHaveBeenNthCalledWith(
      1,
      '/api/admin/feature-flags',
      { updates: { ff_mcp_gateway_pinggateway: true, ff_authorize_real: true } },
      { _noAuthBanner: true },
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.patch).toHaveBeenNthCalledWith(
      2,
      '/api/admin/feature-flags',
      { updates: { ff_mcp_gateway_pinggateway: false, ff_authorize_real: false } },
      { _noAuthBanner: true },
    );
    vi.useRealTimers();
  });

  it('does not restore a flag that was already enabled before the test', async () => {
    vi.useFakeTimers();
    const client = {
      get: vi.fn()
        .mockResolvedValueOnce({
          data: {
            flags: [
              { id: 'ff_mcp_gateway_pinggateway', value: true },
              { id: 'ff_authorize_real', value: false },
            ],
          },
        })
        .mockResolvedValue({
        data: {
          flags: [
            { id: 'ff_mcp_gateway_pinggateway', value: true },
            { id: 'ff_authorize_real', value: true },
          ],
        },
      }),
      patch: vi.fn().mockResolvedValue({ data: { updated: true } }),
    };

    await armTemporaryP1azFlags({ client, leaseMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.patch).toHaveBeenLastCalledWith(
      '/api/admin/feature-flags',
      { updates: { ff_authorize_real: false } },
      { _noAuthBanner: true },
    );
    vi.useRealTimers();
  });
});
