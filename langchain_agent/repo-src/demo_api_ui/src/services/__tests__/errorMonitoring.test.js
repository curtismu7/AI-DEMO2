/**
 * errorMonitoring.test.js
 * Unit tests for error monitoring and logging
 */

import { ErrorMonitor } from '../errorMonitoring';

describe('ErrorMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new ErrorMonitor();
    // Suppress console output during tests
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('logAttempt', () => {
    it('should log an attempt', () => {
      monitor.logAttempt({
        endpoint: '/api/test',
        attemptNumber: 1,
        classification: { type: 'network', code: 'E_NETWORK' },
        duration: 100,
      });

      const events = monitor.export();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('attempt');
      expect(events[0].endpoint).toBe('/api/test');
      expect(events[0].attemptNumber).toBe(1);
    });

    it('should add timestamp to attempt', () => {
      const beforeTime = Date.now();
      monitor.logAttempt({
        endpoint: '/api/test',
        attemptNumber: 1,
        classification: { type: 'network' },
      });
      const afterTime = Date.now();

      const events = monitor.export();
      expect(events[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(events[0].timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('logRetrySuccess', () => {
    it('should log a successful retry', () => {
      monitor.logRetrySuccess({
        endpoint: '/api/test',
        totalAttempts: 3,
        elapsedTime: 1500,
      });

      const events = monitor.export();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('retry_success');
      expect(events[0].totalAttempts).toBe(3);
    });
  });

  describe('logRetryFailure', () => {
    it('should log a retry failure', () => {
      const error = new Error('Network error');
      monitor.logRetryFailure({
        endpoint: '/api/test',
        totalAttempts: 3,
        error,
        classification: { type: 'network', code: 'E_NETWORK' },
      });

      const events = monitor.export();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('retry_failure');
      expect(events[0].error).toBe(error);
    });
  });

  describe('logSessionRestore', () => {
    it('should log session restore', () => {
      monitor.logSessionRestore({
        statusEndpoints: ['/api/auth/oauth/status', '/api/auth/session'],
        attemptNumber: 2,
        found: true,
      });

      const events = monitor.export();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('session_restore');
      expect(events[0].found).toBe(true);
    });
  });

  describe('getRecentEvents', () => {
    it('should return recent events', () => {
      for (let i = 0; i < 5; i++) {
        monitor.logAttempt({
          endpoint: `/api/test${i}`,
          attemptNumber: 1,
          classification: { type: 'network' },
        });
      }

      const recent = monitor.getRecentEvents(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].endpoint).toBe('/api/test2');
      expect(recent[2].endpoint).toBe('/api/test4');
    });

    it('should return all events if count exceeds total', () => {
      monitor.logAttempt({
        endpoint: '/api/test',
        attemptNumber: 1,
        classification: { type: 'network' },
      });

      const recent = monitor.getRecentEvents(100);
      expect(recent).toHaveLength(1);
    });

    it('should return 10 events by default', () => {
      for (let i = 0; i < 20; i++) {
        monitor.logAttempt({
          endpoint: '/api/test',
          attemptNumber: 1,
          classification: { type: 'network' },
        });
      }

      const recent = monitor.getRecentEvents();
      expect(recent).toHaveLength(10);
    });
  });

  describe('getStats', () => {
    it('should calculate statistics', () => {
      monitor.logAttempt({
        endpoint: '/api/users',
        attemptNumber: 1,
        classification: { type: 'network' },
      });
      monitor.logRetrySuccess({
        endpoint: '/api/users',
        totalAttempts: 2,
        elapsedTime: 1000,
      });
      monitor.logRetryFailure({
        endpoint: '/api/posts',
        totalAttempts: 3,
        error: new Error('Failed'),
        classification: { type: 'server' },
      });

      const stats = monitor.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byType.attempt).toBe(1);
      expect(stats.byType.retry_success).toBe(1);
      expect(stats.byType.retry_failure).toBe(1);
    });

    it('should group statistics by endpoint', () => {
      monitor.logAttempt({ endpoint: '/api/users', attemptNumber: 1, classification: {} });
      monitor.logAttempt({ endpoint: '/api/users', attemptNumber: 1, classification: {} });
      monitor.logAttempt({ endpoint: '/api/posts', attemptNumber: 1, classification: {} });

      const stats = monitor.getStats();
      expect(stats.byEndpoint['/api/users']).toBe(2);
      expect(stats.byEndpoint['/api/posts']).toBe(1);
    });

    it('should group statistics by classification type', () => {
      monitor.logAttempt({
        endpoint: '/api/test',
        attemptNumber: 1,
        classification: { type: 'network' },
      });
      monitor.logAttempt({
        endpoint: '/api/test',
        attemptNumber: 1,
        classification: { type: 'auth' },
      });

      const stats = monitor.getStats();
      expect(stats.byClassification.network).toBe(1);
      expect(stats.byClassification.auth).toBe(1);
    });

    it('should calculate failure rate', () => {
      monitor.logRetrySuccess({ endpoint: '/api/test', totalAttempts: 1 });
      monitor.logRetrySuccess({ endpoint: '/api/test', totalAttempts: 1 });
      monitor.logRetryFailure({ endpoint: '/api/test', totalAttempts: 1, error: new Error(), classification: {} });

      const stats = monitor.getStats();
      expect(stats.failureRate).toBe(1 / 3);
    });

    it('should handle zero failures', () => {
      monitor.logRetrySuccess({ endpoint: '/api/test', totalAttempts: 1 });
      monitor.logRetrySuccess({ endpoint: '/api/test', totalAttempts: 1 });

      const stats = monitor.getStats();
      expect(stats.failureRate).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all events', () => {
      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });
      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });

      expect(monitor.export()).toHaveLength(2);
      monitor.clear();
      expect(monitor.export()).toHaveLength(0);
    });
  });

  describe('export', () => {
    it('should return a copy of events', () => {
      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });

      const exported = monitor.export();
      expect(exported).toHaveLength(1);

      // Verify it's a copy, not the original array
      exported.pop();
      expect(monitor.export()).toHaveLength(1);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners on new events', () => {
      const listener = jest.fn();
      monitor.subscribe(listener);

      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'attempt',
          endpoint: '/api/test',
        })
      );
    });

    it('should return unsubscribe function', () => {
      const listener = jest.fn();
      const unsubscribe = monitor.subscribe(listener);

      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });

      expect(listener).toHaveBeenCalledTimes(1); // Still only once
    });

    it('should handle listener errors gracefully', () => {
      const badListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = jest.fn();

      monitor.subscribe(badListener);
      monitor.subscribe(goodListener);

      monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });

      // Good listener should still be called despite bad listener error
      expect(goodListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('configure', () => {
    it('should configure monitoring settings', () => {
      monitor.configure({
        enableLogging: false,
        enableAnalytics: true,
      });

      expect(monitor.config.enableLogging).toBe(false);
      expect(monitor.config.enableAnalytics).toBe(true);
    });

    it('should merge with existing config', () => {
      monitor.configure({ enableLogging: false });

      // enableAnalytics should still exist from defaults
      expect(monitor.config.enableAnalytics).toBeDefined();
      expect(monitor.config.enableLogging).toBe(false);
    });
  });

  describe('maxEvents limit', () => {
    it('should keep only last N events when limit is exceeded', () => {
      monitor.maxEvents = 10;

      for (let i = 0; i < 20; i++) {
        monitor.logAttempt({ endpoint: '/api/test', attemptNumber: 1, classification: {} });
      }

      expect(monitor.export()).toHaveLength(10);
    });
  });

  describe('analytics integration', () => {
    it('should send events to analytics endpoint when enabled', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );

      monitor.configure({
        enableAnalytics: true,
        analyticsEndpoint: '/api/errors/log',
      });

      monitor.logAttempt({
        endpoint: '/api/test',
        attemptNumber: 1,
        classification: { type: 'network' },
      });

      // Give promise time to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/errors/log',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      );
    });

    it('should not fail if analytics endpoint is unreachable', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

      monitor.configure({
        enableAnalytics: true,
        analyticsEndpoint: '/api/errors/log',
      });

      // Should not throw
      expect(() => {
        monitor.logAttempt({
          endpoint: '/api/test',
          attemptNumber: 1,
          classification: {},
        });
      }).not.toThrow();
    });
  });
});
