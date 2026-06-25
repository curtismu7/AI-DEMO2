/**
 * MFA-specific logging utility
 * Logs all MFA API calls, headers, request/response bodies, and debugging info
 * Writes to both console and dedicated mfa.log file
 */

const fs = require('fs');
const path = require('path');

class MFALogger {
  constructor() {
    this.logDir = process.env.LOG_DIRECTORY || './logs';
    this.logFile = path.join(this.logDir, 'mfa.log');
    this.debugMode = process.env.MFA_DEBUG === 'true';
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create MFA log directory:', error.message);
    }
  }

  writeToFile(entry) {
    try {
      const logLine = typeof entry === 'string' ? entry : JSON.stringify(entry);
      fs.appendFileSync(this.logFile, logLine + '\n', 'utf8');
    } catch (error) {
      console.error('Failed to write to MFA log file:', error.message);
    }
  }

  /**
   * Log an MFA API call with full details
   * @param {Object} callDetails - { method, url, headers, request, response, status, duration, userId, error }
   */
  logApiCall(callDetails) {
    const {
      method,
      url,
      headers = {},
      request = null,
      response = null,
      status = null,
      duration = null,
      userId = null,
      error = null,
      operation = null,
      deviceId = null
    } = callDetails;

    const entry = {
      timestamp: new Date().toISOString(),
      type: 'API_CALL',
      operation,
      method,
      url,
      status,
      duration_ms: duration,
      userId,
      deviceId,
      headers: this.sanitizeHeaders(headers),
      request: this.sanitizePayload(request),
      response: this.sanitizePayload(response),
      error: error ? { message: error.message, code: error.code } : null
    };

    console.log(`[MFA API] ${method} ${url} - ${status || 'PENDING'}`);
    if (this.debugMode) {
      console.log(JSON.stringify(entry, null, 2));
    }
    this.writeToFile(entry);
    return entry;
  }

  /**
   * Log MFA operation (initiate, verify, etc.)
   */
  logOperation(operation, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'MFA_OPERATION',
      operation,
      userId: details.userId,
      deviceId: details.deviceId,
      method: details.method,
      status: details.status,
      daId: details.daId,
      message: details.message,
      details: details.details
    };

    console.log(`[MFA] ${operation} - ${details.status} (${details.message})`);
    if (this.debugMode) {
      console.log(JSON.stringify(entry, null, 2));
    }
    this.writeToFile(entry);
    return entry;
  }

  /**
   * Log device selection
   */
  logDeviceSelection(details) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'DEVICE_SELECTION',
      daId: details.daId,
      userId: details.userId,
      deviceId: details.deviceId,
      deviceType: details.deviceType,
      status: details.status,
      message: details.message
    };

    console.log(`[MFA] Device selected - ${details.deviceType} (${details.message})`);
    this.writeToFile(entry);
    return entry;
  }

  /**
   * Log device list
   */
  logDeviceList(userId, devices, status) {
    // Mask PII fields before writing to log file.
    const maskEmail = v => {
      if (!v) return '***';
      const at = String(v).indexOf('@');
      return at > 0 ? `${String(v)[0]}***${String(v).slice(at)}` : '***';
    };
    const maskPhone = v => v ? '***' : undefined;

    const entry = {
      timestamp: new Date().toISOString(),
      type: 'DEVICE_LIST',
      userId,
      count: devices.length,
      devices: devices.map(d => ({
        id: d.id,
        type: d.type,
        nickname: d.nickname,
        email: maskEmail(d.email),
        ...(d.phone !== undefined && { phone: maskPhone(d.phone) }),
        ...(d.phoneNumber !== undefined && { phoneNumber: maskPhone(d.phoneNumber) }),
        status: d.status,
        createdAt: d.createdAt
      })),
      status
    };

    console.log(`[MFA] Devices listed - ${devices.length} devices found for user ${userId}`);
    this.writeToFile(entry);
    return entry;
  }

  /**
   * Log error
   */
  logError(details) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'ERROR',
      operation: details.operation,
      userId: details.userId,
      error: {
        message: details.message,
        code: details.code,
        status: details.status,
        details: details.details
      },
      stackTrace: details.stackTrace
    };

    console.error(`[MFA ERROR] ${details.operation} - ${details.message}`);
    if (this.debugMode) {
      console.error(JSON.stringify(entry, null, 2));
    }
    this.writeToFile(entry);
    return entry;
  }

  /**
   * Log debug info
   */
  logDebug(message, data = {}) {
    if (!this.debugMode) return;

    const entry = {
      timestamp: new Date().toISOString(),
      type: 'DEBUG',
      message,
      data
    };

    console.log(`[MFA DEBUG] ${message}`);
    console.log(JSON.stringify(entry, null, 2));
    this.writeToFile(entry);
    return entry;
  }

  /**
   * Sanitize headers for logging (remove sensitive data)
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveKeys = ['authorization', 'x-api-key', 'x-access-token', 'cookie'];

    sensitiveKeys.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '***REDACTED***';
      }
    });

    return sanitized;
  }

  /**
   * Sanitize payload for logging (remove sensitive data)
   */
  sanitizePayload(payload) {
    if (!payload) return null;

    const sanitized = typeof payload === 'string' ? JSON.parse(payload) : { ...payload };
    const sensitiveFields = ['password', 'pin', 'otp', 'accessToken', 'refreshToken', 'idToken'];

    const redact = (obj) => {
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach(key => {
          if (sensitiveFields.includes(key)) {
            obj[key] = '***REDACTED***';
          } else if (typeof obj[key] === 'object') {
            redact(obj[key]);
          }
        });
      }
    };

    redact(sanitized);
    return sanitized;
  }

  /**
   * Get log file path
   */
  getLogFilePath() {
    return this.logFile;
  }

  /**
   * Get recent logs from file
   */
  getRecentLogs(count = 100) {
    try {
      if (!fs.existsSync(this.logFile)) {
        return [];
      }

      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n');
      return lines.slice(-count).map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
    } catch (error) {
      console.error('Failed to read MFA logs:', error.message);
      return [];
    }
  }

  /**
   * Clear log file
   */
  clearLogs() {
    try {
      if (fs.existsSync(this.logFile)) {
        fs.writeFileSync(this.logFile, '', 'utf8');
        console.log('[MFA] Log file cleared');
      }
    } catch (error) {
      console.error('Failed to clear MFA logs:', error.message);
    }
  }
}

// Create singleton instance
const mfaLogger = new MFALogger();

module.exports = {
  mfaLogger,
  MFALogger
};
