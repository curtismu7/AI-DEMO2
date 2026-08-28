'use strict';

/**
 * Guards that ff_authorize_fail_open announces itself at boot.
 *
 * The flag is checked FIRST in every branch of resolveAuthorizeMode, so it forces
 * failover_mode=permit even for a deployment that explicitly stored the strict
 * authorize_mode='pingone'. Without this warning the only evidence is the
 * per-request fail-open log, which appears once PingOne is ALREADY failing — by
 * which point the gate has already been skipped.
 */

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/simulatedAuthorizeService', () => ({
  resolveAuthorizeMode: jest.fn(() => ({ mode: 'pingone', useSimulated: false, failoverMode: 'permit' })),
}));

describe('startupConfigGuard — ff_authorize_fail_open is loud at boot', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  it('warns, and names the authorize_mode being overridden, when the flag is on', () => {
    require('../../services/configStore').getEffective.mockImplementation(
      (key) => (key === 'ff_authorize_fail_open' ? 'true' : null),
    );

    require('../../services/startupConfigGuard').warnIfAuthorizeFailOpen();

    const output = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('ff_authorize_fail_open=true');
    expect(output).toContain('FAILS OPEN');
    // The point of the warning is that it overrides a mode the operator chose.
    expect(output).toContain("authorize_mode='pingone'");
  });

  it('stays silent when the flag is off — the fail-closed default', () => {
    require('../../services/startupConfigGuard').warnIfAuthorizeFailOpen();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
