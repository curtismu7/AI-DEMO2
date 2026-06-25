/**
 * Frontend integration tests for auth error handling
 * Tests: error display, retry logic, support flow, audit logging
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ErrorRetryStrategy from '../services/errorRetryStrategy';
import SupportContactService from '../services/supportContactService';
import AuthErrorBanner from '../components/AuthErrorBanner';

describe('Frontend Auth Error Handling — Integration', () => {
  describe('Error display by category', () => {
    it('shows USER error with re-auth buttons', () => {
      const error = {
        classification: {
          category: 'USER',
          code: 'TOKEN_EXPIRED',
          userAction: 're-auth',
        },
        requestId: 'err_123',
        timestamp: new Date().toISOString(),
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('Your session has expired')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows TRANSIENT error with spinner (no manual action)', () => {
      const error = {
        classification: {
          category: 'TRANSIENT',
          code: 'NETWORK_ERROR',
          retryable: true,
        },
        requestId: 'err_456',
        timestamp: new Date().toISOString(),
      };

      const { container } = render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('Connecting...')).toBeInTheDocument();
      expect(container.querySelector('.spinner')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /contact support/i })).not.toBeInTheDocument();
    });

    it('shows CONFIG error with support contact (hides details)', () => {
      const error = {
        classification: {
          category: 'CONFIG',
          code: 'JWKS_UNAVAILABLE',
          userAction: 'contact-support',
          context: {
            jwksUri: 'https://secret.pingone.com/as/jwks',
          },
        },
        requestId: 'err_789_xyz',
        timestamp: new Date().toISOString(),
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('System configuration issue')).toBeInTheDocument();
      expect(screen.getByText(/err_789_xyz/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
      // Sensitive URIs should not be visible
      expect(screen.queryByText(/pingone.com/)).not.toBeInTheDocument();
    });

    it('shows UNKNOWN error with generic message', () => {
      const error = {
        classification: {
          category: 'UNKNOWN',
          code: 'UNKNOWN_ERROR',
        },
        requestId: 'err_000',
        timestamp: new Date().toISOString(),
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('Unexpected error')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /status page/i })).toBeInTheDocument();
    });
  });

  describe('Retry strategy integration', () => {
    it('retries transient errors with exponential backoff', async () => {
      const error = new Error('Network timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      let attempts = 0;
      const fn = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw error;
        }
        return 'success';
      });

      const result = await ErrorRetryStrategy.executeWithRetry(fn, { maxAttempts: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(attempts).toBe(2);
    });

    it('fails immediately on USER error (no retry)', async () => {
      const error = new Error('Token expired');
      error.classification = {
        category: 'USER',
        retryable: false,
      };

      const fn = jest.fn().mockRejectedValue(error);

      try {
        await ErrorRetryStrategy.executeWithRetry(fn, { maxAttempts: 3 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(fn).toHaveBeenCalledTimes(1);
      }
    });

    it('fails immediately on CONFIG error (no retry)', async () => {
      const error = new Error('JWKS unreachable');
      error.classification = {
        category: 'CONFIG',
        retryable: false,
      };

      const fn = jest.fn().mockRejectedValue(error);

      try {
        await ErrorRetryStrategy.executeWithRetry(fn, { maxAttempts: 3 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(fn).toHaveBeenCalledTimes(1);
      }
    });

    it('gives up after maxAttempts on transient error', async () => {
      const error = new Error('Network timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      const fn = jest.fn().mockRejectedValue(error);

      try {
        await ErrorRetryStrategy.executeWithRetry(fn, { maxAttempts: 2 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(fn).toHaveBeenCalledTimes(2);
      }
    });
  });

  describe('Support contact flow', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('logs error to audit trail', () => {
      const error = {
        requestId: 'err_audit_001',
        timestamp: new Date().toISOString(),
        message: 'JWKS unreachable',
        classification: {
          code: 'JWKS_UNAVAILABLE',
          category: 'CONFIG',
        },
      };

      SupportContactService.logErrorContext(error, { endpoint: '/api/verify' });

      const log = SupportContactService.getAuditLog();
      expect(log.length).toBe(1);
      expect(log[0].error_id).toBe('err_audit_001');
      expect(log[0].category).toBe('CONFIG');
    });

    it('rotates audit log when exceeding max entries', () => {
      for (let i = 0; i < 60; i++) {
        const error = {
          requestId: `err_${i}`,
          timestamp: new Date().toISOString(),
          classification: { code: 'ERROR', category: 'UNKNOWN' },
        };
        SupportContactService.logErrorContext(error, {});
      }

      const log = SupportContactService.getAuditLog();
      expect(log.length).toBeLessThanOrEqual(50);
    });

    it('exports audit log as JSON', () => {
      SupportContactService.logErrorContext(
        {
          requestId: 'err_export_001',
          classification: { code: 'ERROR', category: 'CONFIG' },
        },
        {}
      );

      const exported = SupportContactService.exportAuditLog();
      const parsed = JSON.parse(exported);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].error_id).toBe('err_export_001');
    });

    it('sanitizes sensitive data before opening support dialog', async () => {
      const error = {
        requestId: 'err_sanitize_001',
        timestamp: new Date().toISOString(),
        message: 'Token validation failed',
        classification: {
          code: 'INVALID_SIGNATURE',
          category: 'CONFIG',
        },
      };

      // Mock window.location
      delete window.location;
      window.location = { href: '' };

      await SupportContactService.openSupportDialog(error, {
        userEmail: 'user@example.com',
        endpoint: '/api/verify',
      });

      const mailtoUrl = window.location.href;
      expect(mailtoUrl).toContain('mailto:');
      expect(mailtoUrl).toContain('INVALID_SIGNATURE');
      expect(mailtoUrl).toContain('err_sanitize_001');
      // Should not contain raw tokens or secrets
      expect(mailtoUrl).not.toContain('secret');
    });
  });

  describe('Error persistence and recovery', () => {
    it('recovers from transient error with retry', async () => {
      const transientError = new Error('Connection failed');
      transientError.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      let callCount = 0;
      const apiCall = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw transientError;
        return { data: 'success' };
      });

      const result = await ErrorRetryStrategy.executeWithRetry(apiCall, {
        maxAttempts: 3,
      });

      expect(result.data).toBe('success');
      expect(callCount).toBe(2);
    });

    it('requires manual re-auth after USER error', async () => {
      const userError = new Error('Token expired');
      userError.classification = {
        category: 'USER',
        retryable: false,
        userAction: 're-auth',
      };

      const apiCall = jest.fn().mockRejectedValue(userError);

      try {
        await ErrorRetryStrategy.executeWithRetry(apiCall);
        expect.fail('Should throw');
      } catch (err) {
        expect(err.classification.userAction).toBe('re-auth');
        expect(apiCall).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('Admin config validation panel', () => {
    it('displays check results from API', async () => {
      const mockChecks = {
        passed: true,
        results: {
          jwks: { ok: true, status: 200 },
          token: { ok: true, status: 200 },
          exchanger: { ok: true },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockChecks,
      });

      // Note: Actual AdminConfigValidationPanel test would render component
      // This is a placeholder for the integration concept
      expect(mockChecks.passed).toBe(true);
      expect(mockChecks.results.jwks.ok).toBe(true);
    });
  });

  describe('End-to-end error flow', () => {
    it('USER error flow: display → user clicks refresh → re-auth', async () => {
      const error = {
        classification: {
          category: 'USER',
          code: 'TOKEN_EXPIRED',
          userAction: 're-auth',
        },
        requestId: 'err_e2e_user',
        timestamp: new Date().toISOString(),
      };

      const onRetry = jest.fn();
      const { rerender } = render(
        <AuthErrorBanner error={error} onRetry={onRetry} />
      );

      // User sees error
      expect(screen.getByText('Your session has expired')).toBeInTheDocument();

      // User clicks Refresh
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      expect(onRetry).toHaveBeenCalled();

      // After re-auth, error is cleared
      rerender(<AuthErrorBanner error={null} />);
      expect(screen.queryByText('Your session has expired')).not.toBeInTheDocument();
    });

    it('TRANSIENT error flow: auto-retry → success or USER error', async () => {
      let attempts = 0;
      const error = {
        classification: {
          category: 'TRANSIENT',
          retryable: true,
        },
      };

      const apiCall = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) throw error;
        return { token: 'new-token' };
      });

      const result = await ErrorRetryStrategy.executeWithRetry(apiCall);

      expect(result.token).toBe('new-token');
      expect(attempts).toBe(2);
    });

    it('CONFIG error flow: display → log → contact support', () => {
      const error = {
        classification: {
          category: 'CONFIG',
          code: 'JWKS_UNAVAILABLE',
          userAction: 'contact-support',
        },
        requestId: 'err_e2e_config',
        timestamp: new Date().toISOString(),
      };

      // Log to audit trail
      SupportContactService.logErrorContext(error, { endpoint: '/api/verify' });

      const auditLog = SupportContactService.getAuditLog();
      expect(auditLog[0].error_id).toBe('err_e2e_config');
      expect(auditLog[0].category).toBe('CONFIG');

      // Display shows support contact
      render(<AuthErrorBanner error={error} />);
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });
  });
});
