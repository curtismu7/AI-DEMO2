import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearningHubDocuments from './LearningHubDocuments';

vi.mock('../services/documentRagAPI', () => ({
  searchDocuments: vi.fn().mockResolvedValue([{ document_id: 'd1', title: 'OAuth Guide', section: 'Token exchange', page_number: 4, text: 'Use a scoped exchange.' }]),
  listDocuments: vi.fn().mockResolvedValue([{ document_id: 'd1', title: 'OAuth Guide', chunks: 3 }]),
  indexDocuments: vi.fn(),
}));

describe('LearningHubDocuments', () => {
  it('shows retrieved document citations after a search', async () => {
    render(<LearningHubDocuments />);
    fireEvent.change(screen.getByLabelText('Search Learning Hub documents'), { target: { value: 'OAuth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search documents' }));
    await waitFor(() => expect(screen.getByText('OAuth Guide')).toBeInTheDocument());
    expect(screen.getByText(/Token exchange/)).toBeInTheDocument();
    expect(screen.getByText(/page 4/i)).toBeInTheDocument();
  });
});
