import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import NotebookLmPage from '../NotebookLmPage';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import apiClient from '../../services/apiClient';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotebookLmPage', () => {
  it('lists notebooks returned by the BFF', async () => {
    apiClient.get.mockResolvedValue({ data: { notebooks: [{ id: 'nb1', title: 'Ping Docs' }] } });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText('Ping Docs')).toBeInTheDocument());
  });

  it('names the cause when the sidecar is down instead of spinning', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 503, data: { error: 'NotebookLM unavailable', reason: 'sidecar_unreachable' } },
    });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText(/sidecar is not running/i)).toBeInTheDocument());
  });

  it('tells the user to sign in again when host auth expired', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 503, data: { error: 'NotebookLM unavailable', reason: 'auth_expired' } },
    });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText(/host auth expired/i)).toBeInTheDocument());
  });
});
