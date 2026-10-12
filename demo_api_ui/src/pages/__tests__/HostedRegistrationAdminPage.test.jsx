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

test('invite form posts email and shows registration link', async () => {
  apiClient.get.mockResolvedValue({ data: { registrations: [] } });
  apiClient.post.mockResolvedValue({ data: { userId: 'u-1', invite: 'sent', nativeEmail: 'skipped', registrationUrl: 'https://ping.demo/welcome?welcome=1&u=u-1' } });
  render(<HostedRegistrationAdminPage />);
  fireEvent.change(await screen.findByPlaceholderText('colleague@pingidentity.com'), { target: { value: 'bob@pingidentity.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/demo/send-invite', { email: 'bob@pingidentity.com' }));
  expect(await screen.findByRole('status')).toHaveTextContent('https://ping.demo/welcome?welcome=1&u=u-1');
  expect(screen.getByRole('status')).not.toHaveTextContent('was also sent');
});

test('invite form shows endpoint error message on failure', async () => {
  apiClient.get.mockResolvedValue({ data: { registrations: [] } });
  apiClient.post.mockRejectedValue({ response: { data: { message: 'Provisioning failed: 503' } } });
  render(<HostedRegistrationAdminPage />);
  fireEvent.change(await screen.findByPlaceholderText('colleague@pingidentity.com'), { target: { value: 'bob@pingidentity.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
  const status = await screen.findByRole('status');
  await waitFor(() => expect(status).toHaveTextContent('Provisioning failed: 503'));
});

test('send button is disabled while the invite request is pending', async () => {
  apiClient.get.mockResolvedValue({ data: { registrations: [] } });
  let resolvePost;
  apiClient.post.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));
  render(<HostedRegistrationAdminPage />);
  fireEvent.change(await screen.findByPlaceholderText('colleague@pingidentity.com'), { target: { value: 'bob@pingidentity.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
  expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
  resolvePost({ data: { userId: 'u-1', invite: 'sent', nativeEmail: 'skipped', registrationUrl: 'https://ping.demo/welcome?welcome=1' } });
  await waitFor(() => expect(screen.getByRole('button', { name: /send invite/i })).toBeEnabled());
});

test('invite form warns when the native password email fails', async () => {
  apiClient.get.mockResolvedValue({ data: { registrations: [] } });
  apiClient.post.mockResolvedValue({ data: { userId: 'u-1', invite: 'sent', nativeEmail: 'failed', registrationUrl: 'https://ping.demo/welcome?welcome=1' } });
  render(<HostedRegistrationAdminPage />);
  fireEvent.change(await screen.findByPlaceholderText('colleague@pingidentity.com'), { target: { value: 'bob@pingidentity.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('could not be sent');
  expect(status).not.toHaveTextContent('was also sent');
});
