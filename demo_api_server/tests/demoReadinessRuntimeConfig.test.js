'use strict';

const { loadDemoReadinessRuntimeConfig } = require('../services/demoReadinessRuntimeConfig');

const COMMIT = '9ffc481210b34c19432a6944d16ef5af1f2da2a8';

function completeEnvironment() {
  const env = {};
  for (const [target, host] of [['LOCAL', 'local.ping-devops.com'], ['SE', 'ai-demo.ping-devops.com']]) {
    env[`DEMO_READINESS_${target}_BFF_URL`] = `https://${host}:4000`;
    env[`DEMO_READINESS_${target}_GATEWAY_URL`] = `https://${host}/gateway/health`;
    env[`DEMO_READINESS_${target}_AUTHORIZE_URL`] = `https://${host}/authorize/health`;
    env[`DEMO_READINESS_${target}_EXPECTED_REVISION`] = COMMIT;
    for (const provider of ['PINGONE', 'PINGFEDERATE']) {
      env[`DEMO_READINESS_${target}_${provider}_WORKER_URL`] = `https://${provider.toLowerCase()}.${host}/readiness`;
      env[`DEMO_READINESS_${target}_${provider}_WORKER_TOKEN`] = `worker-token-${target.toLowerCase()}-${provider.toLowerCase()}`;
      env[`DEMO_READINESS_${target}_${provider}_IDENTITY_REF`] = `secret://readiness/${target.toLowerCase()}/${provider.toLowerCase()}`;
    }
  }
  return env;
}

describe('demo readiness production runtime configuration', () => {
  test('accepts complete local and SE target configurations with four distinct provider lanes', () => {
    const result = loadDemoReadinessRuntimeConfig(completeEnvironment());

    expect(result.complete).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.targets.local.workers.pingone).toEqual({
      url: 'https://pingone.local.ping-devops.com/readiness',
      token: 'worker-token-local-pingone',
      identityRef: 'secret://readiness/local/pingone',
    });
    expect(result.targets.se.workers.pingfederate).toEqual({
      url: 'https://pingfederate.ai-demo.ping-devops.com/readiness',
      token: 'worker-token-se-pingfederate',
      identityRef: 'secret://readiness/se/pingfederate',
    });
  });

  test('reports the missing lane setting by name without exposing configured credentials', () => {
    const env = completeEnvironment();
    const sentinel = 'never-serialize-this-worker-token';
    env.DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN = sentinel;
    delete env.DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF;

    const result = loadDemoReadinessRuntimeConfig(env);
    const serializedFindings = JSON.stringify(result.findings);

    expect(result.complete).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      id: 'worker:local:pingone',
      status: 'blocked',
      evidence: expect.stringContaining('DEMO_READINESS_LOCAL_PINGONE_IDENTITY_REF'),
    }));
    expect(serializedFindings).not.toContain(sentinel);
  });

  test('rejects non-HTTPS, credential-bearing, query-bearing, and fragment-bearing URLs', () => {
    const env = completeEnvironment();
    env.DEMO_READINESS_LOCAL_BFF_URL = 'http://local.ping-devops.com:4000';
    env.DEMO_READINESS_SE_GATEWAY_URL = 'https://user:secret@ai-demo.ping-devops.com/gateway';
    env.DEMO_READINESS_LOCAL_PINGONE_WORKER_URL = 'https://worker.example/readiness?token=secret';
    env.DEMO_READINESS_SE_PINGFEDERATE_WORKER_URL = 'https://worker.example/readiness#session';

    const result = loadDemoReadinessRuntimeConfig(env);

    expect(result.complete).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'target:local:bff-url', status: 'blocked' }),
      expect.objectContaining({ id: 'target:se:gateway-url', status: 'blocked' }),
      expect.objectContaining({ id: 'worker:local:pingone', status: 'blocked' }),
      expect.objectContaining({ id: 'worker:se:pingfederate', status: 'blocked' }),
    ]));
    expect(JSON.stringify(result.findings)).not.toContain('secret');
  });

  test('rejects a revision that is not a Git SHA', () => {
    const env = completeEnvironment();
    env.DEMO_READINESS_LOCAL_EXPECTED_REVISION = 'main';

    const result = loadDemoReadinessRuntimeConfig(env);

    expect(result.complete).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      id: 'target:local:expected-revision',
      status: 'blocked',
      evidence: expect.stringContaining('DEMO_READINESS_LOCAL_EXPECTED_REVISION'),
    }));
  });

  test('blocks a lane that reuses another provider lane service credential', () => {
    const env = completeEnvironment();
    const sentinel = 'shared-worker-token-secret';
    env.DEMO_READINESS_SE_PINGFEDERATE_WORKER_TOKEN = sentinel;
    env.DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN = sentinel;

    const result = loadDemoReadinessRuntimeConfig(env);

    expect(result.complete).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      id: 'worker:se:pingfederate',
      status: 'blocked',
      evidence: expect.stringContaining('must be unique per target/provider lane'),
    }));
    expect(JSON.stringify(result.findings)).not.toContain(sentinel);
  });
});
