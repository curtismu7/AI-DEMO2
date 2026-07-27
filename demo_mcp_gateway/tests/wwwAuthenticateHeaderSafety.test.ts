/**
 * sendUnauthorized must emit a valid WWW-Authenticate header.
 *
 * HTTP header values are ASCII-printable only. Token validator messages are
 * not: tokenValidator.ts builds multi-line templates and jose/jsonwebtoken
 * embed newlines in signature errors. Interpolating one raw made
 * res.writeHead throw ERR_INVALID_CHAR, so a correct 401 surfaced to the
 * client as a 500 internal_server_error — losing both the status and the
 * resource_metadata hint that RFC 9728 discovery depends on.
 *
 * Observed live once JWKS verification was enabled: a forged HS256 token was
 * correctly rejected, then the 401 crashed on the way out.
 */
import { ServerResponse } from 'node:http';
// The real function sendUnauthorized uses — not a copy, so this test cannot
// pass while production drifts.
import { sanitizeHeaderDescription } from '../src/server/GatewayServer';

function writeHeaderValue(value: string): void {
  // ServerResponse validates header values without needing a live socket.
  const res = new ServerResponse({} as never);
  res.writeHead(401, { 'WWW-Authenticate': `Bearer error_description="${value}"` });
}

describe('WWW-Authenticate header safety', () => {
  // The real message shape from tokenValidator.ts.
  const MULTILINE = 'PINGONE_JWKS_ENDPOINT not configured — refusing to validate without signature\n'
    + 'verification. Set PINGONE_JWKS_ENDPOINT, or set MCP_GW_ALLOW_UNVERIFIED_TOKENS=true\n'
    + 'to accept unverified tokens.';

  it('rejects the raw multi-line message (the original defect)', () => {
    expect(() => writeHeaderValue(MULTILINE)).toThrow(/ERR_INVALID_CHAR|Invalid character/);
  });

  it('accepts the sanitized message', () => {
    expect(() => writeHeaderValue(sanitizeHeaderDescription(MULTILINE))).not.toThrow();
  });

  it('strips CR, LF and tabs', () => {
    const out = sanitizeHeaderDescription('a\r\nb\tc');
    expect(out).toBe('a b c');
  });

  it('strips non-ASCII (em dash) that headers cannot carry', () => {
    expect(sanitizeHeaderDescription('signature — invalid')).toBe('signature  invalid');
  });

  it('escapes double quotes so the auth-param cannot be broken out of', () => {
    expect(sanitizeHeaderDescription('bad "token" here')).toBe("bad 'token' here");
  });

  it('caps length so a long upstream error cannot bloat the header', () => {
    expect(sanitizeHeaderDescription('x'.repeat(1000))).toHaveLength(300);
  });
});
