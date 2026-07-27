/**
 * OtpStepUpModal — passkey assertion options decoding.
 *
 * PingOne returns `publicKeyCredentialRequestOptions` as a JSON *string* whose
 * `challenge` and `allowCredentials[].id` are signed byte arrays, not base64url
 * strings. The shapes below were captured from a live PingOne MFA challenge
 * (env 01d89b06) — a string-only decoder threw before
 * navigator.credentials.get() was ever reached, so the step-up passkey path
 * always failed with a generic "Passkey verification failed" message.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OtpStepUpModal from '../OtpStepUpModal';

const lsStore = Object.create(null);
const mockLocalStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(lsStore, key) ? lsStore[key] : null),
  setItem: (key, value) => { lsStore[key] = String(value); },
  removeItem: (key) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach((k) => { delete lsStore[k]; }); },
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });

const DA_ID = 'da-fido-1';
const FIDO_DEVICE = { id: 'dev-fido-1', type: 'FIDO2', status: 'ACTIVE' };

// Live-captured shape: JSON string, signed byte arrays for challenge + credential ids.
const LIVE_REQUEST_OPTIONS = JSON.stringify({
  challenge: [-50, 0, -13, 48, 1, -10, 105, 62, 93, 125, -60, 113, -107, 0, 47, -70,
    -76, -13, 29, 108, -69, -72, 34, 82, 73, 46, 11, 99, 77, 8, 91, 12],
  timeout: 120000,
  rpId: 'ping-devops.com',
  allowCredentials: [
    { type: 'public-key', id: [33, -95, -74, 61, 40, -50, 1, 59, 30, 44, -48, 109, -13, 124, 113, 82] },
  ],
  userVerification: 'preferred',
});

describe('OtpStepUpModal — FIDO2 assertion option decoding', () => {
  let getMock;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: function PublicKeyCredential() {}, configurable: true, writable: true,
    });
    getMock = vi.fn(() => Promise.resolve({
      id: 'cred-1',
      type: 'public-key',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: {
        authenticatorData: new Uint8Array([4, 5, 6]).buffer,
        clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
        signature: new Uint8Array([10, 11, 12]).buffer,
      },
    }));
    Object.defineProperty(navigator, 'credentials', {
      value: { get: getMock, create: vi.fn() }, configurable: true, writable: true,
    });

    global.fetch = vi.fn((url, opts = {}) => {
      if (opts.method === 'PUT' && url.includes(DA_ID) && !url.includes('/status')) {
        const body = JSON.parse(opts.body || '{}');
        // Device selection -> PingOne asks for a WebAuthn assertion.
        if (body.deviceId) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ASSERTION_REQUIRED' }) });
        }
        // Assertion relay -> completed.
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ completed: true }) });
      }
      if (url.includes(`${DA_ID}/status`)) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ publicKeyCredentialRequestOptions: LIVE_REQUEST_OPTIONS }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
  });

  const baseProps = {
    show: true,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    mode: 'p1mfa',
    daId: DA_ID,
    devices: [FIDO_DEVICE],
    userIdentity: { name: 'Demo User', email: 'demo@example.com' },
    allowFido: true,
  };

  test('decodes live PingOne byte-array options and reaches navigator.credentials.get', async () => {
    const onP1MfaComplete = vi.fn();
    render(<OtpStepUpModal {...baseProps} onP1MfaComplete={onP1MfaComplete} />);

    fireEvent.click(screen.getByTestId('mfa-choose-passkey'));

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    const { publicKey } = getMock.mock.calls[0][0];
    expect(publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect(publicKey.challenge.length).toBe(32);
    // -50 as a signed byte is 0xCE == 206 unsigned.
    expect(publicKey.challenge[0]).toBe(206);
    expect(publicKey.rpId).toBe('ping-devops.com');
    expect(publicKey.allowCredentials[0].id).toBeInstanceOf(Uint8Array);
    expect(publicKey.allowCredentials[0].id[1]).toBe(161); // -95 -> 0xA1

    await waitFor(() => expect(onP1MfaComplete).toHaveBeenCalled());
  });
});
