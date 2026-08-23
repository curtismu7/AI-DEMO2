/**
 * @file auditLogService.pruning.test.js
 * @description Regression (finding #35): pruneOldLogs(retentionDays) enforced
 * the 90-day retention policy but had zero callers anywhere in the codebase
 * -- no cron/interval, no route wired to it -- so the in-memory auditLogs
 * object grew without bound. Fixed by calling it on a periodic unref'd
 * setInterval at module load.
 */
'use strict';

describe('auditLogService periodic pruning', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('automatically prunes events older than the retention window via its own interval, with no manual pruneOldLogs call', async () => {
    const auditLogService = require('../../services/auditLogService');

    await auditLogService.recordKillFailure('agent-1', 'test-reason', 'boom');
    let trail = await auditLogService.getAuditTrail('agent-1', 24 * 365 * 100, 1000);
    expect(trail).toHaveLength(1);

    // Advance well past the 90-day retention window. The module's own
    // setInterval (not a manual pruneOldLogs() call) must fire during this.
    jest.advanceTimersByTime(91 * 24 * 60 * 60 * 1000);

    trail = await auditLogService.getAuditTrail('agent-1', 24 * 365 * 100, 1000);
    expect(trail).toHaveLength(0);
  });
});
