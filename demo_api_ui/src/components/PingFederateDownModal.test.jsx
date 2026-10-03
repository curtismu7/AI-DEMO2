import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import apiClient from '../services/apiClient';
import PingFederateDownModal from './PingFederateDownModal';

const realLocation = window.location;

function openOnPfDown() {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search: '?error=oauth_provider&idp_error=pingfederate_unreachable', href: '' },
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('PingFederateDownModal', () => {
  it('opens when the URL carries idp_error=pingfederate_unreachable', () => {
    openOnPfDown();
    render(<PingFederateDownModal />);
    expect(screen.getByText('PingFederate is not responding')).toBeTruthy();
  });

  it('stays closed for any other URL', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { search: '?error=oauth_provider&idp_error=server_error', href: '' },
    });
    render(<PingFederateDownModal />);
    expect(screen.queryByText('PingFederate is not responding')).toBeNull();
  });

  it('Start PingFederate starts it, waits until it answers, then goes to sign-in', async () => {
    openOnPfDown();
    apiClient.post.mockResolvedValue({ data: { ok: true } });
    apiClient.get.mockResolvedValue({ data: { down: false } });
    render(<PingFederateDownModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Start PingFederate' }));
    await waitFor(() => expect(window.location.href).toBe('/api/auth/oauth/user/login'));
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/pingfederate/start');
    expect(apiClient.get).toHaveBeenCalledWith('/api/auth/pingfederate/status');
  });

  it('Sign in with PingOne switches the provider, then goes to sign-in', async () => {
    openOnPfDown();
    apiClient.post.mockResolvedValue({ data: { ok: true } });
    render(<PingFederateDownModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with PingOne' }));
    await waitFor(() => expect(window.location.href).toBe('/api/auth/oauth/user/login'));
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/pingfederate/use-pingone');
  });

  it('shows the server message and stays put when starting fails', async () => {
    openOnPfDown();
    apiClient.post.mockRejectedValue({ response: { data: { message: 'This deployment cannot start PingFederate.' } } });
    render(<PingFederateDownModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Start PingFederate' }));
    expect(await screen.findByText('This deployment cannot start PingFederate.')).toBeTruthy();
    expect(window.location.href).toBe('');
  });
});
