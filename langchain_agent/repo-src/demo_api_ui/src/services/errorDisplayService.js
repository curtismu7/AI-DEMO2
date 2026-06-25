/**
 * ErrorDisplayService
 * Determines how to display errors and extracts human-readable content
 * Manages error audit trail in localStorage
 */

export default class ErrorDisplayService {
  /**
   * Determine how to display an error based on its severity
   * @param {object} error - Error object from API (error.response.data)
   * @returns {object} { type: 'modal'|'toast', severity: 'critical'|'warning'|'info', icon: string, autoClose?: number }
   */
  static determineDisplay(error) {
    const errorCode = error?.error || error?.data?.error_code;

    const criticalErrors = [
      'TOKEN_TYPE_MISMATCH',
      'SCOPE_VIOLATION',
      'AUDIENCE_MISMATCH',
      'DELEGATION_CLAIM_MISSING',
    ];

    const warningErrors = [
      'RATE_LIMIT_EXCEEDED',
      'INSUFFICIENT_PERMISSIONS',
      'POLICY_VIOLATION',
    ];

    if (criticalErrors.includes(errorCode)) {
      return { type: 'modal', severity: 'critical', icon: '❌' };
    } else if (warningErrors.includes(errorCode)) {
      return { type: 'toast', severity: 'warning', icon: '⚠️', autoClose: 6000 };
    } else {
      return { type: 'toast', severity: 'info', icon: 'ℹ️', autoClose: 4000 };
    }
  }

  /**
   * Extract human-readable message from error response
   * @param {object} error - Error object
   * @returns {string} Human-readable message
   */
  static extractMessage(error) {
    if (error?.message) return error.message;
    if (error?.data?.details?.what_failed) return error.data.details.what_failed;
    if (error?.data?.what_failed) return error.data.what_failed;
    return 'An error occurred';
  }

  /**
   * Extract detailed error content (what_failed, why, teaching, fix)
   * @param {object} error - Error object
   * @returns {object} Detailed error content
   */
  static extractDetails(error) {
    // Handle different error response formats (HTTP vs JsonRpc)
    let data = error?.data || error?.details || error;
    
    // If it's nested in response structure
    if (error?.response?.data) {
      data = error.response.data;
    }

    return {
      what_failed: data?.what_failed || data?.details?.what_failed || 'Unknown error',
      why: data?.why || data?.details?.why || '',
      teaching: data?.teaching || data?.details?.teaching || '',
      fix: data?.fix || data?.details?.fix || 'Contact support for assistance.',
      tokens_involved: data?.tokens_involved || data?.details?.tokens_involved || {},
      doc_link: error?.documentation_link || data?.documentation_link || '',
      error_code: error?.error || data?.error_code || error?.error_code || 'UNKNOWN',
      http_status: error?.http_status || error?.response?.status || 'unknown',
    };
  }

  /**
   * Log error to audit trail (localStorage for client-side)
   * Stores max 50 recent entries
   * @param {object} error - Error object
   * @param {object} context - Additional context (user_email, agent_name, endpoint, etc.)
   * @returns {object} Audit entry that was stored
   */
  static logToAudit(error, context = {}) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      error_code: error?.error || error?.data?.error_code || 'UNKNOWN',
      message: this.extractMessage(error),
      details: this.extractDetails(error),
      user_email: context.user_email || null,
      agent_name: context.agent_name || null,
      endpoint: context.endpoint || null,
      http_status: error?.response?.status || error?.http_status || null,
      context,
    };

    try {
      // Store in localStorage with max 50 entries
      let audit = JSON.parse(localStorage.getItem('error_audit_log') || '[]');
      audit.push(auditEntry);
      if (audit.length > 50) {
        audit = audit.slice(-50);  // Keep last 50
      }
      localStorage.setItem('error_audit_log', JSON.stringify(audit));
    } catch (e) {
      console.error('Failed to log error to audit trail:', e);
    }

    return auditEntry;
  }

  /**
   * Get all audit entries from localStorage
   * @returns {array} Array of audit entries
   */
  static getAuditLog() {
    try {
      return JSON.parse(localStorage.getItem('error_audit_log') || '[]');
    } catch (e) {
      console.error('Failed to read audit log:', e);
      return [];
    }
  }

  /**
   * Clear audit log (admin operation)
   */
  static clearAuditLog() {
    try {
      localStorage.removeItem('error_audit_log');
    } catch (e) {
      console.error('Failed to clear audit log:', e);
    }
  }

  /**
   * Get severity level for an error code
   * @param {string} errorCode - Error code
   * @returns {string} 'critical' | 'warning' | 'info'
   */
  static getSeverity(errorCode) {
    const criticalErrors = [
      'TOKEN_TYPE_MISMATCH',
      'SCOPE_VIOLATION',
      'AUDIENCE_MISMATCH',
      'DELEGATION_CLAIM_MISSING',
    ];

    const warningErrors = [
      'RATE_LIMIT_EXCEEDED',
      'INSUFFICIENT_PERMISSIONS',
      'POLICY_VIOLATION',
    ];

    if (criticalErrors.includes(errorCode)) return 'critical';
    if (warningErrors.includes(errorCode)) return 'warning';
    return 'info';
  }
}
