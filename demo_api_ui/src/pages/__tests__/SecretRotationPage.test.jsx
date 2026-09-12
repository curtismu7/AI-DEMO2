import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { apps: [
      { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' },
    ] } }),
    post: vi.fn().mockResolvedValue({ data: { runId: '11111111-1111-1111-1111-111111111111' } }),
  },
}));

import apiClient from '../../services/apiClient';
import SecretRotationPage from '../SecretRotationPage';

describe('SecretRotationPage', () => {
  beforeEach(() => vi.clearAllMocks());

  test('lists rotatable apps', async () => {
    render(<SecretRotationPage />);
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
  });

  test('requires a reason before arming, and requires arming before rotating', async () => {
    render(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));

    const armButton = screen.getByRole('button', { name: /arm rotation/i });
    expect(armButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: /yes, rotate/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
    expect(armButton).toBeEnabled();

    await userEvent.click(armButton);
    expect(apiClient.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, rotate/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/admin/secret-rotation/start',
      expect.objectContaining({ appId: 'a1', reason: 'rotating a leaked credential' }),
    ));
  });
});
