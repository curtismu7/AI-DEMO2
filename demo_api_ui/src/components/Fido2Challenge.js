import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { bytesToB64, normalizePublicKeyRequestOptions } from '../utils/passkeyCeremony';

/**
 * FIDO2/passkey step-up challenge component.
 * Fetches WebAuthn options from BFF, triggers browser credential prompt,
 * relays signed assertion back to BFF via PUT /api/auth/mfa/challenge/:daId.
 *
 * Props:
 *   daId      - deviceAuthentication ID (from POST /api/auth/mfa/challenge)
 *   deviceId  - selected FIDO2 device ID
 *   onSuccess - called when assertion is COMPLETED
 *   onCancel  - called when user cancels
 *   onError   - called with error message string on failure
 */
function formatAssertion(credential) {
  return {
    id: credential.id,
    rawId: bytesToB64(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bytesToB64(credential.response.authenticatorData),
      clientDataJSON:    bytesToB64(credential.response.clientDataJSON),
      signature:         bytesToB64(credential.response.signature),
      userHandle: credential.response.userHandle
        ? bytesToB64(credential.response.userHandle)
        : null,
    },
  };
}

export default function Fido2Challenge({ daId, deviceId, onSuccess, onCancel, onError }) {
  const [status, setStatus] = useState('starting'); // 'starting' | 'waiting' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!daId || !deviceId) return;

    async function runFido2() {
      try {
        // Browser support check
        if (typeof window.PublicKeyCredential === 'undefined' || !navigator.credentials?.get) {
          const msg = 'Your browser does not support passkeys / FIDO2. Please use a different verification method.';
          setErrorMsg(msg);
          setStatus('error');
          onError(msg);
          return;
        }

        setStatus('waiting');

        // Step 1: Get publicKeyCredentialRequestOptions from BFF
        const { data } = await axios.get(`/api/auth/mfa/challenge/${daId}/status`);
        if (!data.publicKeyCredentialRequestOptions) {
          throw new Error('PingOne did not return WebAuthn challenge options. Ensure the FIDO2 device is correctly enrolled.');
        }

        // Step 2: Trigger browser credential selection (native passkey / security key prompt).
        // PingOne returns challenge + allowCredentials ids as base64url (and
        // options may already be a parsed object — do not JSON.parse blindly).
        const publicKey = normalizePublicKeyRequestOptions(data.publicKeyCredentialRequestOptions);
        const credential = await navigator.credentials.get({ publicKey });

        if (!credential) {
          throw new Error('No credential returned from browser.');
        }

        // Step 3: Format and relay assertion to BFF
        const assertion = formatAssertion(credential);
        const verifyResp = await axios.put(`/api/auth/mfa/challenge/${daId}`, { assertion });

        if (!verifyResp.data.completed) {
          throw new Error('FIDO2 assertion was not accepted by PingOne. Please try again.');
        }

        onSuccess();
      } catch (err) {
        let msg;
        if (err.name === 'NotAllowedError') {
          msg = 'Passkey authentication was cancelled or timed out.';
        } else if (err.name === 'SecurityError') {
          msg = 'Security error during passkey authentication. Check that the domain matches the registered relying party.';
        } else {
          msg = err.response?.data?.message || err.message || 'FIDO2 authentication failed.';
        }
        setErrorMsg(msg);
        setStatus('error');
        onError(msg);
      }
    }

    runFido2();
  }, [daId, deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="otp-step-up-overlay">
      <div className="otp-step-up-modal otp-step-up-modal--fido2">
        <div className="otp-step-up-modal__header">
          <h3 className="otp-step-up-modal__title">🔐 Passkey Verification</h3>
        </div>
        <div className="otp-step-up-modal__body" style={{ textAlign: 'center', padding: '1rem 0' }}>
          {status === 'starting' && (
            <p className="otp-step-up-modal__lead">Preparing passkey challenge…</p>
          )}
          {status === 'waiting' && (
            <>
              <div className="push-waiting-spinner" />
              <p className="otp-step-up-modal__lead" style={{ marginTop: '1rem' }}>
                Follow the prompt from your browser or device to verify with your{' '}
                <strong>passkey or security key</strong>.
              </p>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="otp-step-up-modal__error" style={{ textAlign: 'left' }}>{errorMsg}</p>
              <p className="otp-step-up-modal__hint">
                If you do not have a passkey enrolled, cancel and choose a different verification method.
              </p>
            </>
          )}
        </div>
        <div className="otp-step-up-modal__actions" style={{ justifyContent: 'center' }}>
          <button className="otp-step-up-modal__btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
