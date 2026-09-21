import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HostedRegistrationPage from '../HostedRegistrationPage';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

test('submits a PingIdentity email and then verifies the OTP', async () => {
  apiClient.post
    .mockResolvedValueOnce({ data: { requestId: 'req-1', status: 'otp_pending' } })
    .mockResolvedValueOnce({ data: { requestId: 'req-1', status: 'pending_approval' } });
  render(<HostedRegistrationPage />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'alice@pingidentity.com' } });
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Example' } });
  fireEvent.click(screen.getByRole('button', { name: /send verification code/i }));
  expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /verify email/i }));
  expect(await screen.findByText(/awaiting administrator approval/i)).toBeInTheDocument();
});
