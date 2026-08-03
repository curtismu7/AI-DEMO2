// demo_api_server/tests/resolveLlmBackend.test.js
//
// Platform-aware LLM_BACKEND resolution guard. Ensures resolve-llm-backend.sh
// picks omlx on Apple Silicon Mac and llamacpp elsewhere, and rejects omlx on Linux.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESOLVER = path.resolve(__dirname, '../../demo_llm_proxy/resolve-llm-backend.sh');

function resolveBackend(env = {}, context = '') {
  const merged = { ...process.env, ...env };
  delete merged.LLM_BACKEND_RESOLVE_WARN;
  if (env.LLM_BACKEND === '') {
    delete merged.LLM_BACKEND;
  }
  const bashScript = [
    `source ${JSON.stringify(RESOLVER)}`,
    `resolve_llm_backend ${context}`.trim(),
    'printf "|%s" "${LLM_BACKEND_RESOLVE_WARN:-}"',
  ].join(' && ');
  const result = spawnSync('bash', ['-c', bashScript], {
    env: merged,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `bash exited ${result.status}`);
  }
  const out = (result.stdout || '').trim();
  const [backend, warn] = out.split('|');
  return { backend, warn: warn || '' };
}

describe('resolve-llm-backend.sh platform detection', () => {
  test('resolver script exists', () => {
    expect(fs.existsSync(RESOLVER)).toBe(true);
  });

  test('defaults to omlx on Apple Silicon Mac when LLM_BACKEND unset', () => {
    const { backend, warn } = resolveBackend({ UNAME_S: 'Darwin', UNAME_M: 'arm64', LLM_BACKEND: '' });
    expect(backend).toBe('omlx');
    expect(warn).toBe('');
  });

  test('defaults to llamacpp on Linux when LLM_BACKEND unset', () => {
    const { backend } = resolveBackend({ UNAME_S: 'Linux', UNAME_M: 'x86_64', LLM_BACKEND: '' });
    expect(backend).toBe('llamacpp');
  });

  test('defaults to llamacpp on AWS Graviton when LLM_BACKEND unset', () => {
    const { backend } = resolveBackend({ UNAME_S: 'Linux', UNAME_M: 'aarch64', LLM_BACKEND: '' });
    expect(backend).toBe('llamacpp');
  });

  test('rejects omlx on Linux with llamacpp fallback', () => {
    const { backend, warn } = resolveBackend({
      UNAME_S: 'Linux',
      UNAME_M: 'x86_64',
      LLM_BACKEND: 'omlx',
    });
    expect(backend).toBe('llamacpp');
    expect(warn).toMatch(/omlx requires macOS Apple Silicon/i);
  });

  test('rejects omlx on Intel Mac with llamacpp fallback', () => {
    const { backend, warn } = resolveBackend({
      UNAME_S: 'Darwin',
      UNAME_M: 'x86_64',
      LLM_BACKEND: 'omlx',
    });
    expect(backend).toBe('llamacpp');
    expect(warn).toMatch(/Apple Silicon/i);
  });

  test('honors explicit llamacpp on Apple Silicon Mac', () => {
    const { backend } = resolveBackend({
      UNAME_S: 'Darwin',
      UNAME_M: 'arm64',
      LLM_BACKEND: 'llamacpp',
    });
    expect(backend).toBe('llamacpp');
  });

  test('honors explicit omlx on Apple Silicon Mac', () => {
    const { backend } = resolveBackend({
      UNAME_S: 'Darwin',
      UNAME_M: 'arm64',
      LLM_BACKEND: 'omlx',
    });
    expect(backend).toBe('omlx');
  });
});

// oMLX serves :8090 on the host — the same port the llm-proxy container binds
// under Compose. Only ./run.sh has no container competing for it, so oMLX is
// native-only and every other launcher resolves to llamacpp.
describe('resolve-llm-backend.sh launcher context', () => {
  const APPLE = { UNAME_S: 'Darwin', UNAME_M: 'arm64' };

  test('native context keeps the Apple Silicon oMLX default', () => {
    const { backend } = resolveBackend({ ...APPLE, LLM_BACKEND: '' }, 'native');
    expect(backend).toBe('omlx');
  });

  test('omitting the context behaves as native', () => {
    const { backend } = resolveBackend({ ...APPLE, LLM_BACKEND: '' });
    expect(backend).toBe('omlx');
  });

  test('docker context uses llamacpp on Apple Silicon', () => {
    const { backend, warn } = resolveBackend({ ...APPLE, LLM_BACKEND: '' }, 'docker');
    expect(backend).toBe('llamacpp');
    expect(warn).toBe('');
  });

  test('cluster context uses llamacpp on Apple Silicon', () => {
    const { backend } = resolveBackend({ ...APPLE, LLM_BACKEND: '' }, 'cluster');
    expect(backend).toBe('llamacpp');
  });

  test('downgrades an explicit omlx in docker context, with a warning', () => {
    const { backend, warn } = resolveBackend({ ...APPLE, LLM_BACKEND: 'omlx' }, 'docker');
    expect(backend).toBe('llamacpp');
    expect(warn).toMatch(/native-only/i);
    expect(warn).toMatch(/docker/i);
  });

  test('downgrades an explicit mlx in cluster context, with a warning', () => {
    const { backend, warn } = resolveBackend({ ...APPLE, LLM_BACKEND: 'mlx' }, 'cluster');
    expect(backend).toBe('llamacpp');
    expect(warn).toMatch(/native-only/i);
  });

  test('explicit mlx still resolves in native context on macOS', () => {
    const { backend, warn } = resolveBackend({ ...APPLE, LLM_BACKEND: 'mlx' }, 'native');
    expect(backend).toBe('mlx');
    expect(warn).toBe('');
  });

  test('explicit llamacpp is unaffected by context', () => {
    expect(resolveBackend({ ...APPLE, LLM_BACKEND: 'llamacpp' }, 'docker').backend).toBe('llamacpp');
    expect(resolveBackend({ ...APPLE, LLM_BACKEND: 'llamacpp' }, 'native').backend).toBe('llamacpp');
  });
});
