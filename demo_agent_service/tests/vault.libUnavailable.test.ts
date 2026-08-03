'use strict';

/**
 * vault.libUnavailable.test.ts — the branch that runs in production.
 *
 * docker-compose builds agent-service with `context: ./demo_agent_service`, so
 * demo_api_server is never in the image and `require('../../demo_api_server/lib/vault')`
 * always fails. Confirmed against the running container:
 *   $ docker exec ai-demo-agent-service node -e "require('../../demo_api_server/lib/vault')"
 *   VAULT LIB MISSING: MODULE_NOT_FOUND
 *
 * Two findings live here:
 *
 *   5. The null-vaultLib branch returned silently, with reason 'no_vault_file'
 *      — asserting a missing file when the file may be mounted and readable.
 *      Every AGENT_/MCP_GW_/BFF_INTERNAL_ secret came from .env instead of the
 *      vault, the password fail-fast was unreachable, and nothing said so.
 *
 *   6. The require was wrapped in a bare `catch {}`, so a broken argon2 native
 *      build or a syntax error inside the vault library was indistinguishable
 *      from "this image has no demo_api_server" — a real defect silently
 *      downgraded to a normal-looking startup.
 *
 * Each test loads src/vault.ts through an isolated module registry with the
 * vault library's require rigged, because the failure being tested happens at
 * module load.
 */

const VAULT_LIB = '../../demo_api_server/lib/vault';

const ENV_KEYS_TO_GUARD = ['VAULT_PASSWORD', 'VAULT_PATH', 'VAULT_REQUIRED', 'VERCEL'];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS_TO_GUARD) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS_TO_GUARD) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.dontMock(VAULT_LIB);
  jest.resetModules();
});

function mockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/** Load src/vault.ts with the vault library's require throwing `err`. */
function loadModuleWithRequireError(err: Error) {
  jest.resetModules();
  jest.doMock(VAULT_LIB, () => {
    throw err;
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/vault');
}

const moduleNotFound = () => {
  const e = new Error(`Cannot find module '${VAULT_LIB}'`) as NodeJS.ErrnoException;
  e.code = 'MODULE_NOT_FOUND';
  return e;
};

const joined = (calls: unknown[][]) =>
  calls.map((c) => c.map((p) => (typeof p === 'string' ? p : '')).join(' ')).join(' ');

// ---------------------------------------------------------------------------
// 6. The require's catch must only swallow "this module is not here"
// ---------------------------------------------------------------------------
describe('require failures are not all treated as "no vault library"', () => {
  test('the vault library genuinely missing is tolerated', () => {
    expect(() => loadModuleWithRequireError(moduleNotFound())).not.toThrow();
  });

  test('a broken argon2 native build surfaces instead of being swallowed', () => {
    const e = new Error(
      "Cannot find module 'argon2'\nRequire stack:\n- /repo/demo_api_server/lib/vault/crypto.js",
    ) as NodeJS.ErrnoException;
    e.code = 'MODULE_NOT_FOUND';
    // Same error CODE as the tolerated case, different module. Pre-fix this was
    // swallowed and the service booted claiming 'no_vault_file'.
    expect(() => loadModuleWithRequireError(e)).toThrow(/argon2/);
  });

  test('any non-module error in the vault library surfaces', () => {
    expect(() => loadModuleWithRequireError(new SyntaxError('Unexpected token in index.js'))).toThrow(
      /Unexpected token/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The Compose branch must not be silent, and must honour VAULT_REQUIRED
// ---------------------------------------------------------------------------
describe('vault library unavailable (the branch Compose always takes)', () => {
  test('reports vault_lib_unavailable, not a missing file', async () => {
    const { loadVaultIntoEnv } = loadModuleWithRequireError(moduleNotFound());
    const logger = mockLogger();

    const result = await loadVaultIntoEnv({
      vaultPath: '/nonexistent/secrets.vault',
      logger,
    });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vault_lib_unavailable' });
  });

  test('says so in the log instead of returning silently', async () => {
    const { loadVaultIntoEnv } = loadModuleWithRequireError(moduleNotFound());
    const logger = mockLogger();

    await loadVaultIntoEnv({ vaultPath: '/nonexistent/secrets.vault', logger });

    const all = joined([
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.log.mock.calls,
    ]);
    expect(all).toMatch(/vault library not available/);
    expect(all).toMatch(/will NOT be loaded/);
  });

  test('escalates to error level when a password says the vault was expected', async () => {
    const { loadVaultIntoEnv } = loadModuleWithRequireError(moduleNotFound());
    const logger = mockLogger();

    await loadVaultIntoEnv({
      vaultPath: '/nonexistent/secrets.vault',
      password: 'operator-set-this',
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
    expect(joined(logger.error.mock.calls)).toMatch(/falling back to process\.env/);
  });

  test('VAULT_REQUIRED=true refuses to start, matching the BFF loader', async () => {
    const { loadVaultIntoEnv } = loadModuleWithRequireError(moduleNotFound());
    const logger = mockLogger();
    process.env.VAULT_REQUIRED = 'true';

    await expect(
      loadVaultIntoEnv({ vaultPath: '/nonexistent/secrets.vault', logger }),
    ).rejects.toThrow(/refusing to start/);
  });

  test('Vercel still wins — no vault is expected there at all', async () => {
    const { loadVaultIntoEnv } = loadModuleWithRequireError(moduleNotFound());
    const logger = mockLogger();

    const result = await loadVaultIntoEnv({
      vaultPath: '/nonexistent/secrets.vault',
      isVercel: true,
      logger,
    });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
