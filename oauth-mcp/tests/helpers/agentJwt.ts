/**
 * agentJwt — build well-formed agent tokens for tests.
 *
 * TokenIntrospector.validateAgentToken decodes the bearer LOCALLY:
 *
 *   const parts = token.split('.');
 *   if (parts.length === 3) decoded = JSON.parse(base64url(parts[1]));
 *   if (!decoded) throw new AuthenticationError('Malformed JWT');
 *
 * It no longer calls PingOne introspection — the MCP Gateway has already
 * validated the token through the Authorization Server, so introspection here
 * would be redundant and would need the wrong client credentials.
 *
 * That means an opaque string like 'valid-agent-token-12345' can never reach
 * any assertion: it has one part, so it dies at 'Malformed JWT' immediately.
 * Tests must hand it a real three-part JWT.
 *
 * The signature is a fixed placeholder and that is fine: verifyTokenSignature
 * warns and returns false when JWKS is unconfigured (it only throws under
 * STRICT_AUTH), and jest.config.js already maps `jose` to a CJS shim. No
 * keypair or JWKS mock is needed here.
 */

/** Claims callers commonly override. Anything else is passed through as-is. */
export interface AgentJwtClaims {
  sub?: string;
  client_id?: string;
  scope?: string;
  /** Seconds since epoch. Defaults to one hour out. Pass a past value to make the token inactive. */
  exp?: number;
  aud?: string | string[];
  act?: Record<string, unknown>;
  may_act?: Record<string, unknown>;
  [key: string]: unknown;
}

const b64url = (obj: object): string =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

/**
 * Build a three-part JWT the local decoder accepts.
 *
 * @param claims  Overrides merged over the defaults (sub/client_id/scope/exp).
 * @returns       `header.payload.signature` — signature is a placeholder.
 */
export function makeAgentJwt(claims: AgentJwtClaims = {}): string {
  const header = b64url({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const payload = b64url({
    sub: 'test-agent',
    client_id: 'test-client-id',
    scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...claims,
  });
  return `${header}.${payload}.test-signature-not-verified`;
}

/**
 * A token that is syntactically a JWT but already expired.
 *
 * NOTE the resulting error is 'Agent token is not active', NOT 'Agent token has
 * expired'. validateAgentToken computes `active = !exp || exp >= now` and checks
 * `!active` before it reaches the expiry branch, so a past `exp` always trips the
 * active check first.
 */
export function makeExpiredAgentJwt(claims: AgentJwtClaims = {}): string {
  return makeAgentJwt({ exp: Math.floor(Date.now() / 1000) - 3600, ...claims });
}

/** A token that is NOT a JWT — use where a test means to exercise the decode failure. */
export const MALFORMED_AGENT_TOKEN = 'not-a-jwt';
