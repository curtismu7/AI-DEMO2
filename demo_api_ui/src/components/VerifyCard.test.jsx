import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bffAxios from '../services/bffAxios';
import VerifyCard from './VerifyCard';

vi.mock('../services/bffAxios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('VerifyCard', () => {
  beforeEach(() => {
    bffAxios.get.mockResolvedValue({ data: { enabled: false, available: false } });
  });

  it('stays hidden while PingOne Verify is disabled', async () => {
    render(<VerifyCard />);
    await waitFor(() => expect(bffAxios.get).toHaveBeenCalledWith('/api/verify/availability'));
    expect(screen.queryByRole('region', { name: 'Identity verification' })).not.toBeInTheDocument();
  });

  it('resumes the saved transaction and displays only the BFF confirmed result', async () => {
    window.history.replaceState({}, '', '/profile?verify=return');
    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 'transaction-789');
    bffAxios.get.mockImplementation((url) => {
      if (url === '/api/verify/availability') return Promise.resolve({ data: { enabled: true, available: true } });
      return Promise.resolve({ data: {
        id: 'transaction-789',
        status: 'SUCCESS',
        expiresAt: '2099-01-01T00:00:00.000Z',
        verifiedAt: '2026-09-29T18:00:00.000Z',
        canEnrollRecognize: false,
      } });
    });

    render(<VerifyCard />);

    expect(await screen.findByText('Identity verification complete.')).toBeInTheDocument();
    expect(screen.getByText(/Recognize enrollment will be available after its tenant setup/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('pingone.verify.activeTransactionId')).toBeNull();
    expect(bffAxios.get).toHaveBeenCalledWith('/api/verify/transactions/transaction-789');
    expect(window.location.search).toBe('');
  });

  it('resumes a saved pending transaction after the user reloads the profile', async () => {
    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 'transaction-789');
    bffAxios.get.mockImplementation((url) => {
      if (url === '/api/verify/availability') return Promise.resolve({ data: { enabled: true, available: true } });
      return Promise.resolve({ data: {
        id: 'transaction-789',
        status: 'IN_PROGRESS',
        expiresAt: '2099-01-01T00:00:00.000Z',
        verifiedAt: null,
        canEnrollRecognize: false,
      } });
    });

    render(<VerifyCard />);

    expect(await screen.findByText(/Verification status: IN_PROGRESS/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('pingone.verify.activeTransactionId')).toBe('transaction-789');
    expect(window.location.search).toBe('');
  });

  it('does not present a manually approved or not-required result as proofing success', async () => {
    window.history.replaceState({}, '', '/profile?verify=return');
    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 'transaction-789');
    bffAxios.get.mockImplementation((url) => {
      if (url === '/api/verify/availability') return Promise.resolve({ data: { enabled: true, available: true } });
      return Promise.resolve({ data: {
        id: 'transaction-789',
        status: 'APPROVED_MANUALLY',
        expiresAt: '2099-01-01T00:00:00.000Z',
        verifiedAt: null,
        canEnrollRecognize: false,
      } });
    });

    render(<VerifyCard />);

    expect(await screen.findByText(/does not complete automated identity proofing/)).toBeInTheDocument();
    expect(screen.queryByText('Identity verification complete.')).not.toBeInTheDocument();
  });

  it('retries a temporary status-read failure within the bounded poll window', async () => {
    window.history.replaceState({}, '', '/profile?verify=return');
    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 'transaction-789');
    let statusReads = 0;
    bffAxios.get.mockImplementation((url) => {
      if (url === '/api/verify/availability') return Promise.resolve({ data: { enabled: true, available: true } });
      statusReads += 1;
      if (statusReads === 1) return Promise.reject(new Error('temporary network error'));
      return Promise.resolve({ data: {
        id: 'transaction-789',
        status: 'SUCCESS',
        expiresAt: '2099-01-01T00:00:00.000Z',
        verifiedAt: '2026-09-29T18:00:00.000Z',
        canEnrollRecognize: false,
      } });
    });
    render(<VerifyCard />);

    expect(await screen.findByText('Identity verification complete.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(statusReads).toBe(2);
  });
});
