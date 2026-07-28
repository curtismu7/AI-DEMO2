/**
 * Fido2Challenge — a NotAllowedError means the browser found no passkey for
 * this site on THIS device (the credential may be saved on a phone), or the
 * prompt was dismissed. That must offer local registration inline rather than
 * calling onError, which the dashboard uses to close the overlay.
 */
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import Fido2Challenge from '../Fido2Challenge';

vi.mock('axios');

const DA_ID = 'da-1';
const DEVICE_ID = 'dev-fido-1';

const REQUEST_OPTIONS = JSON.stringify({
  challenge: [1, 2, 3, 4],
  rpId: 'ping-devops.com',
  allowCredentials: [{ type: 'public-key', id: [9, 8, 7] }],
  userVerification: 'preferred',
});

describe('Fido2Challenge — no passkey on this device', () => {
  let getMock;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: function PublicKeyCredential() {}, configurable: true, writable: true,
    });
    getMock = vi.fn(() => Promise.reject(
      Object.assign(new Error('The operation either timed out or was not allowed.'), {
        name: 'NotAllowedError',
      }),
    ));
    Object.defineProperty(navigator, 'credentials', {
      value: { get: getMock, create: vi.fn() }, configurable: true, writable: true,
    });
    axios.get.mockResolvedValue({ data: { publicKeyCredentialRequestOptions: REQUEST_OPTIONS } });
    axios.put.mockResolvedValue({ data: { completed: true } });
  });

  test('offers registration inline and does NOT call onError', async () => {
    const onError = vi.fn();
    const onRegisterPasskey = vi.fn();
    render(
      <Fido2Challenge
        daId={DA_ID}
        deviceId={DEVICE_ID}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        onError={onError}
        onRegisterPasskey={onRegisterPasskey}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('fido2-register-passkey-here')).toBeInTheDocument());
    expect(screen.getByText(/No passkey for this site was found on this device/i)).toBeInTheDocument();
    // onError would close the overlay and destroy the offer.
    expect(onError).not.toHaveBeenCalled();

    screen.getByTestId('fido2-register-passkey-here').click();
    expect(onRegisterPasskey).toHaveBeenCalled();
  });

  test('still fails out via onError when no registration handler is supplied', async () => {
    const onError = vi.fn();
    render(
      <Fido2Challenge
        daId={DA_ID}
        deviceId={DEVICE_ID}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        onError={onError}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.queryByTestId('fido2-register-passkey-here')).not.toBeInTheDocument();
  });
});
