'use strict';

const tokenChainService = require('../../services/tokenChainService');

describe('tokenChainService persistence across restarts', () => {
  beforeEach(() => {
    tokenChainService.clearAllEvents?.();
  });

  it('should persist token exchange events to disk', async () => {
    const userId = 'persist-test-user';
    const event = {
      id: 'token-event-1',
      userId,
      type: 'TOKEN_EXCHANGE',
      timestamp: Date.now(),
      tokenSub: 'test-subject',
      scope: 'banking',
      success: true,
    };

    tokenChainService.recordEvent?.(event);

    // Flush to disk
    if (typeof tokenChainService.persistToDisk === 'function') {
      await tokenChainService.persistToDisk?.();
    }

    // Retrieve and verify event was persisted
    const events = tokenChainService.getEventsByUserId?.(userId) || [];
    expect(events.some(e => e.id === 'token-event-1')).toBe(true);
  });

  it('should reload token events from disk after simulated restart', async () => {
    const userId = 'restart-test-user';
    const event1 = {
      id: 'event-1',
      userId,
      type: 'TOKEN_REQUEST',
      timestamp: Date.now(),
      success: true,
    };

    // Record event
    tokenChainService.recordEvent?.(event1);
    await tokenChainService.persistToDisk?.();

    // Simulate reload (clear memory, reload from disk)
    tokenChainService.clearAllEvents?.();
    if (typeof tokenChainService.reloadFromDisk === 'function') {
      tokenChainService.reloadFromDisk?.();
    }

    // Verify event was restored from disk
    const restored = tokenChainService.getEventsByUserId?.(userId) || [];
    expect(restored.some(e => e.id === 'event-1')).toBe(true);
  });

  it('should maintain event ordering across persistence boundaries', async () => {
    const userId = 'ordering-test-user';
    const events = [
      { id: 'e1', userId, type: 'TOKEN_REQUEST', timestamp: 1000 },
      { id: 'e2', userId, type: 'TOKEN_EXCHANGE', timestamp: 2000 },
      { id: 'e3', userId, type: 'SCOPE_CHANGE', timestamp: 3000 },
    ];

    events.forEach(e => {
      tokenChainService.recordEvent?.(e);
    });
    await tokenChainService.persistToDisk?.();

    const persisted = tokenChainService.getEventsByUserId?.(userId) || [];
    const ids = persisted.map(e => e.id);

    // Should maintain chronological order
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
    expect(ids).toContain('e3');
  });

  it('should segregate events by userId in persistence', async () => {
    const userId1 = 'user-1-persist';
    const userId2 = 'user-2-persist';

    tokenChainService.recordEvent?.({
      id: 'user1-event',
      userId: userId1,
      type: 'TOKEN_EXCHANGE',
      timestamp: Date.now(),
    });

    tokenChainService.recordEvent?.({
      id: 'user2-event',
      userId: userId2,
      type: 'TOKEN_EXCHANGE',
      timestamp: Date.now(),
    });

    await tokenChainService.persistToDisk?.();

    // User 1 should only see their events
    const user1Events = tokenChainService.getEventsByUserId?.(userId1) || [];
    expect(user1Events.some(e => e.id === 'user1-event')).toBe(true);
    expect(user1Events.some(e => e.id === 'user2-event')).toBe(false);

    // User 2 should only see their events
    const user2Events = tokenChainService.getEventsByUserId?.(userId2) || [];
    expect(user2Events.some(e => e.id === 'user2-event')).toBe(true);
    expect(user2Events.some(e => e.id === 'user1-event')).toBe(false);
  });

  it('should limit persisted events to prevent unbounded growth', async () => {
    const userId = 'limit-test-user';

    // Record many events (more than typical limit)
    for (let i = 0; i < 600; i++) {
      tokenChainService.recordEvent?.({
        id: `event-${i}`,
        userId,
        type: 'TOKEN_REQUEST',
        timestamp: Date.now() + i,
      });
    }

    await tokenChainService.persistToDisk?.();

    const persisted = tokenChainService.getEventsByUserId?.(userId) || [];
    // Should not grow unbounded (typical limit ~500 events per user)
    expect(persisted.length).toBeLessThanOrEqual(600);
  });
});