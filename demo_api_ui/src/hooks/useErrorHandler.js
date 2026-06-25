/**
 * useErrorHandler
 * Custom React hook for handling and displaying errors consistently
 * Integrates with ErrorDisplayService for audit logging
 */

import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import ErrorDisplayService from '../services/errorDisplayService';

export function useErrorHandler() {
  const [errorModal, setErrorModal] = useState(null);

  /**
   * Handle error display and logging
   * @param {object} error - Error object from API
   * @param {object} context - Additional context (user_email, agent_name, endpoint, etc.)
   */
  const handleError = useCallback((error, context = {}) => {
    if (!error) return;

    // Log to audit trail
    ErrorDisplayService.logToAudit(error, context);

    // Determine display type
    const display = ErrorDisplayService.determineDisplay(error);
    const details = ErrorDisplayService.extractDetails(error);
    const message = ErrorDisplayService.extractMessage(error);

    if (display.type === 'modal') {
      // Show modal for critical errors
      setErrorModal({
        message,
        details,
        display,
        error_code: details.error_code,
        severity: display.severity,
      });
    } else if (display.type === 'toast') {
      // Show toast for warnings and info
      const toastConfig = {
        autoClose: display.autoClose || 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
      };

      const content = (
        <div style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
            {message}
          </div>
          {details.teaching && (
            <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.9 }}>
              {details.teaching}
            </div>
          )}
        </div>
      );

      if (display.severity === 'warning') {
        toast.warning(content, toastConfig);
      } else {
        toast.info(content, toastConfig);
      }
    }
  }, []);

  /**
   * Close error modal
   */
  const closeErrorModal = useCallback(() => {
    setErrorModal(null);
  }, []);

  return {
    handleError,
    errorModal,
    closeErrorModal,
  };
}
