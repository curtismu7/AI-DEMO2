/**
 * Build a credential-safe `cause` Error from a caught (often axios) error.
 *
 * Raw axios errors carry `error.config` — the Authorization header (Bearer /
 * Basic credentials) and the request body (client_secret on token calls, and on
 * the ROPC path the end-user password). Attaching the raw error as a `cause`
 * would re-expose those secrets in any log that prints the cause chain. This
 * keeps only the non-sensitive fields useful for debugging: the message, the
 * transport code (e.g. ECONNREFUSED), the HTTP status, and the server's error
 * response body (a PingOne / OAuth error JSON, which holds no secrets).
 *
 * Mirrors oauth-mcp/src/utils/sanitizeAxiosCause.ts (separate package,
 * cannot be shared as code).
 */
function sanitizeAxiosCause(error) {
  const cause = new Error(error?.message || 'Unknown error');
  cause.transportCode = error?.code;
  cause.httpStatus = error?.response?.status;
  cause.responseBody = error?.response?.data;
  return cause;
}

module.exports = { sanitizeAxiosCause };
