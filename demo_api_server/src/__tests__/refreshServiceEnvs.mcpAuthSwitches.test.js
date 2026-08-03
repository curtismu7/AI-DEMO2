/**
 * @file refreshServiceEnvs.mcpAuthSwitches.test.js
 *
 * scripts/refresh-service-envs.js generates oauth-mcp/.env by WRITING THE FILE
 * WHOLESALE. Two fail-open auth switches — SKIP_TOKEN_SIGNATURE_VALIDATION and
 * ALLOW_JWKS_FAILOPEN — had been hand-added straight into that file, so every
 * ./run.sh deleted them and silently flipped the running MCP server's auth
 * posture with no diff and no log line. Emitting them from the generator is what
 * makes the value durable and reviewable.
 *
 * The subtle half is the SOURCE key name. demo_api_server/.env is both this
 * generator's input AND the BFF's own runtime env, and the BFF reads a
 * SKIP_TOKEN_SIGNATURE_VALIDATION of its own (middleware/auth.js) as a real auth
 * bypass. Sourcing the MCP switch from the unprefixed key would disable
 * signature verification in the BFF as a side effect of enabling one dev switch
 * in the MCP server. The prefix is the guard, and that is what these assertions
 * pin — the same MCP_SERVER_ convention ENCRYPTION_KEY already uses.
 *
 * The generator calls main() at require time (it is a CLI), so it cannot be
 * imported and driven in-process. Assertions are made against its source, with
 * `//` comments stripped so prose naming a key cannot satisfy a test.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', '..', 'scripts', 'refresh-service-envs.js');

/** The writeEnvFile({...}) argument block for oauth-mcp/.env, comments stripped. */
function oauthMcpEnvBlock() {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  const start = src.indexOf("'oauth-mcp', '.env'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('Wrote oauth-mcp/.env', start);
  expect(end).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const lineFor = (key) => oauthMcpEnvBlock()
  .split('\n')
  .find((l) => new RegExp(`^\\s*${key}\\s*:`).test(l));

describe('refresh-service-envs — oauth-mcp/.env auth switches', () => {
  it('emits both switches so ./run.sh stops silently dropping them', () => {
    const block = oauthMcpEnvBlock();
    expect(block).toMatch(/SKIP_TOKEN_SIGNATURE_VALIDATION\s*:/);
    expect(block).toMatch(/ALLOW_JWKS_FAILOPEN\s*:/);
  });

  // The whole point of the prefix. If this regresses to fb('SKIP_...'), enabling
  // the MCP server's dev escape hatch also switches off the BFF's token
  // signature verification, because both read demo_api_server/.env.
  it('sources the skip switch from the MCP_SERVER_-prefixed key, never the BFF one', () => {
    const line = lineFor('SKIP_TOKEN_SIGNATURE_VALIDATION');
    expect(line).toBeDefined();
    expect(line).toMatch(/fb\('MCP_SERVER_SKIP_TOKEN_SIGNATURE_VALIDATION'\)/);
    expect(line).not.toMatch(/fb\('SKIP_TOKEN_SIGNATURE_VALIDATION'\)/);
  });

  // Unset must stay unset. Both consumers test `=== 'true'`, so an empty value is
  // the secure default; a `|| 'true'` here would hand every fresh clone a server
  // that does not verify token signatures.
  it('defaults neither switch to true', () => {
    for (const key of ['SKIP_TOKEN_SIGNATURE_VALIDATION', 'ALLOW_JWKS_FAILOPEN']) {
      const line = lineFor(key);
      expect(line).toBeDefined();
      expect(line).not.toMatch(/\|\|\s*'true'/);
    }
  });

  // ALLOW_JWKS_FAILOPEN has no BFF consumer, so it is correctly unprefixed —
  // pinned so a later "make it consistent" cleanup has to be deliberate.
  it('leaves ALLOW_JWKS_FAILOPEN unprefixed (no BFF consumer to collide with)', () => {
    expect(lineFor('ALLOW_JWKS_FAILOPEN')).toMatch(/fb\('ALLOW_JWKS_FAILOPEN'\)/);
  });
});
