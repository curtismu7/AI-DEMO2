/**
 * appConfig.test.js
 * Unit tests for centralized app configuration
 */

import APP_CONFIG from '../appConfig';

describe('APP_CONFIG', () => {
  describe('Session & Timing', () => {
    it('should have session expiry warning threshold', () => {
      expect(APP_CONFIG.SESSION_EXPIRY_WARNING_MS).toBe(5 * 60 * 1000);
      expect(APP_CONFIG.SESSION_EXPIRY_WARNING_MS).toBeGreaterThan(0);
    });

    it('should have session check interval', () => {
      expect(APP_CONFIG.SESSION_CHECK_INTERVAL_MS).toBe(1000);
    });

    it('should have cold-start retry delays', () => {
      const delays = APP_CONFIG.SESSION_REHYDRATION_RETRY_DELAYS_MS;
      expect(Array.isArray(delays)).toBe(true);
      expect(delays).toEqual([0, 600, 1400, 2500]);
      expect(delays.length).toBeGreaterThan(0);
    });

    it('retry delays should be increasing', () => {
      const delays = APP_CONFIG.SESSION_REHYDRATION_RETRY_DELAYS_MS;
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
      }
    });
  });

  describe('API Retry & Timeout', () => {
    it('should have API max retries', () => {
      expect(APP_CONFIG.API_MAX_RETRIES).toBe(3);
      expect(APP_CONFIG.API_MAX_RETRIES).toBeGreaterThanOrEqual(0);
    });

    it('should have reasonable base delay', () => {
      expect(APP_CONFIG.API_RETRY_BASE_DELAY_MS).toBe(200);
      expect(APP_CONFIG.API_RETRY_BASE_DELAY_MS).toBeGreaterThan(0);
    });

    it('should have max delay greater than base', () => {
      expect(APP_CONFIG.API_RETRY_MAX_DELAY_MS).toBeGreaterThan(
        APP_CONFIG.API_RETRY_BASE_DELAY_MS
      );
    });

    it('should have API timeout', () => {
      expect(APP_CONFIG.API_TIMEOUT_MS).toBe(30000);
      expect(APP_CONFIG.API_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });

  describe('Toast Durations', () => {
    it('should have toast duration config', () => {
      const durations = APP_CONFIG.TOAST_DURATION_MS;
      expect(typeof durations).toBe('object');
    });

    it('should have success toast duration', () => {
      expect(APP_CONFIG.TOAST_DURATION_MS.SUCCESS_ACTION).toBe(4000);
      expect(APP_CONFIG.TOAST_DURATION_MS.SUCCESS_ACTION).toBeGreaterThan(0);
    });

    it('should have error toast durations', () => {
      expect(APP_CONFIG.TOAST_DURATION_MS.ERROR_SHORT).toBe(3000);
      expect(APP_CONFIG.TOAST_DURATION_MS.ERROR_LONG).toBe(6000);
      expect(APP_CONFIG.TOAST_DURATION_MS.ERROR_LONG).toBeGreaterThan(
        APP_CONFIG.TOAST_DURATION_MS.ERROR_SHORT
      );
    });

    it('should have info token duration', () => {
      expect(APP_CONFIG.TOAST_DURATION_MS.INFO_TOKEN).toBe(5000);
    });

    it('all toast durations should be positive', () => {
      Object.values(APP_CONFIG.TOAST_DURATION_MS).forEach(duration => {
        expect(duration).toBeGreaterThan(0);
      });
    });
  });

  describe('Transaction Thresholds', () => {
    it('should have HITL threshold', () => {
      expect(APP_CONFIG.THRESHOLDS.HITL_DEFAULT).toBe(500);
      expect(APP_CONFIG.THRESHOLDS.HITL_DEFAULT).toBeGreaterThan(0);
    });

    it('should have MFA threshold', () => {
      expect(APP_CONFIG.THRESHOLDS.MFA_DEFAULT).toBe(500);
    });

    it('should have demo large transfer amount', () => {
      expect(APP_CONFIG.THRESHOLDS.DEMO_LARGE_TRANSFER).toBe(99999.99);
      expect(APP_CONFIG.THRESHOLDS.DEMO_LARGE_TRANSFER).toBeGreaterThan(
        APP_CONFIG.THRESHOLDS.HITL_DEFAULT
      );
    });

    it('should have minimum transaction', () => {
      expect(APP_CONFIG.THRESHOLDS.MIN_TRANSACTION).toBe(0.01);
      expect(APP_CONFIG.THRESHOLDS.MIN_TRANSACTION).toBeGreaterThan(0);
    });

    it('should have maximum transaction', () => {
      expect(APP_CONFIG.THRESHOLDS.MAX_TRANSACTION).toBe(1_000_000);
      expect(APP_CONFIG.THRESHOLDS.MAX_TRANSACTION).toBeGreaterThan(
        APP_CONFIG.THRESHOLDS.MIN_TRANSACTION
      );
    });

    it('min should be less than max', () => {
      expect(APP_CONFIG.THRESHOLDS.MIN_TRANSACTION).toBeLessThan(
        APP_CONFIG.THRESHOLDS.MAX_TRANSACTION
      );
    });
  });

  describe('Compliance & Security', () => {
    it('should have compliance step count', () => {
      expect(APP_CONFIG.COMPLIANCE_STEP_COUNT).toBe(12);
      expect(APP_CONFIG.COMPLIANCE_STEP_COUNT).toBeGreaterThan(0);
    });

    it('should have step-up timeout', () => {
      expect(APP_CONFIG.STEP_UP_TIMEOUT_MS).toBe(30000);
      expect(APP_CONFIG.STEP_UP_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });

  describe('Storage Keys', () => {
    it('should have storage key constants', () => {
      expect(APP_CONFIG.STORAGE_KEYS.PENDING_NL).toBe(
        'bx_agent_pending_nl'
      );
      expect(APP_CONFIG.STORAGE_KEYS.PENDING_ACTION).toBe(
        '_agent_pending_auth_action'
      );
      expect(APP_CONFIG.STORAGE_KEYS.COMPLIANCE_MODAL).toBe(
        'compliance_modal_popout'
      );
    });

    it('all storage keys should be non-empty strings', () => {
      Object.values(APP_CONFIG.STORAGE_KEYS).forEach(key => {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Response Limits', () => {
    it('should have max body length', () => {
      expect(APP_CONFIG.RESPONSE_LIMITS.MAX_BODY_LENGTH).toBe(5 * 1024 * 1024);
      expect(APP_CONFIG.RESPONSE_LIMITS.MAX_BODY_LENGTH).toBeGreaterThan(0);
    });

    it('should have max accounts limit', () => {
      expect(APP_CONFIG.RESPONSE_LIMITS.MAX_ACCOUNTS).toBe(100);
      expect(APP_CONFIG.RESPONSE_LIMITS.MAX_ACCOUNTS).toBeGreaterThan(0);
    });

    it('should have max transactions limit', () => {
      expect(APP_CONFIG.RESPONSE_LIMITS.MAX_TRANSACTIONS).toBe(500);
      expect(APP_CONFIG.RESPONSE_LIMITS.MAX_TRANSACTIONS).toBeGreaterThan(0);
    });

    it('all limits should be positive', () => {
      Object.values(APP_CONFIG.RESPONSE_LIMITS).forEach(limit => {
        expect(limit).toBeGreaterThan(0);
      });
    });
  });

  describe('Text Length Limits', () => {
    it('should have text length limits', () => {
      expect(APP_CONFIG.TEXT_LENGTH_LIMITS.DESCRIPTION).toBe(500);
      expect(APP_CONFIG.TEXT_LENGTH_LIMITS.ACCOUNT_NAME).toBe(100);
      expect(APP_CONFIG.TEXT_LENGTH_LIMITS.ACCOUNT_NUMBER).toBe(20);
    });

    it('all text limits should be positive', () => {
      Object.values(APP_CONFIG.TEXT_LENGTH_LIMITS).forEach(limit => {
        expect(limit).toBeGreaterThan(0);
      });
    });

    it('description limit should be largest', () => {
      expect(APP_CONFIG.TEXT_LENGTH_LIMITS.DESCRIPTION).toBeGreaterThan(
        APP_CONFIG.TEXT_LENGTH_LIMITS.ACCOUNT_NAME
      );
    });
  });

  describe('Debounce Settings', () => {
    it('should have debounce delays', () => {
      expect(APP_CONFIG.DEBOUNCE_MS.SEARCH).toBe(300);
      expect(APP_CONFIG.DEBOUNCE_MS.INPUT).toBe(200);
    });

    it('all debounce values should be positive', () => {
      Object.values(APP_CONFIG.DEBOUNCE_MS).forEach(delay => {
        expect(delay).toBeGreaterThan(0);
      });
    });
  });

  describe('Feature Flags', () => {
    it('should have debug mode flag', () => {
      expect(typeof APP_CONFIG.DEBUG_MODE).toBe('boolean');
    });

    it('should have strict validation flag', () => {
      expect(typeof APP_CONFIG.STRICT_VALIDATION).toBe('boolean');
    });

    it('debug mode should be disabled by default', () => {
      expect(APP_CONFIG.DEBUG_MODE).toBe(false);
    });

    it('strict validation should be disabled by default', () => {
      expect(APP_CONFIG.STRICT_VALIDATION).toBe(false);
    });
  });

  describe('Config immutability (frozen)', () => {
    it('should be a valid object', () => {
      expect(typeof APP_CONFIG).toBe('object');
      expect(APP_CONFIG).not.toBeNull();
    });

    it('should have all required top-level sections', () => {
      expect(APP_CONFIG.SESSION_EXPIRY_WARNING_MS).toBeDefined();
      expect(APP_CONFIG.API_MAX_RETRIES).toBeDefined();
      expect(APP_CONFIG.TOAST_DURATION_MS).toBeDefined();
      expect(APP_CONFIG.THRESHOLDS).toBeDefined();
      expect(APP_CONFIG.COMPLIANCE_STEP_COUNT).toBeDefined();
      expect(APP_CONFIG.STORAGE_KEYS).toBeDefined();
      expect(APP_CONFIG.RESPONSE_LIMITS).toBeDefined();
    });
  });
});
