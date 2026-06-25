'use strict';
const er = require('../../services/envReconcile');

describe('envReconcile.isEnvScoped', () => {
  test('credential/resource keys are env-scoped', () => {
    expect(er.isEnvScoped('pingone_mcp_token_exchanger_client_id')).toBe(true);
    expect(er.isEnvScoped('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID')).toBe(true); // case-insensitive
    expect(er.isEnvScoped('pingone_ai_agent_client_secret')).toBe(true);        // vault-only key
    expect(er.isEnvScoped('pingone_environment_id')).toBe(true);
    expect(er.isEnvScoped('pingone_resource_mcp_server_uri')).toBe(true);
  });
  test('flags/thresholds/deployment keys are NOT env-scoped', () => {
    expect(er.isEnvScoped('ff_hitl_enabled')).toBe(false);
    expect(er.isEnvScoped('confirm_threshold_usd')).toBe(false);
    expect(er.isEnvScoped('session_secret')).toBe(false);
    expect(er.isEnvScoped('mcp_server_url')).toBe(false);
    expect(er.isEnvScoped('helix_agent_id')).toBe(false); // Helix is a separate environment
  });
  test('unknown key defaults to NOT env-scoped (never purge what we do not understand)', () => {
    expect(er.isEnvScoped('totally_unknown_key')).toBe(false);
  });
});

describe('envReconcile.computeVerdict', () => {
  const C = er.computeVerdict;
  test('matching stamp -> noop', () => {
    expect(C({ currentEnvId: 'envA', stampEnvId: 'envA', hasEnvScopedRows: true })).toBe('noop');
  });
  test('differing stamp -> reconcile', () => {
    expect(C({ currentEnvId: 'envB', stampEnvId: 'envA', hasEnvScopedRows: true })).toBe('reconcile');
  });
  test('absent stamp + env-scoped rows present -> reconcile (legacy drift)', () => {
    expect(C({ currentEnvId: 'envA', stampEnvId: null, hasEnvScopedRows: true })).toBe('reconcile');
  });
  test('absent stamp + no env-scoped rows -> stamp-only', () => {
    expect(C({ currentEnvId: 'envA', stampEnvId: null, hasEnvScopedRows: false })).toBe('stamp-only');
  });
  test('empty current env id -> skip-warn (never purge blindly)', () => {
    expect(C({ currentEnvId: '', stampEnvId: 'envA', hasEnvScopedRows: true })).toBe('skip-warn');
  });
});

const { FIELD_DEFS } = require('../../services/configStore');

// Vault secret names that may exist at rest (lowercased). Add a line when a new
// vault secret is introduced — the guard forces it to be classified.
const KNOWN_VAULT_KEYS = [
  'pingone_ai_agent_client_secret',
];

describe('classification completeness', () => {
  test('scoped and agnostic sets are disjoint', () => {
    const overlap = [...require('../../services/envReconcile').ENV_SCOPED_KEYS]
      .filter((k) => require('../../services/envReconcile').ENV_AGNOSTIC_KEYS.has(k));
    expect(overlap).toEqual([]);
  });

  test('every FIELD_DEFS + vault key is classified (or explicitly ignored)', () => {
    const er = require('../../services/envReconcile');
    const classified = (k) =>
      er.ENV_SCOPED_KEYS.has(k) || er.ENV_AGNOSTIC_KEYS.has(k) ||
      er.IGNORED_KEYS.has(k) || k.startsWith('ff_'); // all feature flags are agnostic by prefix
    const keys = [
      ...Object.keys(FIELD_DEFS).map((k) => er.normalizeKey(k)),
      ...KNOWN_VAULT_KEYS.map((k) => er.normalizeKey(k)),
    ];
    const unclassified = [...new Set(keys)].filter((k) => !classified(k));
    expect(unclassified).toEqual([]); // add each to ENV_SCOPED_KEYS or ENV_AGNOSTIC_KEYS per the rule
  });
});

describe('buildRecord / emitRecord', () => {
  test('buildRecord shape carries names only, never values', () => {
    const er = require('../../services/envReconcile');
    const rec = er.buildRecord({
      verdict: 'reconcile', fromEnvId: 'old', toEnvId: 'new',
      purgedKeys: ['pingone_mcp_token_exchanger_client_id'], vaultDropped: ['pingone_ai_agent_client_secret'],
      now: '2026-06-19T00:00:00.000Z',
    });
    expect(rec).toEqual({
      verdict: 'reconcile', fromEnvId: 'old', toEnvId: 'new',
      purgedKeys: ['pingone_mcp_token_exchanger_client_id'],
      vaultDropped: ['pingone_ai_agent_client_secret'], at: '2026-06-19T00:00:00.000Z',
    });
  });

  test('emitRecord logs a durable appEvent on reconcile', () => {
    jest.resetModules();
    const logEvent = jest.fn();
    jest.doMock('../../services/appEventService', () => ({ logEvent }));
    const er = require('../../services/envReconcile');
    er.emitRecord(er.buildRecord({
      verdict: 'reconcile', fromEnvId: 'old', toEnvId: 'new',
      purgedKeys: ['k1'], vaultDropped: [], now: '2026-06-19T00:00:00.000Z',
    }));
    expect(logEvent).toHaveBeenCalledWith('config', 'warn', expect.stringContaining('env-id change'),
      expect.objectContaining({ metadata: expect.objectContaining({ verdict: 'reconcile' }) }));
    jest.dontMock('../../services/appEventService');
  });
});
