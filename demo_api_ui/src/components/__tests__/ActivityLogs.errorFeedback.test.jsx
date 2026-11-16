// demo_api_ui/src/components/__tests__/ActivityLogs.errorFeedback.test.jsx
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import { notifyError } from '../../utils/appToast';
import ActivityLogs from '../ActivityLogs';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../utils/appToast', () => ({
  notifyError: vi.fn(),
}));

const USER = { id: 'admin-1', role: 'admin' };

function renderLogs() {
  render(
    <MemoryRouter>
      <ActivityLogs user={USER} onLogout={() => {}} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The record panes keep the visitor's Form | JSON choice in localStorage; start every test from the default (Form).
  localStorage.clear();
  apiClient.get.mockResolvedValue({ data: { logs: [], pagination: {} } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

test('finding #50: notifies the admin when exportLogs fails', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/admin/activity/export') {
      return Promise.reject(new Error('export failed'));
    }
    return Promise.resolve({ data: { logs: [], pagination: {} } });
  });

  renderLogs();

  const exportButton = await screen.findByRole('button', { name: 'Export CSV' });
  fireEvent.click(exportButton);

  await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Failed to export activity logs'));
});

test('finding #50: notifies the admin when clearOldLogs fails', async () => {
  apiClient.delete.mockRejectedValueOnce(new Error('clear failed'));

  renderLogs();

  const clearButton = await screen.findByRole('button', { name: 'Clear Old Logs' });
  fireEvent.click(clearButton);

  await waitFor(() => expect(notifyError).toHaveBeenCalledWith('Failed to clear old activity logs'));
});

test('the record modal shows headers, request body and response body as shared JSON panes', async () => {
  const log = {
    id: 'log-1',
    timestamp: '2026-11-16T10:00:00Z',
    username: 'alice',
    action: 'GET_ACCOUNTS',
    endpoint: '/accounts',
    ipAddress: '10.0.0.1',
    responseStatus: 200,
    duration: 12,
    userAgent: 'vitest-agent',
    requestBody: { filter: 'open' },
    responseBody: { accounts: [{ id: 'acct-1' }] },
  };
  apiClient.get.mockResolvedValue({ data: { logs: [log], pagination: {} } });

  renderLogs();
  fireEvent.click(await screen.findByText('/accounts'));

  const headers = await screen.findByRole('group', { name: 'Request headers' });
  expect(headers).toHaveTextContent('vitest-agent');
  expect(headers).toHaveTextContent('Bearer [TOKEN]');
  expect(screen.getByRole('group', { name: 'Request body' })).toHaveTextContent('open');
  expect(screen.getByRole('group', { name: 'Response body' })).toHaveTextContent('acct-1');
  // No hand-rolled code box and no scroll box around a pane.
  expect(document.querySelector('.activity-record-modal__code')).toBeNull();

  fireEvent.click(within(screen.getByRole('group', { name: 'Request body' }).closest('.jp-box')).getByRole('button', { name: 'JSON' }));
  // Wait for the JSON view itself before reading it: the click switches the view on the next render.
  await waitFor(() => expect(document.querySelector('pre.jp-raw[aria-label="Request body"]')).not.toBeNull());
  expect(JSON.parse(document.querySelector('pre.jp-raw[aria-label="Request body"]').textContent)).toEqual({ filter: 'open' });
});
