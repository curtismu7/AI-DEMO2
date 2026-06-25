/**
 * Support Contact Service — Handle error reporting and support contact flows
 *
 * Features:
 *   - Generate pre-filled mailto: links with error context
 *   - Log error audit trail to localStorage for support team
 *   - Scrub sensitive data (tokens, JWKS URIs, env IDs) before sending
 *   - POST error report to backend /api/support/contact endpoint
 *   - Open support form modal or email client
 */

class SupportContactService {
  static SUPPORT_EMAIL = process.env.REACT_APP_SUPPORT_EMAIL || 'support@example.com';
  static DOCS_BASE_URL = process.env.REACT_APP_DOCS_URL || 'https://docs.example.com';
  static STATUS_PAGE_URL = process.env.REACT_APP_STATUS_PAGE_URL || 'https://status.example.com';
  static AUDIT_LOG_KEY = 'error-audit-log';
  static MAX_AUDIT_ENTRIES = 50;

  /**
   * Open support contact dialog with pre-filled error context
   * @param {Error} error - Error object with classification
   * @param {object} context - { userEmail, endpoint, userAgent }
   * @returns {Promise<void>}
   */
  static async openSupportDialog(error, context = {}) {
    const reportData = this._buildReportData(error, context);
    const emailBody = this._buildEmailBody(reportData);

    // Try POST endpoint first (if configured)
    if (process.env.REACT_APP_API_BASE_URL) {
      try {
        await this._postContactForm(reportData);
        return;
      } catch (err) {
        console.warn('Failed to POST support form, falling back to mailto:', err);
      }
    }

    // Fallback to mailto: link
    const subject = `Support Request: ${error.classification?.code || 'Error'} (${reportData.error_id})`;
    const mailtoLink = `mailto:${this.SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;

    window.location.href = mailtoLink;
  }

  /**
   * Log error to audit trail (stored in localStorage)
   * @param {Error} error - Error with classification
   * @param {object} context - Additional context
   */
  static logErrorContext(error, context = {}) {
    const audit = {
      timestamp: new Date().toISOString(),
      error_id: error.requestId,
      category: error.classification?.category,
      code: error.classification?.code,
      message: error.message,
      context,
    };

    this._appendToAuditLog(audit);
  }

  /**
   * Retrieve error audit trail from localStorage
   * @returns {Array<object>} Array of audit entries
   */
  static getAuditLog() {
    try {
      const log = localStorage.getItem(this.AUDIT_LOG_KEY);
      return log ? JSON.parse(log) : [];
    } catch (err) {
      console.error('Failed to read audit log:', err);
      return [];
    }
  }

  /**
   * Clear error audit trail
   */
  static clearAuditLog() {
    try {
      localStorage.removeItem(this.AUDIT_LOG_KEY);
    } catch (err) {
      console.error('Failed to clear audit log:', err);
    }
  }

  /**
   * Export audit trail for debugging (JSON format)
   * @returns {string} JSON string of audit log
   */
  static exportAuditLog() {
    return JSON.stringify(this.getAuditLog(), null, 2);
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Build sanitized report data (remove sensitive info)
   * @private
   */
  static _buildReportData(error, context = {}) {
    return {
      error_id: error.requestId || `err_${Date.now()}`,
      timestamp: error.timestamp || new Date().toISOString(),
      error_code: error.classification?.code || 'UNKNOWN',
      error_category: error.classification?.category || 'UNKNOWN',
      error_message: error.message || 'Unknown error',
      user_email: context.userEmail || 'unknown',
      endpoint: context.endpoint || 'unknown',
      http_status: context.httpStatus || 'unknown',
      browser_info: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        referrer: document.referrer,
      },
      // Do NOT include: raw tokens, client secrets, JWKS URIs, env IDs
    };
  }

  /**
   * Build email body from report data
   * @private
   */
  static _buildEmailBody(reportData) {
    const lines = [
      'Error Report',
      '=============',
      '',
      `Error ID: ${reportData.error_id}`,
      `Code: ${reportData.error_code}`,
      `Category: ${reportData.error_category}`,
      `Message: ${reportData.error_message}`,
      '',
      'Context:',
      `- Endpoint: ${reportData.endpoint}`,
      `- HTTP Status: ${reportData.http_status}`,
      `- Timestamp: ${reportData.timestamp}`,
      '',
      'Browser:',
      `- User Agent: ${reportData.browser_info.userAgent}`,
      `- URL: ${reportData.browser_info.url}`,
      '',
      'Please describe what you were doing when this error occurred:',
      '[Your description here]',
      '',
      '--',
      `Status Page: ${this.STATUS_PAGE_URL}`,
      `Documentation: ${this.DOCS_BASE_URL}/errors/${reportData.error_code}`,
    ];

    return lines.join('\n');
  }

  /**
   * POST error report to backend
   * @private
   */
  static async _postContactForm(reportData) {
    const response = await fetch(`${process.env.REACT_APP_API_BASE_URL}/api/support/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportData),
    });

    if (!response.ok) {
      throw new Error(`Failed to submit support form: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Append entry to audit log (rotate if needed)
   * @private
   */
  static _appendToAuditLog(entry) {
    try {
      let log = this.getAuditLog();
      log.push(entry);

      // Keep only last MAX_AUDIT_ENTRIES
      if (log.length > this.MAX_AUDIT_ENTRIES) {
        log = log.slice(-this.MAX_AUDIT_ENTRIES);
      }

      localStorage.setItem(this.AUDIT_LOG_KEY, JSON.stringify(log));
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  }
}

export default SupportContactService;
