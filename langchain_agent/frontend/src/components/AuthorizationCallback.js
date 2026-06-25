import React, { useEffect, useState } from 'react';
import './AuthorizationCallback.css';

const AuthorizationCallback = () => {
  const [status, setStatus] = useState('processing');
  const [message, setMessage] = useState('Processing authorization...');

  useEffect(() => {
    const processCallback = () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');
        const errorDescription = urlParams.get('error_description');

        if (error) {
          setStatus('error');
          setMessage(errorDescription || error || 'Authorization failed');
          
          // Send error to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH_ERROR',
              error: errorDescription || error || 'Authorization failed'
            }, window.location.origin);
          }
          
          // Close window after a delay
          setTimeout(() => {
            window.close();
          }, 3000);
          
        } else if (code) {
          setStatus('success');
          setMessage('Authorization successful! This window will close automatically.');
          
          // Send success to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH_SUCCESS',
              code: code,
              state: state
            }, window.location.origin);
          }
          
          // Close window after a short delay
          setTimeout(() => {
            window.close();
          }, 1500);
          
        } else {
          setStatus('error');
          setMessage('No authorization code received');
          
          // Send error to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH_ERROR',
              error: 'No authorization code received'
            }, window.location.origin);
          }
          
          // Close window after a delay
          setTimeout(() => {
            window.close();
          }, 3000);
        }
      } catch (err) {
        console.error('Error processing authorization callback:', err);
        setStatus('error');
        setMessage('Error processing authorization');
        
        // Send error to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'OAUTH_ERROR',
            error: 'Error processing authorization'
          }, window.location.origin);
        }
        
        // Close window after a delay
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    };

    processCallback();
  }, []);

  const handleCloseWindow = () => {
    window.close();
  };

  return (
    <div className="authorization-callback">
      <div className="callback-content">
        <div className={`status-icon ${status}`}>
          {status === 'processing' && (
            <div className="spinner"></div>
          )}
          {status === 'success' && (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22,4 12,14.01 9,11.01"></polyline>
            </svg>
          )}
          {status === 'error' && (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
          )}
        </div>
        
        <h2>Authorization {status === 'success' ? 'Complete' : status === 'error' ? 'Failed' : 'Processing'}</h2>
        <p>{message}</p>
        
        {status === 'error' && (
          <button className="close-button" onClick={handleCloseWindow}>
            Close Window
          </button>
        )}
      </div>
    </div>
  );
};

export default AuthorizationCallback;