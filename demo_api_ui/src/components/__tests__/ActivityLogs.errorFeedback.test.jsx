// demo_api_ui/src/components/__tests__/ActivityLogs.errorFeedback.test.jsx
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
