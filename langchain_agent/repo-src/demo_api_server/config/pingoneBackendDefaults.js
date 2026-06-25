'use strict';

/**
 * Optional baked-in PingOne **public** identifiers (no secrets).
 *
 * Use this file to pin the hosted app to a specific tenant without asking
 * end users to configure OAuth in the UI. Client **secrets** must never be
 * committed — supply them via deployment secrets (Vercel) or KV/SQLite.
 *
 * Leave values empty ('') to fall back to environment variables / Config UI / KV.
 *
 * Priority order (highest → lowest):
 *   1. KV / SQLite runtime config (Config UI)
 *   2. Vercel / deployment environment variables (PINGONE_ENVIRONMENT_ID, etc.)
 *   3. Values in this file (last resort — only used when env vars are absent)
 *
 * @type {Record<string, string>}
 */
module.exports = {
  // Empty by default. Each install runs `npm run setup:fresh`, which writes
  // real values into banking_api_server/.env. The values here are only used
  // when both runtime config (KV/SQLite) AND env vars are absent — and in
  // that state the app is unconfigured anyway, so falling back to ANY
  // hardcoded UUID here is wrong (it always points at someone else's tenant
  // and produces "NOT_FOUND" sign-on errors that look unexplained).
  //
  // If you're forking this for a specific deployment, fill in the public
  // identifiers below — but never commit client secrets.
  pingone_environment_id: '',
  admin_client_id:        '',
  user_client_id:         '',
  pingone_worker_client_id:              '',
  pingone_mcp_token_exchanger_client_id: '',
  /** Redirect URIs are derived from the public app URL at runtime. */
  admin_redirect_uri: '',
  user_redirect_uri:  '',
  frontend_url:       '',
};
