'use strict';

// warnIfPrivilegeConfigRegressed catches the stale-.env regression at boot:
// (1) Privilege SSO pointed at the banking env, (2) the dead banking.mcpgw host.
const { warnIfPrivilegeConfigRegressed } = require('../../services/startupConfigGuard');

describe('warnIfPrivilegeConfigRegressed', () => {
  const KEYS = ['PRIVILEGE_MCPGW_URL', 'PRIVILEGE_SSO_ENV_ID', 'PINGONE_ENVIRONMENT_ID'];
  const saved = {};
  let warnSpy;
  beforeEach(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  const warnings = () => warnSpy.mock.calls.map((c) => String(c[0])).join('\n');

  it('warns when PRIVILEGE_SSO_ENV_ID equals the banking env', () => {
    process.env.PRIVILEGE_SSO_ENV_ID = 'bank-env';
    process.env.PINGONE_ENVIRONMENT_ID = 'bank-env';
    warnIfPrivilegeConfigRegressed();
    expect(warnings()).toMatch(/PRIVILEGE_SSO_ENV_ID.*==.*PINGONE_ENVIRONMENT_ID/);
  });

  it('warns on the dead banking.mcpgw gateway host', () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://banking.mcpgw.local.ping-devops.com/mcp';
    warnIfPrivilegeConfigRegressed();
    expect(warnings()).toMatch(/does not resolve.*rewrite map/s);
  });

  it('is silent for a correct config (distinct SSO env + working host)', () => {
    process.env.PRIVILEGE_SSO_ENV_ID = 'priv-tenant';
    process.env.PINGONE_ENVIRONMENT_ID = 'bank-env';
    process.env.PRIVILEGE_MCPGW_URL = 'https://mcp-pingone-admin.mcpgw.local.ping-devops.com/mcp';
    warnIfPrivilegeConfigRegressed();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is silent when no Privilege gateway is configured', () => {
    warnIfPrivilegeConfigRegressed();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
