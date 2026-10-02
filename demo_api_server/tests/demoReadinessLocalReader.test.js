'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { effectiveConfigValues, missingCaseConfiguration, toolScopeParity } = require('../services/demoReadinessLocalReader');
const { PAR_CONFIG_KEYS, checkA2aCredentials } = require('../services/demoStepPrerequisites');
const { createAuditService } = require('../services/demoReadinessAuditService');

// A config store that holds every key, except the ones named.
const storeWithout = (...absent) => ({ getEffective: (key) => (absent.includes(key) ? undefined : 'true') });
// The first vertical that has an A2A specialist, and the keys it needs.
const A2A = ['banking', 'healthcare', 'retail', 'airlines', 'investment']
  .map((vertical) => ({ vertical, ...checkA2aCredentials(vertical, storeWithout()) }))
  .find((entry) => entry.required);

describe('demoReadinessLocalReader', () => {
  describe('effective configuration', () => {
    it('is blocked, never guessed, outside the BFF process', () => {
      const values = effectiveConfigValues(undefined);
      for (const name of ['requiredFlag', 'a2aCredential', 'parSetting']) {
        expect(values[name]).toMatchObject({ status: 'blocked', reason: expect.stringContaining('only inside the BFF process') });
      }
    });

    it('passes when every required flag resolves and the credentials and PAR settings are present', () => {
      const values = effectiveConfigValues(storeWithout());
      expect(values.requiredFlag).toMatchObject({ status: 'pass', observed: { unresolved: [], off: [] } });
      expect(values.requiredFlag.observed.required.length).toBeGreaterThan(0);
      expect(values.a2aCredential).toEqual({ status: 'pass', observed: { missing: [] } });
      expect(values.parSetting).toEqual({ status: 'pass', observed: { missing: [] } });
    });

    it('treats a flag that is off as fine, and one the store cannot resolve as a failure', () => {
      const off = effectiveConfigValues({ getEffective: () => 'false' });
      expect(off.requiredFlag.status).toBe('pass');
      expect(off.requiredFlag.observed.off).toEqual(off.requiredFlag.observed.required);

      const flag = off.requiredFlag.observed.required[0];
      expect(effectiveConfigValues(storeWithout(flag)).requiredFlag).toMatchObject({ status: 'fail', observed: { unresolved: [flag] } });
    });

    it('fails PAR and A2A on a missing setting and names the setting, not a value', () => {
      const par = effectiveConfigValues(storeWithout(PAR_CONFIG_KEYS[0])).parSetting;
      expect(par).toEqual({ status: 'fail', observed: { missing: [PAR_CONFIG_KEYS[0]] } });

      const a2a = effectiveConfigValues(storeWithout(A2A.clientSecretKey)).a2aCredential;
      expect(a2a.status).toBe('fail');
      expect(a2a.observed.missing.join('\n')).toContain(A2A.clientSecretKey);
      expect(JSON.stringify([par, a2a])).not.toContain('"true"');
    });

    it('reports a step\'s missing configuration only for what that step needs', () => {
      const store = storeWithout(PAR_CONFIG_KEYS[1], A2A.clientIdKey);
      expect(missingCaseConfiguration({ par: true, verticals: [A2A.vertical] }, store)).toEqual([PAR_CONFIG_KEYS[1]]);
      expect(missingCaseConfiguration({ a2a: true, verticals: [A2A.vertical] }, store)).toEqual([expect.stringContaining(A2A.clientIdKey)]);
      expect(missingCaseConfiguration({ verticals: [A2A.vertical] }, store)).toEqual([]);
    });
  });

  describe('tool scope parity', () => {
    const repository = (declared, mounted) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-tools-'));
      fs.mkdirSync(path.join(root, 'ping-gateway/config'), { recursive: true });
      fs.writeFileSync(path.join(root, 'scope-topology.json'), JSON.stringify({ tools: declared }));
      fs.writeFileSync(path.join(root, 'ping-gateway/config/scope-topology.json'), JSON.stringify({ tools: mounted }));
      return root;
    };
    const tool = (...requiredScopes) => ({ requiredScopes });

    it('passes when the mounted copy carries the same scopes, in any order', () => {
      expect(toolScopeParity(repository({ a: tool('read', 'write') }, { a: tool('write', 'read') })))
        .toEqual({ status: 'pass', observed: { tools: 1, differing: [], unknownToRoot: [] } });
    });

    it('fails on a tool missing from the mounted copy, a scope difference, or a tool the root does not declare', () => {
      const result = toolScopeParity(repository(
        { missing: tool('read'), changed: tool('read'), unscoped: tool(), same: tool('read') },
        { changed: tool('write'), same: tool('read'), stray: tool('read') },
      ));
      expect(result).toEqual({ status: 'fail', observed: { tools: 4, differing: ['missing', 'changed', 'unscoped'], unknownToRoot: ['stray'] } });
    });

    // Not asserting pass/fail: whether the two checked-in files agree is the
    // audit's finding to report, not this suite's.
    it('reads both checked-in topology files', () => {
      const result = toolScopeParity();
      expect(['pass', 'fail']).toContain(result.status);
      expect(result.observed.tools).toBeGreaterThan(100);
    });
  });

  describe('Demo Step rows that need A2A credentials or PAR settings', () => {
    const caseRows = async (configStore) => Object.fromEntries((await createAuditService({ adapters: { configStore } })
      .auditRepositoryContracts({})).filter((row) => /^repository:case:(UC14|UC2\.5)$/.test(row.id)).map((row) => [row.id, row]));

    it('are blocked outside the BFF process', async () => {
      const rows = await caseRows(undefined);
      expect(rows['repository:case:UC14']).toMatchObject({ status: 'blocked', evidence: expect.stringContaining('PAR application configuration is readable only inside the BFF process') });
      expect(rows['repository:case:UC2.5']).toMatchObject({ status: 'blocked', evidence: expect.stringContaining('A2A credential configuration') });
    });

    it('pass with the configuration present and fail, naming the setting, without it', async () => {
      const present = await caseRows(storeWithout());
      expect(present['repository:case:UC14'].status).toBe('pass');
      expect(present['repository:case:UC2.5'].status).toBe('pass');

      const absent = await caseRows(storeWithout(PAR_CONFIG_KEYS[0], A2A.clientIdKey));
      expect(absent['repository:case:UC14']).toMatchObject({ status: 'fail', observed: { missingConfiguration: [PAR_CONFIG_KEYS[0]] } });
      expect(absent['repository:case:UC2.5'].status).toBe('fail');
    });
  });
});
