/**
 * @file docker-compose.idJagIssuerScheme.test.js
 * @description Every side of native ID-JAG must agree on the embedded AS issuer,
 * scheme included.
 *
 * Three services independently need this value and each gets it from a different
 * place:
 *
 *   mcp-server    OAUTH_ISSUER              — MINTS the token, so its value IS the `iss`
 *   demo-api-server ENTERPRISE_MCP_AS_ISSUER — mint/redeem legs and the `aud` check
 *   mcp-gateway   OAUTH_MCP_ID_JAG_ISSUER   — decides whether to verify against
 *                                             oauth-mcp's JWKS instead of PingOne's
 *
 * tokenValidator compares the token's `iss` to its own value EXACTLY. Its built-in
 * default was https://localhost:8080 while mcp-server issues http://localhost:8080,
 * so isIdJagIssuedToken() was false for every real ID-JAG bearer, the gateway fell
 * back to PingOne's JWKS, and the call died with:
 *
 *   No matching JWKS key found for kid=62b4c1eb0d4f5572
 *
 * — a message that points at PINGONE_JWKS_URI, which was entirely correct and had
 * nothing to do with it. Observed live 2026-08-26.
 *
 * docker-compose.yml already carries a comment warning that this scheme "MUST
 * track mcp-server's OAUTH_ISSUER" for ENTERPRISE_MCP_AS_ISSUER. Nothing enforced
 * it, and the third consumer was not wired at all.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const COMPOSE = path.join(__dirname, '..', '..', '..', 'docker-compose.yml');
const src = fs.readFileSync(COMPOSE, 'utf8');

/** All `KEY: "..."` occurrences, resolved through a `${VAR:-default}` wrapper. */
function composeValues(key) {
  return src
    .split('\n')
    .filter((l) => l.trim().startsWith(`${key}:`))
    .map((l) => {
      const v = l.slice(l.indexOf(':') + 1).trim().replace(/^"|"$/g, '');
      const m = v.match(/^\$\{[A-Z0-9_]+:-(.*)\}$/);
      return m ? m[1] : v;
    });
}

const only = (key) => {
  const vals = composeValues(key);
  expect(vals.length).toBeGreaterThan(0); // vacuity guard: a rename must not pass silently
  return vals;
};

describe('native ID-JAG embedded-AS issuer agreement', () => {
  it('mcp-gateway declares OAUTH_MCP_ID_JAG_ISSUER at all', () => {
    // Left unset it falls back to tokenValidator's hardcoded https:// default,
    // which is the bug this test exists for.
    expect(only('OAUTH_MCP_ID_JAG_ISSUER').length).toBeGreaterThan(0);
  });

  it('the minting issuer and the gateway s expected issuer agree exactly', () => {
    const minted = only('OAUTH_ISSUER');
    const gateway = only('OAUTH_MCP_ID_JAG_ISSUER');
    for (const g of gateway) expect(minted).toContain(g);
  });

  it('the BFF and the gateway agree with the minting issuer', () => {
    const minted = only('OAUTH_ISSUER');
    for (const b of only('ENTERPRISE_MCP_AS_ISSUER')) expect(minted).toContain(b);
  });

  // The specific failure mode: a scheme difference is invisible in a diff and
  // fatal at runtime, because the comparison is a string equality.
  it('all three agree on the URL SCHEME', () => {
    const scheme = (u) => (u.match(/^([a-z]+):\/\//) || [, null])[1];
    const schemes = new Set(
      [
        ...only('OAUTH_ISSUER'),
        ...only('ENTERPRISE_MCP_AS_ISSUER'),
        ...only('OAUTH_MCP_ID_JAG_ISSUER'),
      ].map(scheme),
    );
    expect([...schemes]).toHaveLength(1);
    expect([...schemes][0]).toBeTruthy();
  });
});
