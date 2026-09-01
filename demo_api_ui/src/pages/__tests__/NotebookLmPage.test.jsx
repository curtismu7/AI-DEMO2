import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('shows a live progress indicator while an ask is in flight', async () => {
    apiClient.get.mockResolvedValue({ data: { notebooks: [{ id: 'nb1', title: 'Ping Docs' }] } });
    apiClient.get.mockResolvedValueOnce({ data: { notebooks: [{ id: 'nb1', title: 'Ping Docs' }] } });
    // never resolves — the ask stays in flight so the indicator must stay visible
    apiClient.post.mockReturnValue(new Promise(() => {}));

    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText('Ping Docs')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ping Docs'));
    fireEvent.change(screen.getByLabelText(/Question/i), { target: { value: 'what is mfa?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }));

    // role=status so a screen reader announces it, not just sighted users
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/Searching the sources/i);
  });

  it('tells the user to sign in again when host auth expired', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 503, data: { error: 'NotebookLM unavailable', reason: 'auth_expired' } },
    });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText(/host auth expired/i)).toBeInTheDocument());
  });
});
