'use strict';

/**
 * configStore.envCoverage.test.js
 *
 * Ensures every env var defined in banking_api_server/.env has a corresponding
 * entry in configStore's envFallbackMap, and that each mapping resolves the
 * right value when process.env is set.
 *
 * This test runs in the pre-commit hook (api-server test suite) so that a new
 * .env variable added without a configStore mapping is caught before it ships.
 */

const path = require('path');
const fs   = require('fs');

// ── Parse .env to get the canonical list of variable names ───────────────────
const ENV_FILE = path.resolve(__dirname, '../../.env');

function parseEnvKeys(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(line => /^[A-Z_][A-Z0-9_]*=/.test(line.trim()))
    .map(line => line.trim().split('=')[0]);
}

// Variables intentionally NOT routed through configStore — purely runtime /
// infra / test-only vars that no feature code calls getEffective() for.
const IGNORED_VARS = new Set([
  'NODE_ENV',          // runtime platform flag, never via configStore
  'USERNAME',          // demo cred mapped as demo_username
  'PASSWORD',          // demo cred mapped as demo_password
  'PINGONE_MFA_POLICY_ID', // appears twice in .env (duplicate); mapped once
  // VAULT_PASSWORD is the vault decryption password consumed by
  // services/vaultLoader.js at bootstrap and deleted from process.env
  // immediately after (vaultLoader.js ~line 110). configStore reads FROM the
  // vault that VAULT_PASSWORD unlocks, so routing it through getEffective is
  // both circular and contradicts the deliberate scrub. Pure infra/bootstrap
  // secret — same category as NODE_ENV, not a config-coverage gap.
  'VAULT_PASSWORD',
]);

// Alias-prefix normalizations: maps a .env var prefix to the configStore key
// prefix it is aliased under, so the coverage test can derive the correct
// getEffective() candidate for vars that live under a renamed key. Each entry
// is [regex, replacement]; applied against the lowercased var name to build
// extra candidates. Keeps already-aliased vars (AGENT_OAUTH_*, AGENT_*,
// MCP_RESOURCE_URI, etc.) from false-failing without needing redundant
// envFallbackMap entries for keys that are already covered.
const ALIAS_PREFIXES = [
  [/^agent_oauth_/,        'pingone_mcp_token_exchanger_'],
  [/^pingone_mcp_exchanger_/, 'pingone_mcp_token_exchanger_'],
  [/^agent_/,              'pingone_ai_agent_'],
  [/^pingone_worker_/,     'pingone_worker_token_'],
  [/^demo_user_/,          'demo_'],
];

// Exact-name remaps for vars whose alias is not a clean prefix substitution.
const ALIAS_EXACT = {
  mcp_resource_uri:        'pingone_resource_mcp_server_uri',
  // MCP_SERVER_RESOURCE_URI is aliased in configStore under
  // pingone_resource_mcp_server_uri → ['PINGONE_RESOURCE_MCP_SERVER_URI',
  // 'MCP_RESOURCE_URI', 'MCP_SERVER_RESOURCE_URI']. The lowercased key
  // mcp_server_resource_uri is not itself a top-level configStore key, so the
  // auto-derive step misses it — register the explicit redirect here.
  mcp_server_resource_uri: 'pingone_resource_mcp_server_uri',
};

// ── Build the envFallbackMap by requiring configStore internals ───────────────
// We expose the map for testing by calling getEffective with a known sentinel
// and checking the reverse lookup.  Instead, we extract the map directly by
// loading the module and walking getEffective source — but the simplest approach
// is to verify resolution: set process.env[VAR]=sentinel, call getEffective(key),
// assert it returns the sentinel, then restore.

// We need to know which configStore key maps to each env var.
// Build that inverse map from FIELD_DEFS key names → env var aliases via
// a small extraction shim that mirrors the envFallbackMap in configStore.
// We import configStore and expose the map via a test-only export.

// configStore doesn't export envFallbackMap directly (it's inline in getEffective).
// Rather than coupling the test to internal structure, we verify coverage by:
//   1. Asserting that getEffective(derivedKey) returns the env var value when set.
//   2. For each .env key, we derive the expected configStore key (lowercase) and
//      check that it resolves.

const configStore = require('../../services/configStore');

// ── Tests ────────────────────────────────────────────────────────────────────

// Environmental: this suite validates a developer's real banking_api_server/.env
// (≥30 vars, each resolvable via configStore). CI checks out a fresh tree with
// no populated .env, so there is nothing meaningful to assert — skip rather
// than fail. Developers with a real .env still run it (incl. the pre-commit hook).
const _envKeysProbe = parseEnvKeys(ENV_FILE).filter(k => !IGNORED_VARS.has(k));
const HAS_REAL_ENV = [...new Set(_envKeysProbe)].length > 30;
const describeEnv = HAS_REAL_ENV ? describe : describe.skip;

describeEnv('configStore env coverage', () => {
  const envKeys = parseEnvKeys(ENV_FILE).filter(k => !IGNORED_VARS.has(k));

  // Deduplicate (PINGONE_MFA_POLICY_ID appears twice in file)
  const uniqueKeys = [...new Set(envKeys)];

  it('.env file exists and has at least 30 variables', () => {
    expect(uniqueKeys.length).toBeGreaterThan(30);
  });

  // For each env var, verify that configStore.getEffective resolves it.
  // Strategy: set process.env[VAR] to a unique sentinel, call getEffective with
  // the lowercase key (and common aliases), assert the sentinel is returned.
  uniqueKeys.forEach(envVar => {
    it(`getEffective resolves ${envVar}`, () => {
      const sentinel = `__TEST_${envVar}_${Date.now()}__`;
      const prev = process.env[envVar];
      process.env[envVar] = sentinel;

      // Try both the exact env var name lowercased and some common patterns.
      // configStore normalises keys to lowercase internally.
      const lower = envVar.toLowerCase();
      const candidates = [
        lower,
        // strip common prefixes to get the bare key
        envVar.replace(/^PINGONE_/, '').toLowerCase(),
        envVar.replace(/^PINGONE_/, 'pingone_').toLowerCase(),
        envVar.replace(/^HELIX_/, 'helix_').toLowerCase(),
      ];

      // Add alias-prefix-derived candidates so vars that are mapped under a
      // renamed configStore key (e.g. AGENT_OAUTH_CLIENT_ID →
      // pingone_mcp_token_exchanger_client_id) still resolve.
      for (const [re, repl] of ALIAS_PREFIXES) {
        if (re.test(lower)) candidates.push(lower.replace(re, repl));
      }
      if (ALIAS_EXACT[lower]) candidates.push(ALIAS_EXACT[lower]);

      let found = false;
      for (const candidate of candidates) {
        try {
          const val = configStore.getEffective(candidate);
          if (val === sentinel) {
            found = true;
            break;
          }
        } catch (_) { /* key not in map — try next */ }
      }

      // Restore original value
      if (prev === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = prev;
      }

      expect(found).toBe(true);
    });
  });
});
