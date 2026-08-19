/**
 * Admin Audit Service Tests
 *
 * Regression test for a function-signature mismatch bug: each logAdmin* function
 * called writeExchangeEvent('type-string', auditEvent) — two args — but
 * writeExchangeEvent(event) only accepts one. The leading string became `event`
 * inside writeExchangeEvent, and `{...event}` spread on a string produced
 * numeric-keyed character garbage instead of the real audit event, silently
 * dropping every field (adminSub, targetUserSub, action, result, etc.).
 *
 * These tests use the REAL exchangeAuditStore (not mocked) so we can assert
 * the actual object that lands in the ring buffer.
 */

const {
  logAdminTokenExchange,
  logAdminUserManagement,
  logAdminSystemAdmin,
  logAdminDataAccess,
  logAdminSecurityAction,
  ADMIN_ACTION_TYPES,
  getAdminAuditTrail,
  generateAdminActivityReport,
  validateAdminActionPermissions
} = require('../../services/adminAuditService');
const { readExchangeEvents } = require('../../services/exchangeAuditStore');

function mockReq() {
  return {
    id: 'req-1',
    get: () => 'test-agent',
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    sessionID: 'sess-1'
  };
}

describe('adminAuditService -> exchangeAuditStore integration', () => {
  test('logAdminUserManagement writes a real object (not spread-string garbage) to the audit store', async () => {
    const req = mockReq();
    logAdminUserManagement(
      {
        adminSub: 'admin-123',
        targetUserSub: 'user-456',
        action: 'delete',
        resource: 'user',
        result: 'success',
        details: { confirm: true }
      },
      req
    );

    const events = await readExchangeEvents();
    const written = events[0];

    // Must NOT be spread-string garbage (numeric keys '0','1','2'... from a string)
    expect(written).not.toHaveProperty('0');

    // Must contain the real audit fields
    expect(written.type).toBe(ADMIN_ACTION_TYPES.USER_MANAGEMENT);
    expect(written.adminSub).toBe('admin-123');
    expect(written.targetUserSub).toBe('user-456');
    expect(written.action).toBe('delete');
    expect(written.resource).toBe('user');
    expect(written.result).toBe('success');
    expect(written.sessionId).toBe('sess-1');
  });

  test.each([
    ['logAdminTokenExchange', logAdminTokenExchange, ADMIN_ACTION_TYPES.TOKEN_EXCHANGE],
    ['logAdminSystemAdmin', logAdminSystemAdmin, ADMIN_ACTION_TYPES.SYSTEM_ADMIN],
    ['logAdminDataAccess', logAdminDataAccess, ADMIN_ACTION_TYPES.DATA_ACCESS],
    ['logAdminSecurityAction', logAdminSecurityAction, ADMIN_ACTION_TYPES.SECURITY_ACTION]
  ])('%s writes the real event with correct type into the audit store', async (_name, fn, expectedType) => {
    const req = mockReq();
    fn({ adminSub: 'admin-xyz', action: 'noop', result: 'success' }, req);

    const events = await readExchangeEvents();
    const written = events[0];

    expect(written).not.toHaveProperty('0');
    expect(written.type).toBe(expectedType);
    expect(written.adminSub).toBe('admin-xyz');
  });

  test('queries an admin trail with filters and limit', async () => {
    const events = await getAdminAuditTrail('admin-123', {
      actionTypes: ADMIN_ACTION_TYPES.USER_MANAGEMENT,
      limit: 1
    });

    expect(events).toHaveLength(1);
    expect(events[0].adminSub).toBe('admin-123');
    expect(events[0].type).toBe(ADMIN_ACTION_TYPES.USER_MANAGEMENT);
  });

  test('generates activity counts and security events', async () => {
    const report = await generateAdminActivityReport({ adminSubs: ['admin-123'] });

    expect(report.totalActions).toBe(1);
    expect(report.actionsByType[ADMIN_ACTION_TYPES.USER_MANAGEMENT]).toBe(1);
    expect(report.actionsByAdmin['admin-123']).toBe(1);
    expect(report.topActions).toEqual([{ action: 'delete', count: 1 }]);
  });

  test('evaluates required scopes without treating an admin subject as authorization', () => {
    expect(validateAdminActionPermissions('admin-123', 'delete', 'user')).toMatchObject({
      allowed: false,
      requiredScopes: ['admin:delete', 'users:manage']
    });
    expect(validateAdminActionPermissions('admin-123', 'delete', 'user', [
      'admin:delete',
      'users:manage'
    ]).allowed).toBe(true);
  });
});
