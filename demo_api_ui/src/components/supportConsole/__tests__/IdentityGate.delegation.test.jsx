import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IdentityGate from '../IdentityGate';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { post: vi.fn(), get: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
import bffAxios from '../../../services/bffAxios';

const CUSTOMER = { id: '5', name: 'Demo User' };

beforeEach(() => { bffAxios.post.mockReset(); });

it('initiate shows the OTP input with the masked contact; otp completes', async () => {
  const onVerified = vi.fn();
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } })
    .mockResolvedValueOnce({ data: { ok: true, verified: true, expiresAt: Date.now() + 900000, tokenChain: [] } });

  render(<IdentityGate vertical="workforce" customer={CUSTOMER} verified={false} onVerified={onVerified} />);
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));
  await waitFor(() => expect(screen.getByText(/••••86/)).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/workforce/verify/initiate', { customerId: '5' });

  fireEvent.change(screen.getByLabelText(/one-time code/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
  await waitFor(() => expect(onVerified).toHaveBeenCalledWith(expect.any(Number)));
  expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/workforce/verify/otp', { otp: '123456' });
});

it('a non-401 failure (expired flow) returns to idle so a new sign-on can start', async () => {
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } })
    .mockRejectedValueOnce({ response: { status: 410, data: { error: 'flow_expired', message: 'That sign-on request expired.' } } });

  render(<IdentityGate vertical="workforce" customer={CUSTOMER} verified={false} onVerified={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));
  await waitFor(() => expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/one-time code/i), { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
  await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument());
  // The OTP row is gone; the operator is back at the entry point.
  expect(screen.queryByLabelText(/one-time code/i)).toBeNull();
  expect(screen.getByRole('button', { name: /verify customer/i })).toBeInTheDocument();
});

it('a wrong OTP keeps the input open and shows the server message', async () => {
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } })
    .mockRejectedValueOnce({ response: { status: 401, data: { error: 'invalid_otp', message: 'That code is not valid.' } } });

  render(<IdentityGate vertical="workforce" customer={CUSTOMER} verified={false} onVerified={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));
  await waitFor(() => expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/one-time code/i), { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
  await waitFor(() => expect(screen.getByText(/not valid/i)).toBeInTheDocument());
  expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument(); // still open
});
