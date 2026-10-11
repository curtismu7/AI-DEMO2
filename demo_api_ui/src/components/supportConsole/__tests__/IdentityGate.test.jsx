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
import IdentityGate from '../IdentityGate';

const CUSTOMER = { id: 'u1', name: 'Marcus Hall' };

it('shows the unverified state and offers to verify the customer', () => {
  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified={false} onVerified={() => {}} />);
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'false');
  expect(screen.getByRole('button', { name: /verify customer/i })).toBeInTheDocument();
});

it('posts initiate for the selected customer and shows the OTP step', async () => {
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } });

  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified={false} onVerified={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));

  await waitFor(() => expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/admin/sporting-goods/verify/initiate',
    { customerId: 'u1' },
  );
});

it('shows the verified state without a verify button', () => {
  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified onVerified={() => {}} />);
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'true');
  expect(screen.queryByRole('button', { name: /verify customer/i })).toBeNull();
});
