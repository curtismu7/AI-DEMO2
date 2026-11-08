import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeatherStateControl from '../WeatherStateControl';

function mockFetchSequence(getBody, patchBody) {
  global.fetch = vi.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => getBody });
    }
    return Promise.resolve({ ok: true, json: async () => patchBody });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('loads and displays the current allowed state', async () => {
  mockFetchSequence({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] });
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));
});

test('PATCHes on change and reflects the confirmed value', async () => {
  mockFetchSequence(
    { flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] },
    { flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'michigan' }] },
  );
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'michigan' } });

  await waitFor(() => {
    const patchCall = global.fetch.mock.calls.find((c) => c[1] && c[1].method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(patchCall[1].body)).toEqual({ updates: { ff_weather_mcp_allowed_state: 'michigan' } });
  });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('michigan'));
});

test('restores the default state when the control unmounts after a change', async () => {
  // The flag is live and sticky — a presenter who flipped it for UC32 and moved
  // on left UC31 (Miami) permitting on the next pass of the script.
  mockFetchSequence(
    { flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] },
    { flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'any' }] },
  );
  const { unmount } = render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'any' } });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('any'));

  unmount();

  const patches = global.fetch.mock.calls.filter((c) => c[1] && c[1].method === 'PATCH');
  expect(patches).toHaveLength(2);
  expect(JSON.parse(patches[1][1].body)).toEqual({ updates: { ff_weather_mcp_allowed_state: 'texas' } });
  expect(patches[1][1].keepalive).toBe(true);
});

test('does not PATCH on unmount when nothing was changed', async () => {
  mockFetchSequence({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'any' }] });
  const { unmount } = render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('any'));
  unmount();
  expect(global.fetch.mock.calls.filter((c) => c[1] && c[1].method === 'PATCH')).toHaveLength(0);
});

test('shows an error and reverts the select on a failed PATCH', async () => {
  global.fetch = vi.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] }) });
    }
    return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'server_error' }) });
  });
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'any' } });

  await waitFor(() => expect(screen.getByText(/error/i)).toBeInTheDocument());
  expect(screen.getByRole('combobox')).toHaveValue('texas');
});

test('shows a visible Saving… cue while a save is in flight, then says what was saved', async () => {
  let release;
  global.fetch = vi.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] }) });
    }
    return new Promise((resolve) => { release = resolve; });
  });
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'michigan' } });
  const cue = await screen.findByText('Saving…');
  expect(cue.getAttribute('role')).toBe('status');
  // the select keeps focus (never disabled), and the cue is words, not only aria-busy
  expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false);
  await act(async () => {
    release({ ok: true, json: async () => ({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'michigan' }] }) });
  });
  await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
  expect(screen.getByText('Saved: Michigan.')).toBeInTheDocument();
});

test('a second change while a save is in flight is dropped with a message, not silently', async () => {
  let release;
  global.fetch = vi.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] }) });
    }
    return new Promise((resolve) => { release = resolve; });
  });
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'michigan' } });
  await screen.findByText('Saving…');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'any' } });
  expect(await screen.findByText(/Not changed: the previous choice was still saving/)).toBeInTheDocument();
  // only the first change was sent, and the select shows the value actually being saved
  expect(global.fetch.mock.calls.filter((c) => c[1] && c[1].method === 'PATCH')).toHaveLength(1);
  expect(screen.getByRole('combobox')).toHaveValue('michigan');
  await act(async () => {
    release({ ok: true, json: async () => ({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'michigan' }] }) });
  });
  // the explanation outlives the save, and clears on the next deliberate change
  expect(screen.getByText(/Not changed/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'texas' } });
  await waitFor(() => expect(screen.queryByText(/Not changed/)).toBeNull());
});
