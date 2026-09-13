import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WEATHER_SCOPE_DEFAULT,
  WEATHER_SCOPE_FLAG_ID,
  markLeavingToRun,
  takeLeavingToRun,
  markRestoreAfterRun,
  takeRestoreAfterRun,
  restoreDefaultScopeAfterRun,
} from '../weatherScopeHandoff';

describe('weather scope handoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('honours a leaving-to-run marker set moments ago, once', () => {
    markLeavingToRun(1000);
    expect(takeLeavingToRun(1500)).toBe(true);
    expect(takeLeavingToRun(1500)).toBe(false);
  });

  it('ignores a stale marker, so it cannot suppress a later reset', () => {
    markLeavingToRun(1000);
    expect(takeLeavingToRun(1000 + 6000)).toBe(false);
  });

  it('takes a restore marker once', () => {
    markRestoreAfterRun();
    expect(takeRestoreAfterRun()).toBe(true);
    expect(takeRestoreAfterRun()).toBe(false);
  });

  it('restores the default scope only after a handed-off run', async () => {
    const client = { patch: vi.fn().mockResolvedValue({}) };
    expect(restoreDefaultScopeAfterRun(client)).toBe(false);
    expect(client.patch).not.toHaveBeenCalled();

    markRestoreAfterRun();
    expect(restoreDefaultScopeAfterRun(client)).toBe(true);
    await vi.waitFor(() => {
      expect(client.patch).toHaveBeenCalledWith('/api/admin/feature-flags', {
        updates: { [WEATHER_SCOPE_FLAG_ID]: WEATHER_SCOPE_DEFAULT },
      });
    });
  });

  it('swallows a failed restore rather than breaking the run that triggered it', async () => {
    const client = { patch: vi.fn().mockRejectedValue(new Error('offline')) };
    markRestoreAfterRun();
    expect(restoreDefaultScopeAfterRun(client)).toBe(true);
    await vi.waitFor(() => {
      expect(client.patch).toHaveBeenCalled();
    });
  });
});
