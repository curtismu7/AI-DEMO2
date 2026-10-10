import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearningHubDocuments from './LearningHubDocuments';
import { SessionTokenProvider } from '../context/SessionTokenContext';
import * as sessionExpiry from '../services/sessionResolver';

vi.mock('../services/documentRagAPI', () => ({
  searchDocuments: vi.fn().mockResolvedValue([{ document_id: 'd1', title: 'OAuth Guide', section: 'Token exchange', page_number: 4, text: 'Use a scoped exchange.' }]),
  listDocuments: vi.fn().mockResolvedValue([{ document_id: 'd1', title: 'OAuth Guide', chunks: 3 }]),
  indexDocuments: vi.fn(),
}));

vi.mock('../services/sessionResolver', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveSessionExpiry: vi.fn() };
});

function renderDocuments() {
  return render(
    <SessionTokenProvider>
      <LearningHubDocuments />
    </SessionTokenProvider>,
  );
}

describe('LearningHubDocuments', () => {
  it('shows retrieved document citations after a search', async () => {
    vi.mocked(sessionExpiry.resolveSessionExpiry).mockResolvedValue({ sessionType: 'user', expiresAt: Date.now() + 60000 });
    renderDocuments();
    fireEvent.change(screen.getByLabelText('Search Learning Hub documents'), { target: { value: 'OAuth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search documents' }));
    await waitFor(() => expect(screen.getByText('OAuth Guide')).toBeInTheDocument());
    expect(screen.getByText(/Token exchange/)).toBeInTheDocument();
    expect(screen.getByText(/page 4/i)).toBeInTheDocument();
  });

  it('disables the signed-in controls for a guest and never shows the raw 401', async () => {
    vi.mocked(sessionExpiry.resolveSessionExpiry).mockResolvedValue({ sessionType: null, expiresAt: null });
    renderDocuments();
    // Guest notice appears after the session check resolves; controls disabled
    // so no request — and no error text — can fire.
    expect(await screen.findByText(/sign in to search and index documents/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Search Learning Hub documents')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Search documents' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Answer with sources' })).toBeDisabled();
  });
});
