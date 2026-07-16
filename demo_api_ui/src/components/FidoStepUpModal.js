import React, { useState, useEffect } from 'react';
import { MdError } from 'react-icons/md';
import DraggableModal from './DraggableModal';

export default function FidoStepUpModal({ show, onSubmit, onCancel, contextLine = '', fallbackToOtp }) {
  const [status, setStatus] = useState('ready'); // 'ready' | 'waiting' | 'error' | 'timeout'
  const [errorMsg, setErrorMsg] = useState('');
  const timeoutRef = React.useRef(null);
  const onSubmitRef = React.useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (!show) return;
    setStatus('waiting');
    setErrorMsg('');
    timeoutRef.current = setTimeout(() => {
      setStatus('timeout');
      setErrorMsg('Passkey verification timed out. Please try again or use a code instead.');
    }, 60000);

    const handleFidoSuccess = (event) => {
      clearTimeout(timeoutRef.current);
      if (event.detail?.credentialResponse) {
        setStatus('ready');
        onSubmitRef.current?.(event.detail.credentialResponse);
      }
    };
    const handleFidoError = (event) => {
      clearTimeout(timeoutRef.current);
      setStatus('error');
      setErrorMsg(event.detail?.message || 'Passkey verification failed. Please try again.');
    };

    window.addEventListener('fido-verification-success', handleFidoSuccess);
    window.addEventListener('fido-verification-error', handleFidoError);
    return () => {
      clearTimeout(timeoutRef.current);
      window.removeEventListener('fido-verification-success', handleFidoSuccess);
      window.removeEventListener('fido-verification-error', handleFidoError);
    };
  }, [show]);

  const handleCancel = () => {
    clearTimeout(timeoutRef.current);
    setStatus('ready');
    setErrorMsg('');
    onCancel?.();
  };

  const handleTryOtp = () => {
    clearTimeout(timeoutRef.current);
    setStatus('ready');
    setErrorMsg('');
    fallbackToOtp?.();
  };

  const isError   = status === 'error' || status === 'timeout';
  const isWaiting = status === 'waiting';

  const footer = (
    <>
      <button
        type="button"
        className="otp-step-up-modal__btn-primary"
        onClick={handleTryOtp}
        disabled={isWaiting}
      >
        Use Code Instead
      </button>
      <button
        type="button"
        className="otp-step-up-modal__btn-ghost"
        onClick={handleCancel}
        disabled={isWaiting}
      >
        Cancel
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={!!show}
      onClose={handleCancel}
      title="Verify with Passkey"
      footer={footer}
      defaultWidth={420}
      defaultHeight={320}
      storageKey="fido-step-up-modal"
      zIndex={100080}
    >
      <div className="dm-scroll">
        <p className="otp-step-up-modal__lead">
          {contextLine || 'Step-up authentication required to complete this action'}
        </p>

        <div className="otp-step-up-modal__fido-status">
          {isWaiting && (
            <>
              <div className="push-waiting-spinner" />
              <p className="otp-step-up-modal__status-text">Waiting for passkey verification…</p>
              <p className="otp-step-up-modal__hint">Use your device's biometric scanner or PIN to verify</p>
            </>
          )}
          {isError && (
            <>
              <p className="otp-step-up-modal__error"><MdError aria-hidden style={{ verticalAlign: 'middle', marginRight: 6, color: '#d32f2f' }} /> {errorMsg}</p>
              <p className="otp-step-up-modal__hint">Try again with your passkey or use a verification code instead</p>
            </>
          )}
          {status === 'ready' && !isError && (
            <>
              <div className="push-waiting-spinner" />
              <p className="otp-step-up-modal__status-text">Initializing passkey verification…</p>
            </>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
