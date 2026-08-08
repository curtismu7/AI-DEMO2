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

it('shows the unverified state and offers to send a code', () => {
  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified={false} onVerified={() => {}} />);
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'false');
  expect(screen.getByRole('button', { name: /send one-time code/i })).toBeInTheDocument();
});

it('posts initiate for the selected customer and reports back', async () => {
  const expiresAt = Date.now() + 900000;
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } });
  const onVerified = vi.fn();

  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified={false} onVerified={onVerified} />);
  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));

  await waitFor(() => expect(onVerified).toHaveBeenCalledWith(expiresAt));
  expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/admin/sporting-goods/verify/initiate',
    { customerId: 'u1' },
  );
});

it('shows the verified state without a send button', () => {
  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified onVerified={() => {}} />);
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'true');
  expect(screen.queryByRole('button', { name: /send one-time code/i })).toBeNull();
});
