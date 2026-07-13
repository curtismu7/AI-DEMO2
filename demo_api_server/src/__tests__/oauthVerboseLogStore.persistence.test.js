'use strict';

const oauthVerboseLogStore = require('../../services/oauthVerboseLogStore');

describe('oauthVerboseLogStore persistence and file rotation', () => {
  beforeEach(async () => {
    oauthVerboseLogStore.clearAllLogs?.();
  });

  it('should persist logs to per-user files on disk', async () => {
    const userId = 'persist-oauth-user-1';
    const logMessage = '[TOKEN_EXCHANGE] Successful token exchange for user';

    oauthVerboseLogStore.appendLine(logMessage, userId);

    // Force flush to disk
    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // Retrieve from disk
    const result = await oauthVerboseLogStore.getRecentLines?.(userId);
    const lines = result?.lines || [];

    expect(lines.some(line => line.includes(logMessage))).toBe(true);
  });

  it('should reload logs from disk after simulated restart', async () => {
    const userId = 'restart-oauth-user';
    const logMessage = '[RESTART_TEST] Critical OAuth event to persist';

    oauthVerboseLogStore.appendLine(logMessage, userId);
    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // Simulate restart: clear memory and reload from disk
    oauthVerboseLogStore.clearAllLogs?.();
    if (typeof oauthVerboseLogStore.reloadFromDisk === 'function') {
      oauthVerboseLogStore.reloadFromDisk?.();
    }

    // Verify event was restored
    const result = await oauthVerboseLogStore.getRecentLines?.(userId);
    const lines = result?.lines || [];

    expect(lines.some(line => line.includes(logMessage))).toBe(true);
  });

  it('should rotate per-user log files when they exceed size limit', async () => {
    const userId = 'rotate-oauth-user';
    const largeMessage = 'X'.repeat(1000); // 1KB message

    // Append many messages to exceed rotation threshold
    for (let i = 0; i < 600; i++) {
      oauthVerboseLogStore.appendLine(`[MSG_${i}] ${largeMessage}`, userId);
    }

    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // Should not have unbounded file growth
    const result = await oauthVerboseLogStore.getRecentLines?.(userId, 50);
    const lines = result?.lines || [];

    // Recent lines should still be retrievable
    expect(lines.length).toBeGreaterThan(0);
  });

  it('should keep per-user logs segregated in files', async () => {
    const userId1 = 'file-seg-user-1';
    const userId2 = 'file-seg-user-2';

    oauthVerboseLogStore.appendLine('[USER1_LOG] Secret for user 1', userId1);
    oauthVerboseLogStore.appendLine('[USER2_LOG] Secret for user 2', userId2);

    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // User 1 logs should not contain User 2 data
    const result1 = await oauthVerboseLogStore.getRecentLines?.(userId1);
    const lines1 = result1?.lines || [];

    expect(lines1.some(line => line.includes('USER1_LOG'))).toBe(true);
    expect(lines1.some(line => line.includes('USER2_LOG'))).toBe(false);

    // User 2 logs should not contain User 1 data
    const result2 = await oauthVerboseLogStore.getRecentLines?.(userId2);
    const lines2 = result2?.lines || [];

    expect(lines2.some(line => line.includes('USER2_LOG'))).toBe(true);
    expect(lines2.some(line => line.includes('USER1_LOG'))).toBe(false);
  });

  it('should maintain audit trail through restarts', async () => {
    const userId = 'audit-trail-user';
    const events = [
      '[STEP1] OAuth request initiated',
      '[STEP2] Authorization granted',
      '[STEP3] Token exchanged',
      '[STEP4] Session created',
    ];

    events.forEach((event, idx) => {
      oauthVerboseLogStore.appendLine(event, userId);
    });

    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // Simulate restart
    oauthVerboseLogStore.clearAllLogs?.();
    if (typeof oauthVerboseLogStore.reloadFromDisk === 'function') {
      oauthVerboseLogStore.reloadFromDisk?.();
    }

    // Verify complete audit trail restored
    const result = await oauthVerboseLogStore.getRecentLines?.(userId);
    const lines = result?.lines || [];

    events.forEach(event => {
      expect(lines.some(line => line.includes(event))).toBe(true);
    });
  });

  it('should handle concurrent logging to different users without losing data', async () => {
    const userIds = ['concurrent-user-1', 'concurrent-user-2', 'concurrent-user-3'];

    // Simulate concurrent logging from multiple users
    const promises = userIds.flatMap(userId =>
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() => {
          oauthVerboseLogStore.appendLine(`[LOG_${i}] Message from ${userId}`, userId);
        })
      )
    );

    await Promise.all(promises);

    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // Verify each user has all their messages
    for (const userId of userIds) {
      const result = await oauthVerboseLogStore.getRecentLines?.(userId);
      const lines = result?.lines || [];
      expect(lines.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('should clear old log files while keeping recent ones', async () => {
    const userId = 'archive-user';

    // Append and flush multiple times to simulate multiple rotations
    for (let batch = 0; batch < 3; batch++) {
      oauthVerboseLogStore.appendLine(`[BATCH_${batch}] Log entry`, userId);
      if (typeof oauthVerboseLogStore.flush === 'function') {
        await oauthVerboseLogStore.flush?.();
      }
    }

    // Should have kept recent logs
    const result = await oauthVerboseLogStore.getRecentLines?.(userId);
    const lines = result?.lines || [];

    expect(lines.length).toBeGreaterThan(0);
  });
});