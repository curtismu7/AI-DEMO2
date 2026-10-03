/**
 * ForgotPasswordLink — the sign-in surfaces' reset: username -> MFA -> new password -> confirmation.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lsStore = Object.create(null);
const mockLocalStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(lsStore, key) ? lsStore[key] : null),
  setItem: (key, value) => { lsStore[key] = String(value); },
  removeItem: (key) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach((k) => { delete lsStore[k]; }); },
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });

// The real MFA modal is covered elsewhere; here it just reports a passed challenge.
vi.mock('../OtpStepUpModal', () => ({
  default: ({ show, onP1MfaComplete }) => (show ? <button type="button" onClick={onP1MfaComplete}>mfa-passed</button> : null),
}));

const { ForgotPasswordLink } = await import('../ForgotPasswordFlow');

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

describe('ForgotPasswordLink', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => (String(url).endsWith('/start') ? ok({ daId: 'da-1', devices: [] }) : ok({ message: 'Password reset.' })));
  });

  test('walks to a confirmation with a way back to sign in', async () => {
    render(<ForgotPasswordLink />);

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify with MFA' }));

    fireEvent.click(await screen.findByRole('button', { name: 'mfa-passed' }));
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'Str0ng!Pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('heading', { name: 'Password reset' })).toBeInTheDocument();
    expect(screen.getByText('You can now sign in with your new password.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Password reset' })).not.toBeInTheDocument());
  });
});
