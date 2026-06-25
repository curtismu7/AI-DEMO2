import SupportContactService from '../supportContactService';

describe('SupportContactService', () => {
  const mockError = {
    requestId: 'err_123_abc',
    timestamp: '2024-06-24T12:00:00Z',
    message: 'JWKS endpoint unreachable',
    classification: {
      code: 'JWKS_UNAVAILABLE',
      category: 'CONFIG',
    },
  };

  const mockContext = {
    userEmail: 'user@example.com',
    endpoint: '/api/auth/verify',
    httpStatus: 503,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    delete window.location;
    window.location = { href: '' };
  });

  describe('openSupportDialog', () => {
    it('falls back to mailto: link if API is not configured', async () => {
      process.env.REACT_APP_API_BASE_URL = '';

      await SupportContactService.openSupportDialog(mockError, mockContext);

      expect(window.location.href).toContain('mailto:');
      expect(window.location.href).toContain(mockError.requestId);
      expect(window.location.href).toContain(mockError.classification.code);
    });

    it('includes error context in mailto: subject', async () => {
      await SupportContactService.openSupportDialog(mockError, mockContext);

      expect(window.location.href).toContain('JWKS_UNAVAILABLE');
      expect(window.location.href).toContain('err_123_abc');
    });

    it('includes error context in email body', async () => {
      await SupportContactService.openSupportDialog(mockError, mockContext);

      const decodedBody = decodeURIComponent(window.location.href);
      expect(decodedBody).toContain('JWKS_UNAVAILABLE');
      expect(decodedBody).toContain('CONFIG');
      expect(decodedBody).toContain('/api/auth/verify');
    });

    it('does NOT include sensitive data (tokens, JWKS URIs) in mailto:', async () => {
      const errWithSensitiveContext = {
        ...mockError,
        classification: {
          ...mockError.classification,
          context: {
            jwksUri: 'https://auth.pingone.com/secret/as/jwks',
            clientId: 'secret-client-id',
          },
        },
      };

      await SupportContactService.openSupportDialog(errWithSensitiveContext, mockContext);

      const decodedHref = decodeURIComponent(window.location.href);
      expect(decodedHref).not.toContain('secret');
      expect(decodedHref).not.toContain('pingone.com');
    });

    it('includes browser info in email body', async () => {
      await SupportContactService.openSupportDialog(mockError, mockContext);

      const decodedBody = decodeURIComponent(window.location.href);
      expect(decodedBody).toContain('User Agent:');
      expect(decodedBody).toContain('URL:');
    });
  });

  describe('logErrorContext', () => {
    it('logs error to audit trail', () => {
      SupportContactService.logErrorContext(mockError, mockContext);

      const log = SupportContactService.getAuditLog();
      expect(log.length).toBe(1);
      expect(log[0].error_id).toBe(mockError.requestId);
    });

    it('includes timestamp in audit log', () => {
      SupportContactService.logErrorContext(mockError, mockContext);

      const log = SupportContactService.getAuditLog();
      expect(log[0].timestamp).toBeDefined();
    });

    it('stores classification in audit log', () => {
      SupportContactService.logErrorContext(mockError, mockContext);

      const log = SupportContactService.getAuditLog();
      expect(log[0].category).toBe('CONFIG');
      expect(log[0].code).toBe('JWKS_UNAVAILABLE');
    });

    it('appends multiple errors to audit log', () => {
      SupportContactService.logErrorContext(mockError, mockContext);

      const error2 = { ...mockError, requestId: 'err_456_def' };
      SupportContactService.logErrorContext(error2, mockContext);

      const log = SupportContactService.getAuditLog();
      expect(log.length).toBe(2);
      expect(log[0].error_id).toBe('err_123_abc');
      expect(log[1].error_id).toBe('err_456_def');
    });

    it('rotates audit log when exceeding max entries', () => {
      // Add more than MAX_AUDIT_ENTRIES
      for (let i = 0; i < 60; i++) {
        const err = { ...mockError, requestId: `err_${i}` };
        SupportContactService.logErrorContext(err, mockContext);
      }

      const log = SupportContactService.getAuditLog();
      expect(log.length).toBeLessThanOrEqual(50);
      expect(log[0].error_id).toBe('err_10'); // Oldest retained
    });
  });

  describe('getAuditLog', () => {
    it('returns empty array when no audit log exists', () => {
      const log = SupportContactService.getAuditLog();
      expect(log).toEqual([]);
    });

    it('returns audit log entries in order', () => {
      SupportContactService.logErrorContext(mockError, mockContext);
      SupportContactService.logErrorContext(
        { ...mockError, requestId: 'err_456' },
        mockContext
      );

      const log = SupportContactService.getAuditLog();
      expect(log[0].error_id).toBe('err_123_abc');
      expect(log[1].error_id).toBe('err_456');
    });

    it('handles corrupted audit log gracefully', () => {
      localStorage.setItem(SupportContactService.AUDIT_LOG_KEY, 'corrupted json {');

      const log = SupportContactService.getAuditLog();
      expect(log).toEqual([]);
    });
  });

  describe('clearAuditLog', () => {
    it('removes audit log from localStorage', () => {
      SupportContactService.logErrorContext(mockError, mockContext);

      SupportContactService.clearAuditLog();

      const log = SupportContactService.getAuditLog();
      expect(log).toEqual([]);
    });
  });

  describe('exportAuditLog', () => {
    it('exports audit log as JSON string', () => {
      SupportContactService.logErrorContext(mockError, mockContext);
      SupportContactService.logErrorContext(
        { ...mockError, requestId: 'err_456' },
        mockContext
      );

      const exported = SupportContactService.exportAuditLog();
      const parsed = JSON.parse(exported);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed[0].error_id).toBe('err_123_abc');
    });

    it('exports valid JSON', () => {
      SupportContactService.logErrorContext(mockError, mockContext);

      const exported = SupportContactService.exportAuditLog();
      expect(() => JSON.parse(exported)).not.toThrow();
    });
  });

  describe('data sanitization', () => {
    it('does not include raw tokens in report data', () => {
      const errWithToken = {
        ...mockError,
        token: 'eyJhbGciOiJSUzI1NiJ9...',
      };

      SupportContactService.logErrorContext(errWithToken, mockContext);

      const log = SupportContactService.getAuditLog();
      expect(JSON.stringify(log[0])).not.toContain('eyJhbGciOiJSUzI1NiJ9');
    });

    it('does not include environment IDs in report data', () => {
      const errWithEnvId = {
        ...mockError,
        envId: 'a1b2c3d4e5',
      };

      SupportContactService.logErrorContext(errWithEnvId, mockContext);

      const log = SupportContactService.getAuditLog();
      expect(JSON.stringify(log[0])).not.toContain('a1b2c3d4e5');
    });
  });

  describe('audit log edge cases', () => {
    it('handles localStorage quota exceeded gracefully', () => {
      const quotaError = new Error('QuotaExceededError');
      quotaError.code = 22;

      jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw quotaError;
      });

      expect(() => SupportContactService.logErrorContext(mockError, mockContext)).not.toThrow();
    });

    it('handles missing localStorage gracefully', () => {
      const original = window.localStorage;
      delete window.localStorage;

      expect(() => SupportContactService.logErrorContext(mockError, mockContext)).not.toThrow();

      window.localStorage = original;
    });
  });
});
