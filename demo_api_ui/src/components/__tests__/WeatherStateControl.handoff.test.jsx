// WeatherStateControl resets the gateway scope when it unmounts, so a scope left
// on "Any" can't make UC31 permit later. Leaving through the page's own Run
// button must hand that reset to the dashboard instead: resetting on the way out
// undid the change before the run it was made for (UC32).
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import WeatherStateControl from '../WeatherStateControl';
import { markLeavingToRun, takeRestoreAfterRun } from '../../utils/weatherScopeHandoff';

const FLAG = 'ff_weather_mcp_allowed_state';
const flagsResponse = (value) => ({
  ok: true,
  json: async () => ({ flags: [{ id: FLAG, value }] }),
});

const patchCallsTo = (value) =>
  global.fetch.mock.calls.filter(
    ([, opts]) => opts?.method === 'PATCH' && JSON.parse(opts.body).updates[FLAG] === value,
  );

async function renderAndSaveAny() {
  const utils = render(<WeatherStateControl />);
  const select = utils.container.querySelector('select');
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled();
  });
  fireEvent.change(select, { target: { value: 'any' } });
  await waitFor(() => {
    expect(patchCallsTo('any')).toHaveLength(1);
    expect(select.disabled).toBe(false);
  });
  return utils;
}

describe('WeatherStateControl scope reset on leaving the page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    global.fetch = vi.fn((url, opts = {}) => {
      if (opts.method === 'PATCH') {
        return Promise.resolve(flagsResponse(JSON.parse(opts.body).updates[FLAG]));
      }
      return Promise.resolve(flagsResponse('texas'));
    });
  });

  it('resets the scope on the way out when leaving any other way, as before', async () => {
    const { unmount } = await renderAndSaveAny();
    unmount();
    expect(patchCallsTo('texas')).toHaveLength(1);
    expect(takeRestoreAfterRun()).toBe(false);
  });

  it('hands the reset to the dashboard when leaving through Run', async () => {
    const { unmount } = await renderAndSaveAny();
    markLeavingToRun();
    unmount();
    expect(patchCallsTo('texas')).toHaveLength(0);
    expect(takeRestoreAfterRun()).toBe(true);
  });

  it('leaves nothing pending when Run follows no scope change', async () => {
    const { unmount } = render(<WeatherStateControl />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    markLeavingToRun();
    unmount();
    expect(patchCallsTo('texas')).toHaveLength(0);
    expect(takeRestoreAfterRun()).toBe(false);
  });
});
