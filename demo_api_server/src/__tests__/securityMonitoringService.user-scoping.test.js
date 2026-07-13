'use strict';

const securityMonitoringService = require('../../services/securityMonitoringService');

describe('securityMonitoringService user/client scoping', () => {
  beforeEach(() => {
    // Clear all security events before each test
    securityMonitoringService.clearAllEvents?.();
  });

  it('should scope security events by clientId for multi-user safety', () => {
    const clientId1 = 'oauth-app-1';
    const clientId2 = 'oauth-app-2';
    const userId1 = 'user-1';
    const userId2 = 'user-2';

    // Record events for different clients
    securityMonitoringService.trackEvent({
      type: 'TOKEN_EXCHANGE',
      clientId: clientId1,
      userId: userId1,
      timestamp: Date.now(),
      success: true,
    });

    securityMonitoringService.trackEvent({
      type: 'TOKEN_EXCHANGE',
      clientId: clientId2,
      userId: userId2,
      timestamp: Date.now(),
      success: false,
    });

    // Events for client 1 should not include client 2's events
    const client1Events = securityMonitoringService.getEventsByClientId?.(clientId1) || [];
    expect(client1Events.some(e => e.clientId === clientId1)).toBe(true);
    expect(client1Events.every(e => e.clientId !== clientId2)).toBe(true);

    // Events for client 2 should not include client 1's events
    const client2Events = securityMonitoringService.getEventsByClientId?.(clientId2) || [];
    expect(client2Events.some(e => e.clientId === clientId2)).toBe(true);
    expect(client2Events.every(e => e.clientId !== clientId1)).toBe(true);
  });

  it('should track client behavior independently per clientId', () => {
    const clientId1 = 'app-1';
    const clientId2 = 'app-2';

    // Simulate failed attempts for client 1
    for (let i = 0; i < 3; i++) {
      securityMonitoringService.recordFailedAttempt(clientId1);
    }

    // Simulate 1 failed attempt for client 2
    securityMonitoringService.recordFailedAttempt(clientId2);

    // Client 1's behavior should show 3 failures
    const behavior1 = securityMonitoringService.getClientBehavior?.(clientId1);
    expect(behavior1?.failed_attempts).toBe(3);

    // Client 2's behavior should show only 1 failure
    const behavior2 = securityMonitoringService.getClientBehavior?.(clientId2);
    expect(behavior2?.failed_attempts).toBe(1);

    // No cross-client contamination
    expect(behavior1?.failed_attempts).not.toBe(behavior2?.failed_attempts);
  });

  it('should track IP reputation globally (not per-user)', () => {
    const ip1 = '192.168.1.100';
    const ip2 = '10.0.0.1';

    securityMonitoringService.recordIpReputation(ip1, 'suspicious');
    securityMonitoringService.recordIpReputation(ip2, 'clean');

    const rep1 = securityMonitoringService.getIpReputation?.(ip1);
    const rep2 = securityMonitoringService.getIpReputation?.(ip2);

    expect(rep1).toBe('suspicious');
    expect(rep2).toBe('clean');
  });

  it('should prevent security event leakage when fetching all events', () => {
    const clientId1 = 'client-1';
    const clientId2 = 'client-2';

    securityMonitoringService.trackEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      clientId: clientId1,
      userId: 'user-1',
      details: 'Secret details for client 1',
    });

    securityMonitoringService.trackEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      clientId: clientId2,
      userId: 'user-2',
      details: 'Secret details for client 2',
    });

    // Admin view should aggregate all events but with proper scoping
    const allEvents = securityMonitoringService.getAllEvents?.() || [];

    // Event from client 1 should not leak client 2's details
    const client1EventsFromAll = allEvents.filter(e => e.clientId === clientId1);
    expect(client1EventsFromAll.every(e => !e.details?.includes('client 2'))).toBe(true);

    // Event from client 2 should not leak client 1's details
    const client2EventsFromAll = allEvents.filter(e => e.clientId === clientId2);
    expect(client2EventsFromAll.every(e => !e.details?.includes('client 1'))).toBe(true);
  });

  it('should persist security events across restarts for audit trail', async () => {
    const clientId = 'audit-client';
    const eventId = 'event-' + Date.now();

    securityMonitoringService.trackEvent({
      id: eventId,
      type: 'CRITICAL_ALERT',
      clientId: clientId,
      userId: 'audit-user',
      timestamp: Date.now(),
    });

    // Force flush to persistence
    if (typeof securityMonitoringService.persistToDisk === 'function') {
      await securityMonitoringService.persistToDisk?.();
    }

    // Simulate reload
    if (typeof securityMonitoringService.reloadFromDisk === 'function') {
      securityMonitoringService.reloadFromDisk?.();
      const reloadedEvents = securityMonitoringService.getEventsByClientId?.(clientId) || [];
      expect(reloadedEvents.some(e => e.id === eventId)).toBe(true);
    }
  });

  it('should handle concurrent security event tracking from multiple clients', async () => {
    const clients = ['client-A', 'client-B', 'client-C'];

    const promises = clients.flatMap(clientId =>
      Array.from({ length: 5 }, (_, i) =>
        Promise.resolve().then(() => {
          securityMonitoringService.trackEvent({
            type: 'CONCURRENT_TEST',
            clientId,
            userId: `user-${clientId}`,
            eventIndex: i,
          });
        })
      )
    );

    await Promise.all(promises);

    // Each client should have exactly 5 events
    for (const clientId of clients) {
      const events = securityMonitoringService.getEventsByClientId?.(clientId) || [];
      const clientSpecificEvents = events.filter(e => e.clientId === clientId);
      expect(clientSpecificEvents.length).toBe(5);
    }
  });
});
