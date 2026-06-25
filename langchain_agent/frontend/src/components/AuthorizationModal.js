import React, { useState, useEffect } from 'react';
import './AuthorizationModal.css';

const AuthorizationModal = ({
  isOpen,
  onClose,
  authorizationUrl,
  onAuthorizationComplete,
  onAuthorizationError
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const cleanupRef = React.useRef(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsLoading(false);
    }
  }, [isOpen]);

  // Clean up any active auth session when the component unmounts
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const handleAuthorize = () => {
    if (!authorizationUrl) {
      setError('No authorization URL provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    // Open authorization URL in a new window
    const authWindow = window.open(
      authorizationUrl,
      'oauth-authorization',
      'width=600,height=700,scrollbars=yes,resizable=yes'
    );

    if (!authWindow) {
      setError('Failed to open authorization window. Please check your popup blocker settings.');
      setIsLoading(false);
      return;
    }

    const cleanup = () => {
      clearInterval(pollTimer);
      window.removeEventListener('message', messageHandler);
      if (authWindow && !authWindow.closed) {
        authWindow.close();
      }
      cleanupRef.current = null;
    };

    // Poll for window closure or message
    const pollTimer = setInterval(() => {
      try {
        if (authWindow.closed) {
          cleanup();
          setIsLoading(false);
          setError('Authorization was cancelled');
          if (onAuthorizationError) {
            onAuthorizationError(new Error('Authorization cancelled'));
          }
        }
      } catch (e) {
        // Cross-origin error when trying to access closed window
        // This is expected and can be ignored
      }
    }, 1000);

    // Listen for messages from the authorization window
    const messageHandler = (event) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data.type === 'OAUTH_SUCCESS') {
        cleanup();
        setIsLoading(false);
        if (onAuthorizationComplete) {
          onAuthorizationComplete(event.data.code, event.data.state);
        }
        onClose();
      } else if (event.data.type === 'OAUTH_ERROR') {
        cleanup();
        setIsLoading(false);
        const err = new Error(event.data.error || 'Authorization failed');
        setError(err.message);
        if (onAuthorizationError) {
          onAuthorizationError(err);
        }
      }
    };

    window.addEventListener('message', messageHandler);
    cleanupRef.current = cleanup;
  };

  const handleCancel = () => {
    setError(null);
    setIsLoading(false);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="authorization-modal-overlay">
      <div className="authorization-modal">
        <div className="authorization-modal-header">
          <h2>Authorization Required</h2>
          <button 
            className="close-button" 
            onClick={handleCancel}
            disabled={isLoading}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        
        <div className="authorization-modal-content">
          <p>
            The agent needs your permission to access external resources. 
            Click "Authorize" to open the authorization page in a new window.
          </p>
          
          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}
          
          <div className="authorization-modal-actions">
            <button
              className="authorize-button"
              onClick={handleAuthorize}
              disabled={isLoading || !authorizationUrl}
            >
              {isLoading ? 'Authorizing...' : 'Authorize'}
            </button>
            <button
              className="cancel-button"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
          </div>
          
          {isLoading && (
            <div className="loading-info">
              <p>Please complete the authorization in the popup window.</p>
              <p>This window will close automatically when authorization is complete.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthorizationModal;