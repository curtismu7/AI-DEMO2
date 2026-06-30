import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
vi.mock('../../../services/bffAxios', () => ({ default: { post: vi.fn() } }));
import bffAxios from '../../../services/bffAxios';
import OpsAssistantChat from '../OpsAssistantChat';

it('sends the question to the ops-assistant endpoint and shows the reply', async () => {
  bffAxios.post.mockResolvedValueOnce({ data: { reply: 'No open appointments.', success: true } });
  render(<OpsAssistantChat vertical="healthcare" query="maya" />);
  fireEvent.click(screen.getByRole('button', { name: /ops assistant/i }));
  fireEvent.change(screen.getByPlaceholderText(/ask about this customer/i), { target: { value: 'summarize' } });
  fireEvent.submit(screen.getByTestId('ops-chat-form'));
  await waitFor(() => expect(screen.getByText('No open appointments.')).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/healthcare/ops-assistant', { message: 'summarize', query: 'maya' });
});
