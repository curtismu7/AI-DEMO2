/**
 * Build a credential-safe `cause` Error from a caught (often axios) error.
 *
 * Raw axios errors carry `error.config` — the Authorization header (Basic
 * credentials) and the request body (which includes client_secret on token
 * calls). Attaching the raw error as a `cause` would re-expose those secrets in
 * any log that prints the cause chain, the same leak that agentIdentity's HI-03
 * scrubbing deliberately removes. This keeps only the non-sensitive fields that
 * are useful for debugging: the message, the transport code (e.g. ECONNREFUSED),
 * the HTTP status, and the server's error response body (an OAuth error JSON,
 * which holds no secrets).
 */
export function sanitizeAxiosCause(error: unknown): Error {
  const e = error as
    | { message?: string; code?: string; response?: { status?: number; data?: unknown } }
    | undefined;
  return Object.assign(new Error(e?.message || 'Unknown error'), {
    transportCode: e?.code,
    httpStatus: e?.response?.status,
    responseBody: e?.response?.data,
  });
}
