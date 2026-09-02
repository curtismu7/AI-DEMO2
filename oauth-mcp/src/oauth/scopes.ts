/**
 * The scopes this server protects and issues — declared once, read by both
 * metadata documents.
 *
 * They used to be hard-coded separately in two places that disagreed: the RFC
 * 9728 protected-resource document (HttpMCPTransport) advertised the four
 * banking scopes, while the RFC 8414 authorization-server document
 * (OAuthRouter) advertised only `mcp:invoke`/`read`/`write`. MCP clients take
 * their scope list from the RESOURCE document, so a real client (LM Studio,
 * observed 2026-09-02) would request `accounts:read …` — scopes the AS never
 * claimed to support. It honoured them anyway, so the flow worked, which is
 * exactly why the drift went unnoticed; a stricter client that validates the
 * request against the AS document would refuse to build the URL at all.
 *
 * Keep both documents fed from here so they cannot drift again.
 */

/** Scopes that gate the banking tools — the protected resource's own vocabulary. */
export const BANKING_SCOPES = [
  'accounts:read',
  'transactions:read',
  'transactions:write',
  'sensitive:read',
] as const;

/** Coarse scopes the embedded AS has always issued, kept for existing clients. */
export const GENERIC_MCP_SCOPES = ['mcp:invoke', 'read', 'write'] as const;

/**
 * What the authorization server advertises: everything it will actually issue.
 * Superset of the resource's scopes, so a client that discovers scopes from
 * either document builds a request the other end accepts.
 */
export const AUTHORIZATION_SERVER_SCOPES: string[] = [
  ...BANKING_SCOPES,
  ...GENERIC_MCP_SCOPES,
];
