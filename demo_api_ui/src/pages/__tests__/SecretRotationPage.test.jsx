import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const APPS = [
  { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'PINGONE_AGENT_CLIENT_SECRET' },
  { id: 'a2', clientId: 'c2', name: 'Other App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'AGENT_CLIENT_SECRET' },
];

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../../services/apiClient';
import SecretRotationPage from '../SecretRotationPage';

/** Arms apiClient.get: the apps list, then a run poll returning `run`. */
function arm(run) {
  apiClient.get.mockImplementation((url) => (url.endsWith('/apps')
    ? Promise.resolve({ data: { apps: APPS } })
    : Promise.resolve({ data: run })));
  apiClient.post.mockResolvedValue({ data: { runId: '11111111-1111-1111-1111-111111111111' } });
}

async function rotate(user, appName) {
  await user.click(await screen.findByText(appName));
  await user.click(screen.getByRole('button', { name: /rotate secret/i }));
  await user.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
  await user.click(screen.getByRole('button', { name: /arm rotation/i }));
  await user.click(screen.getByRole('button', { name: /yes, rotate/i }));
}

describe('SecretRotationPage', () => {
  // clearAllMocks wipes call history, not an implementation — every test arms
  // its own.
  beforeEach(() => {
    vi.clearAllMocks();
    arm({ status: 'running', lines: [] });
  });

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

  // C2/I6: the vault key is server-derived. The page used to fall back to a key
  // invented from the display name, which can never match a real vault entry.
  test('sends the server-supplied vaultKey verbatim and never invents one', async () => {
    render(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    const body = apiClient.post.mock.calls[0][1];
    expect(body.vaultKey).toBe('PINGONE_AGENT_CLIENT_SECRET');
    expect(body.vaultKey).not.toBe('DEMO_APP_CLIENT_SECRET');
  });

  // I1: the rotation runs inside the BFF container, which ships no docker CLI
  // and no kubectl — asking for either can only fail.
  test('never asks the server for a container restart or a k8s patch', async () => {
    render(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({ restart: false, k8s: false });
  });

  // C4: a refused rotation touched nothing — showing the mask claims a secret
  // that was never written.
  test('an aborted run shows no secret mask', async () => {
    arm({ status: 'aborted', lines: ['[rotate] DONE aborted: Refusing to rotate "X".'] });
    render(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText(/nothing was changed/i)).toBeInTheDocument();
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
  });

  test('a completed run shows the mask and the fingerprint', async () => {
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    render(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText('••••••••')).toBeInTheDocument();
    expect(screen.getByText('deadbeef')).toBeInTheDocument();
  });

  // T6
  test('selecting another app clears the previous run\'s fingerprint and status', async () => {
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    render(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText('deadbeef')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Other App'));

    expect(screen.queryByText('deadbeef')).not.toBeInTheDocument();
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
    expect(screen.queryByText(/rotating…/i)).not.toBeInTheDocument();
  });

  test('switching the selected app clears an armed rotation for the previous app', async () => {
    render(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));
    await userEvent.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
    await userEvent.click(screen.getByRole('button', { name: /arm rotation/i }));
    expect(screen.getByRole('button', { name: /yes, rotate/i })).toBeInTheDocument();

    await userEvent.click(screen.getByText('Other App'));

    expect(screen.queryByRole('button', { name: /yes, rotate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /arm rotation/i })).toBeDisabled();
  });
});
