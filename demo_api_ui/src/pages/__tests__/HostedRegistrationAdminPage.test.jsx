import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HostedRegistrationAdminPage from '../HostedRegistrationAdminPage';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

test('shows pending registrations and approves one', async () => {
  apiClient.get.mockResolvedValue({ data: { registrations: [{ id: 'req-1', email: 'alice@pingidentity.com', status: 'pending_approval', requestedRole: 'user' }] } });
  apiClient.post.mockResolvedValue({ data: { id: 'req-1', status: 'approved' } });
  render(<HostedRegistrationAdminPage />);
  expect(await screen.findByText('alice@pingidentity.com')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /approve/i }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/admin/hosted-registrations/req-1/approve', { role: 'user' }));
});
