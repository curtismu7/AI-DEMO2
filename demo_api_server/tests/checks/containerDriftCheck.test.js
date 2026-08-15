'use strict';
// containers.drift was a BLOCKING warn that the normal ./run-docker.sh
// deployment could never satisfy: the BFF runs inside ai-demo-api-server with
// no docker socket, so `docker ps` cannot work there and the card read
// "docker is not reachable from here" on every run. A red that can never go
// green teaches presenters to ignore the whole page.
//
// These tests pin both halves: not-applicable when it genuinely cannot look,
// and a real fail when it can look and finds drift.

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return { ...real, existsSync: jest.fn(), readFileSync: jest.fn() };
});
jest.mock('child_process', () => ({
  execFile: jest.fn(),
  execFileSync: jest.fn(() => { throw new Error('git unavailable'); }),
}));

const fs = require('fs');
const { execFile } = require('child_process');
const {
  containerDrift,
  dockerIsUnreachableFromContainer,
} = require('../../services/checks/containerDriftCheck');

/** Reply to `docker ...` invocations from a name -> {err, out} table. */
function mockDocker(handler) {
  execFile.mockImplementation((cmd, args, _opts, cb) => {
    const { err = null, out = '' } = handler(cmd, args) || {};
    cb(err, out);
  });
}

/** Only these paths exist. */
function onlyPathsExist(paths) {
  const set = new Set(paths);
  fs.existsSync.mockImplementation((p) => set.has(String(p)));
}

describe('containers.drift when docker cannot be reached', () => {
  beforeEach(() => jest.clearAllMocks());

  test('dockerIsUnreachableFromContainer: in a container with no socket', () => {
    onlyPathsExist(['/.dockerenv']);
    expect(dockerIsUnreachableFromContainer()).toBe(true);
  });

  test('dockerIsUnreachableFromContainer: false when the socket is mounted', () => {
    onlyPathsExist(['/.dockerenv', '/var/run/docker.sock']);
    expect(dockerIsUnreachableFromContainer()).toBe(false);
  });

  test('dockerIsUnreachableFromContainer: false on the host', () => {
    onlyPathsExist([]);
    expect(dockerIsUnreachableFromContainer()).toBe(false);
  });

  test('in-container + no socket reports skip, NOT a blocking warn', async () => {
    onlyPathsExist(['/.dockerenv']);
    mockDocker(() => ({ err: new Error('docker: not found') }));

    const r = await containerDrift.run();
    expect(r.status).toBe('skip');
    expect(r.detail).toMatch(/not applicable/i);
    expect(r.meta.reason).toBe('no_docker_socket_in_container');
  });

  test('host with a broken docker still warns (unchanged)', async () => {
    onlyPathsExist([]);
    mockDocker(() => ({ err: new Error('Cannot connect to the Docker daemon') }));

    const r = await containerDrift.run();
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/docker is not reachable/);
  });
});

describe('containers.drift when docker IS reachable', () => {
  beforeEach(() => jest.clearAllMocks());

  test('still fails on real drift', async () => {
    onlyPathsExist([]);
    // Repo copy has the needle; the container copy does not.
    fs.readFileSync.mockReturnValue('function a2aDelegatedScope() {}');
    mockDocker((_cmd, args) => {
      if (args[0] === 'ps') return { out: 'ai-demo-authz-server\n' };
      const script = args[args.length - 1];
      if (script.startsWith('[ -f')) return { out: 'yes' };
      return { out: '0' }; // grep -c found nothing -> stale
    });

    const r = await containerDrift.run();
    expect(r.status).toBe('fail');
    expect(r.meta.stale).toContain('ai-demo-authz-server');
  });

  test('passes when the container carries the needle', async () => {
    onlyPathsExist([]);
    fs.readFileSync.mockReturnValue('function a2aDelegatedScope() {}');
    mockDocker((_cmd, args) => {
      if (args[0] === 'ps') return { out: 'ai-demo-authz-server\n' };
      const script = args[args.length - 1];
      if (script.startsWith('[ -f')) return { out: 'yes' };
      return { out: '1' };
    });

    const r = await containerDrift.run();
    expect(r.status).toBe('pass');
    expect(r.meta.checked).toBe(1);
  });

  test('no watched container running reports skip, not a green that proved nothing', async () => {
    onlyPathsExist([]);
    fs.readFileSync.mockReturnValue('function a2aDelegatedScope() {}');
    mockDocker((_cmd, args) => (args[0] === 'ps' ? { out: 'some-unrelated-container\n' } : { out: '' }));

    const r = await containerDrift.run();
    expect(r.status).toBe('skip');
    expect(r.meta.checked).toBe(0);
  });
});
