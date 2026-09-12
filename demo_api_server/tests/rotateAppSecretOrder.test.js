'use strict';

// Orchestration contract for the rotation CLI driver: nothing irreversible runs
// before preflight passes, every step fires in spec order on success, and a
// propagation failure is logged-and-continued rather than aborting the run
// (design spec, "Failure modes": propagation is non-fatal).

const order = [];

jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(() => {
    order.push('execFileSync');
    return JSON.stringify({
      id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
    });
  }),
}));
jest.mock('../../scripts/rotate-app-secret', () => ({
  preflight: jest.fn(async () => { order.push('preflight'); }),
}));
jest.mock('../../demo_api_server/services/pingOneSecretRotation', () => ({
  regenerateClientSecret: jest.fn(async () => { order.push('rotate'); return 'new-secret-value'; }),
  verifySecret: jest.fn(async () => { order.push('verify'); return { ok: true, code: 'token_issued' }; }),
  fingerprint: jest.fn(() => 'deadbeef'),
  isWorkerApp: jest.fn(() => false),
}));
jest.mock('../../demo_api_server/scripts/refresh-service-envs', () => ({
  propagateServiceEnvs: jest.fn(async () => { order.push('propagate'); }),
}));
jest.mock('../../scripts/lib/rotationTargets', () => ({
  servicesForVaultKey: jest.fn(() => ['mcp-gateway', 'demo-api-server']),
  applyRestart: jest.fn(() => { order.push('restart'); }),
  applyK8sPatch: jest.fn(() => { order.push('k8s'); }),
}));

const { execFileSync } = require('node:child_process');
const { preflight } = require('../../scripts/rotate-app-secret');
const rotation = require('../../demo_api_server/services/pingOneSecretRotation');
const { propagateServiceEnvs } = require('../../demo_api_server/scripts/refresh-service-envs');
const { applyRestart } = require('../../scripts/lib/rotationTargets');
const { main } = require('../../scripts/lib/rotateAppSecretCli');

const ARGV = ['--app-id', 'a1', '--vault-key', 'PINGONE_MCP_GATEWAY_CLIENT_SECRET'];

let written;
beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  written = [];
  jest.spyOn(process.stdout, 'write').mockImplementation((s) => { written.push(s); return true; });
  // clearMocks wipes call history, never a mockImplementation set with
  // mockImplementationOnce/mockRejectedValue in a prior test — re-arm the ones
  // individual tests override.
  preflight.mockImplementation(async () => { order.push('preflight'); });
  rotation.regenerateClientSecret.mockImplementation(async () => { order.push('rotate'); return 'new-secret-value'; });
  rotation.verifySecret.mockImplementation(async () => { order.push('verify'); return { ok: true, code: 'token_issued' }; });
  propagateServiceEnvs.mockImplementation(async () => { order.push('propagate'); });
});
afterEach(() => jest.restoreAllMocks());

const logText = () => written.join('');

describe('rotateAppSecretCli orchestration', () => {
  test('a successful run fires every step in spec order', async () => {
    await main(ARGV);
    expect(order).toEqual([
      'execFileSync',  // describeApp
      'preflight',
      'rotate',
      'execFileSync',  // vault set, value on stdin
      'propagate',
      'verify',
    ]);
  });

  // vault.js computes its OWN vault path (path.resolve(__dirname, '..', '..') +
  // '/secrets.vault'). Now that VAULT_CLI resolves under DEMO_API_SERVER_ROOT,
  // that default is '/secrets.vault' in-container — the :ro bind. preflight
  // proves a DIFFERENT file opens, so the mismatch would surface only at
  // save(), after the irreversible rotate. The two halves must agree by
  // construction, not by each deriving the path again.
  test('the vault write targets exactly the path preflight validated', async () => {
    await main(ARGV);
    const validated = preflight.mock.calls[0][0].vaultPath;
    expect(validated).toBeTruthy();
    const setCall = execFileSync.mock.calls.find(([, args]) => args[1] === 'set');
    expect(setCall[2].env.VAULT_PATH).toBe(validated);
  });

  test('preflight rejection means nothing irreversible ever runs', async () => {
    preflight.mockRejectedValue(new Error('Refusing to rotate "Worker": it is the configured worker app.'));
    const err = await main(ARGV).catch((e) => e);
    expect(err.aborted).toBe(true);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
    expect(propagateServiceEnvs).not.toHaveBeenCalled();
  });

  test('missing arguments abort before anything is touched', async () => {
    const err = await main(['--app-id', 'a1']).catch((e) => e);
    expect(err.aborted).toBe(true);
    expect(err.message).toMatch(/usage:/);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });

  // C3: propagateServiceEnvs used to be able to process.exit() here, and even a
  // thrown error would have escaped uncaught — killing verify, the restart
  // guidance and the DONE line after an irreversible rotate.
  test('a propagation SKIP is logged and the run continues to verify', async () => {
    const skip = new Error('[refresh-envs] demo_api_server/.env not found — bootstrap not yet run, skipping.');
    skip.skipped = true;
    propagateServiceEnvs.mockRejectedValue(skip);

    await expect(main(ARGV)).resolves.toBeUndefined();
    expect(rotation.verifySecret).toHaveBeenCalled();
    expect(logText()).toMatch(/PROPAGATION INCOMPLETE/);
  });

  test('a propagation HARD FAILURE is logged and the run continues to verify', async () => {
    propagateServiceEnvs.mockRejectedValue(new Error('disk on fire'));

    await expect(main(ARGV)).resolves.toBeUndefined();
    expect(rotation.verifySecret).toHaveBeenCalled();
    expect(logText()).toMatch(/PROPAGATION INCOMPLETE/);
  });

  test('a verify failure is reported as a post-rotate failure, not an abort', async () => {
    rotation.verifySecret.mockResolvedValue({ ok: false, code: 'invalid_client' });
    const err = await main(ARGV).catch((e) => e);
    expect(err.message).toMatch(/verify failed \(invalid_client\)/);
    expect(err.aborted).toBeUndefined();
  });

  // I1: --restart cannot work from the BFF container (no docker CLI), so the
  // log must always name the host command that finishes the job.
  test('without --restart, the log still names the exact host command', async () => {
    await main(ARGV);
    expect(logText()).toContain('./run-docker.sh restart mcp-gateway demo-api-server');
    expect(applyRestart).not.toHaveBeenCalled();
  });

  test('the host command is the LAST line, immediately before the DONE sentinel', async () => {
    await main(ARGV);
    const lines = logText().trim().split('\n');
    expect(lines[lines.length - 1]).toContain('./run-docker.sh restart');
  });

  test('the guidance is printed even when the run fails after the rotate', async () => {
    rotation.verifySecret.mockResolvedValue({ ok: false, code: 'invalid_client' });
    await main(ARGV).catch(() => {});
    expect(logText()).toContain('./run-docker.sh restart mcp-gateway demo-api-server');
  });

  test('an aborted run prints no restart guidance — nothing changed', async () => {
    preflight.mockRejectedValue(new Error('Refusing to rotate "Worker".'));
    await main(ARGV).catch(() => {});
    expect(logText()).not.toContain('./run-docker.sh restart');
  });

  test('the new secret never reaches the log', async () => {
    await main(ARGV);
    expect(logText()).not.toContain('new-secret-value');
  });
});
