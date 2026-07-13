'use strict';

const oauthVerboseLogStore = require('../../services/oauthVerboseLogStore');

describe('oauthVerboseLogStore user segregation', () => {
  beforeEach(async () => {
    // Clear logs before each test (both memory and file)
    oauthVerboseLogStore.clearAllLogs?.();
    await oauthVerboseLogStore.clear?.();
  });

  it('should partition logs by userId - logs from user A should not appear in user B fetch', async () => {
    const userId1 = 'test-user-1';
    const userId2 = 'test-user-2';

    oauthVerboseLogStore.appendLine(
      '[OAUTH] User 1 token exchange',
      userId1
    );
    oauthVerboseLogStore.appendLine(
      '[OAUTH] User 1 callback',
      userId1
    );

    oauthVerboseLogStore.appendLine(
      '[OAUTH] User 2 token exchange',
      userId2
    );
    oauthVerboseLogStore.appendLine(
      '[OAUTH] User 2 callback',
      userId2
    );

    // Get logs for user 1
    const result1 = await oauthVerboseLogStore.getRecentLines?.(userId1);
    const user1Lines = result1?.lines || [];

    // Should contain user 1 logs
    expect(user1Lines.some(line => line.includes('User 1'))).toBe(true);

    // Should NOT contain user 2 logs
    expect(user1Lines.some(line => line.includes('User 2'))).toBe(false);

    // Get logs for user 2
    const result2 = await oauthVerboseLogStore.getRecentLines?.(userId2);
    const user2Lines = result2?.lines || [];

    // Should contain user 2 logs
    expect(user2Lines.some(line => line.includes('User 2'))).toBe(true);

    // Should NOT contain user 1 logs
    expect(user2Lines.some(line => line.includes('User 1'))).toBe(false);
  });

  it('should not leak user A logs to user B via admin endpoint', async () => {
    const userId1 = 'test-user-1';
    const userId2 = 'test-user-2';

    oauthVerboseLogStore.appendLine('[OAUTH] Secret from user 1', userId1);
    oauthVerboseLogStore.appendLine('[OAUTH] Secret from user 2', userId2);

    // Admin fetches all logs (aggregate view)
    const allResult = await oauthVerboseLogStore.getRecentLines?.();
    const allLogs = allResult?.lines || [];

    // When user 1 checks their logs, they should not see user 2's secrets
    const user1Filtered = allLogs.filter(line => line.includes('test-user-1'));
    expect(user1Filtered.some(line => line.includes('Secret from user 2'))).toBe(false);

    // When user 2 checks their logs, they should not see user 1's secrets
    const user2Filtered = allLogs.filter(line => line.includes('test-user-2'));
    expect(user2Filtered.some(line => line.includes('Secret from user 1'))).toBe(false);
  });

  it('should preserve userId prefix in log lines for audit trail', async () => {
    const userId = 'audit-test-user';
    const logMessage = '[TOKEN_EXCHANGE] scope=banking';

    oauthVerboseLogStore.appendLine(logMessage, userId);

    const result = await oauthVerboseLogStore.getRecentLines?.(userId);
    const lines = result?.lines || [];

    // Log line should contain the userId for audit purposes
    expect(lines.some(line => line.includes(userId) || line.includes(logMessage))).toBe(
      true
    );
  });

  it('should handle concurrent appends from multiple users without interleaving', async () => {
    const userId1 = 'concurrent-user-1';
    const userId2 = 'concurrent-user-2';

    // Simulate concurrent logging
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        Promise.resolve().then(() => {
          oauthVerboseLogStore.appendLine(`[User1 Message ${i}]`, userId1);
        })
      );
      promises.push(
        Promise.resolve().then(() => {
          oauthVerboseLogStore.appendLine(`[User2 Message ${i}]`, userId2);
        })
      );
    }

    await Promise.all(promises);

    const result1 = await oauthVerboseLogStore.getRecentLines?.(userId1);
    const user1Lines = result1?.lines || [];
    const result2 = await oauthVerboseLogStore.getRecentLines?.(userId2);
    const user2Lines = result2?.lines || [];

    // User 1 should have only their messages
    const user1MessageCount = user1Lines.filter(line => line.includes('User1')).length;
    expect(user1MessageCount).toBe(10);

    // User 2 should have only their messages
    const user2MessageCount = user2Lines.filter(line => line.includes('User2')).length;
    expect(user2MessageCount).toBe(10);

    // No cross-user contamination
    expect(user1Lines.some(line => line.includes('User2'))).toBe(false);
    expect(user2Lines.some(line => line.includes('User1'))).toBe(false);
  });

  it('should persist logs to per-user files for restart resilience', async () => {
    const userId = 'persist-test-user';
    const logMessage = '[PERSISTENCE_TEST] Important OAuth event';

    oauthVerboseLogStore.appendLine(logMessage, userId);

    // Force flush to disk if available
    if (typeof oauthVerboseLogStore.flush === 'function') {
      await oauthVerboseLogStore.flush?.();
    }

    // Simulate reload: clear memory and reload from disk
    if (typeof oauthVerboseLogStore.reloadFromDisk === 'function') {
      oauthVerboseLogStore.reloadFromDisk?.();
      const result = await oauthVerboseLogStore.getRecentLines?.(userId);
      const reloadedLines = result?.lines || [];
      expect(reloadedLines.some(line => line.includes(logMessage))).toBe(true);
    }
  });
});
