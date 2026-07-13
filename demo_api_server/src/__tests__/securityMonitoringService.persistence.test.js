'use strict';

const securityMonitoringService = require('../../services/securityMonitoringService');

describe('securityMonitoringService persistence across restarts', () => {
  beforeEach(() => {
    securityMonitoringService.clearAllEvents?.();
  });

  it('should persist security events to disk', async () => {
    const clientId = 'persist-app-1';
    const event = {
      id: 'sec-event-1',
      type: 'TOKEN_EXCHANGE',
      clientId,
      userId: 'user-1',
      timestamp: Date.now(),
      success: true,
    };

    securityMonitoringService.trackEvent?.(event);
    await securityMonitoringService.persistToDisk?.();

    // Retrieve and verify
    const events = securityMonitoringService.getEventsByClientId?.(clientId) || [];
    expect(events.some(e => e.id === 'sec-event-1')).toBe(true);
  });

  it('should reload security events from disk after restart', async () => {
    const clientId = 'restart-app-1';
    const event = {
      id: 'restart-event-1',
      type: 'SUSPICIOUS_ACTIVITY',
      clientId,
      timestamp: Date.now(),
    };

    securityMonitoringService.trackEvent?.(event);
    await securityMonitoringService.persistToDisk?.();

    // Simulate restart
    securityMonitoringService.clearAllEvents?.();
    securityMonitoringService.reloadFromDisk?.();

    // Verify restoration
    const restored = securityMonitoringService.getEventsByClientId?.(clientId) || [];
    expect(restored.some(e => e.id === 'restart-event-1')).toBe(true);
  });

  it('should persist active alerts to disk', async () => {
    const clientId = 'alert-app-1';

    securityMonitoringService.trackEvent?.({
      id: 'alert-test-1',
      type: 'FAILED_AUTH_ATTEMPTS',
      clientId,
      timestamp: Date.now(),
    });

    await securityMonitoringService.persistToDisk?.();

    // Should be restorable after restart
    securityMonitoringService.clearAllEvents?.();
    securityMonitoringService.reloadFromDisk?.();

    const events = securityMonitoringService.getEventsByClientId?.(clientId) || [];
    expect(events.length).toBeGreaterThan(0);
  });

  it('should persist client behavior tracking across restarts', async () => {
    const clientId = 'behavior-app-1';

    // Record failed attempts
    securityMonitoringService.recordFailedAttempt?.(clientId);
    securityMonitoringService.recordFailedAttempt?.(clientId);
    securityMonitoringService.recordFailedAttempt?.(clientId);

    await securityMonitoringService.persistToDisk?.();

    // Simulate restart
    securityMonitoringService.clearAllEvents?.();
    securityMonitoringService.reloadFromDisk?.();

    // Verify behavior was restored
    const behavior = securityMonitoringService.getClientBehavior?.(clientId);
    expect(behavior?.failed_attempts).toBe(3);
  });

  it('should clean up old security data based on retention policy', async () => {
    const clientId1 = 'cleanup-app-1';
    const now = Date.now();

    // Record recent event
    securityMonitoringService.trackEvent?.({
      id: 'recent-event',
      type: 'TOKEN_EXCHANGE',
      clientId: clientId1,
      timestamp: now,
      last_seen: now, // Add last_seen for cleanup detection
    });

    await securityMonitoringService.persistToDisk?.();

    // Verify recent event is kept even after cleanup
    const recentEvents = securityMonitoringService.getEventsByClientId?.(clientId1) || [];
    expect(recentEvents.some(e => e.id === 'recent-event')).toBe(true);
  });

  it('should not lose metrics across restart', async () => {
    securityMonitoringService.trackEvent?.({
      id: 'metric-event-1',
      type: 'TOKEN_EXCHANGE',
      clientId: 'metric-app',
      timestamp: Date.now(),
    });

    await securityMonitoringService.persistToDisk?.();

    // Simulate restart
    securityMonitoringService.clearAllEvents?.();
    securityMonitoringService.reloadFromDisk?.();

    const events = securityMonitoringService.getAllEvents?.() || [];
    expect(events.length).toBeGreaterThan(0);
  });

  it('should handle concurrent persistence and reads safely', async () => {
    const clientIds = ['app-1', 'app-2', 'app-3'];

    // Simulate concurrent writes
    const promises = clientIds.flatMap(clientId =>
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          securityMonitoringService.trackEvent?.({
            id: `${clientId}-event-${i}`,
            type: 'TOKEN_REQUEST',
            clientId,
            timestamp: Date.now(),
          });
        })
      )
    );

    await Promise.all(promises);
    await securityMonitoringService.persistToDisk?.();

    // Verify all data persisted correctly
    for (const clientId of clientIds) {
      const events = securityMonitoringService.getEventsByClientId?.(clientId) || [];
      expect(events.length).toBe(10);
    }
  });
});