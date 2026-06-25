/**
 * Phase 2 persistence: demo scenario state and the security-monitoring
 * dashboard snapshot survive a restart. LMDB_PATH points at a throwaway dir
 * (setup.js); "restart" is simulated with jest.resetModules() — same LMDB file,
 * fresh in-memory state.
 */
'use strict';

describe('demoScenarioStore — LMDB persistence', () => {
  afterEach(() => {
    require('../../services/lmdb/demoScenarioStore.lmdb').clearAll();
    jest.resetModules();
  });

  test('isPersistenceConfigured() is now true', () => {
    expect(require('../../services/demoScenarioStore').isPersistenceConfigured()).toBe(true);
  });

  test('a saved scenario is restored after a simulated restart', async () => {
    const store = require('../../services/demoScenarioStore');
    await store.save('user-42', { stepUpAmountThreshold: 750, bankingAgentUiMode: 'advanced' });

    jest.resetModules();
    const rebooted = require('../../services/demoScenarioStore');
    const loaded = await rebooted.load('user-42');

    expect(loaded.stepUpAmountThreshold).toBe(750);
    expect(loaded.bankingAgentUiMode).toBe('advanced');
  });

  test('getStepUpThreshold reflects the persisted value after restart', async () => {
    const store = require('../../services/demoScenarioStore');
    await store.save('user-77', { stepUpAmountThreshold: 1200 });

    jest.resetModules();
    const rebooted = require('../../services/demoScenarioStore');
    expect(await rebooted.getStepUpThreshold('user-77', 500)).toBe(1200);
  });
});

describe('securityMonitoringService — LMDB snapshot/hydrate', () => {
  afterEach(() => {
    require('../../services/lmdb/securityMonitoringStore.lmdb').clearAll();
    jest.resetModules();
  });

  test('an active alert is restored after a simulated restart', () => {
    const svc = require('../../services/securityMonitoringService');
    const alert = svc.generateSecurityAlert('rapid_token_requests', 'critical', { client_id: 'c-1' });
    expect(svc.snapshot(true)).toBe(true); // force flush to LMDB

    jest.resetModules();
    const rebooted = require('../../services/securityMonitoringService');
    rebooted.hydrate();

    const dash = rebooted.getSecurityDashboard();
    const ids = dash.alerts.active.map(a => a.alert_id);
    expect(ids).toContain(alert.alert_id);
  });

  test('client behavior Sets round-trip through the snapshot (not lost as {})', () => {
    const svc = require('../../services/securityMonitoringService');
    // monitorTokenUsage → trackClientBehavior populates ip_addresses/scopes_used Sets.
    svc.monitorTokenUsage(
      { jti: 'tok-1', client_id: 'c-set', scope: 'read write' },
      {},
      { sourceIP: '10.0.0.9', scopes: ['read', 'write'] },
    );
    svc.snapshot(true);

    jest.resetModules();
    const rebooted = require('../../services/securityMonitoringService');
    rebooted.hydrate();

    const report = rebooted.getClientSecurityReport('c-set');
    expect(report.behavior_summary.unique_ips).toBe(1);
    expect(report.behavior_summary.scopes_used).toEqual(expect.arrayContaining(['read', 'write']));
  });

  test('snapshot() is a no-op when nothing changed since the last flush', () => {
    const svc = require('../../services/securityMonitoringService');
    svc.generateSecurityAlert('x', 'info', {});
    expect(svc.snapshot()).toBe(true);   // dirty → writes
    expect(svc.snapshot()).toBe(false);  // clean → skipped
  });
});
