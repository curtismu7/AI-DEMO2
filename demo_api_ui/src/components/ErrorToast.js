/**
 * ErrorToast
 * Toast notification component for non-critical errors
 * Displays error message with teaching content using react-toastify
 */

import React from 'react';
import { toast } from 'react-toastify';

export default function ErrorToast({ error, severity = 'error' }) {
  if (!error) return null;

  const message = error?.message || 'An error occurred';
  const teaching = error?.details?.teaching || error?.teaching;

  const content = (
    <div style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '14px' }}>
        {message}
      </div>
      {teaching && (
        <div style={{ fontSize: '12px', marginTop: '0.5rem', opacity: 0.9, lineHeight: '1.4' }}>
          {teaching}
        </div>
      )}
    </div>
  );

  const toastConfig = {
    autoClose: severity === 'warning' ? 6000 : 4000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
  };

  if (severity === 'error' || severity === 'critical') {
    toast.error(content, toastConfig);
  } else if (severity === 'warning') {
    toast.warning(content, toastConfig);
  } else {
    toast.info(content, toastConfig);
  }

  return null;  // Toast is rendered by ToastContainer in App.js
}
