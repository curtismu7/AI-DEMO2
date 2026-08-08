import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../utils/appToast', () => ({
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn(),
}));

import bffAxios from '../../../services/bffAxios';
import CaseNotes from '../CaseNotes';

it('loads and lists existing notes', async () => {
  bffAxios.get.mockResolvedValueOnce({
    data: { data: { notes: [{ id: 'n1', at: '2026-08-08T10:44:00.000Z', operator: 'dana', body: 'Photos received.' }] } },
  });
  render(<CaseNotes vertical="sporting-goods" customerId="u1" />);
  await waitFor(() => expect(screen.getByText('Photos received.')).toBeInTheDocument());
  expect(bffAxios.get).toHaveBeenCalledWith('/api/admin/sporting-goods/cases/u1/notes');
});

it('posts a new note and shows it', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { data: { notes: [] } } });
  bffAxios.post.mockResolvedValueOnce({
    data: { ok: true, note: { id: 'n1', at: '2026-08-08T10:45:00.000Z', operator: 'dana', body: 'Refund issued.' } },
  });

  render(<CaseNotes vertical="sporting-goods" customerId="u1" />);
  await waitFor(() => expect(screen.getByPlaceholderText(/Add a note/i)).toBeInTheDocument());

  fireEvent.change(screen.getByPlaceholderText(/Add a note/i), { target: { value: 'Refund issued.' } });
  fireEvent.click(screen.getByRole('button', { name: /save note/i }));

  await waitFor(() => expect(screen.getByText('Refund issued.')).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/admin/sporting-goods/cases/u1/notes',
    { body: 'Refund issued.' },
  );
});
