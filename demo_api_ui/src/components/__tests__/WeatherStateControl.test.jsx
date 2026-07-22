import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeatherStateControl from '../WeatherStateControl';

function mockFetchSequence(getBody, patchBody) {
  global.fetch = jest.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => getBody });
    }
    return Promise.resolve({ ok: true, json: async () => patchBody });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
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

test('shows an error and reverts the select on a failed PATCH', async () => {
  global.fetch = jest.fn((url, opts) => {
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
