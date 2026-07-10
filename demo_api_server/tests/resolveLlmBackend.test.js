// demo_api_server/tests/resolveLlmBackend.test.js
//
// Platform-aware LLM_BACKEND resolution guard. Ensures resolve-llm-backend.sh
// picks omlx on Apple Silicon Mac and llamacpp elsewhere, and rejects omlx on Linux.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESOLVER = path.resolve(__dirname, '../../demo_llm_proxy/resolve-llm-backend.sh');

function resolveBackend(env = {}) {
  const merged = { ...process.env, ...env };
  const envPairs = Object.entries(merged)
    .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
    .join(' ');
  const cmd = `${envPairs} bash -c 'source "${RESOLVER}" && resolve_llm_backend && printf "|%s" "${LLM_BACKEND_RESOLVE_WARN:-}"'`;
  const out = execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' }).trim();
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
