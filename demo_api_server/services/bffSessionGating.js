// banking_api_server/services/bffSessionGating.js
'use strict';

/**
 * True when the UI looks signed in but the BFF has no real OAuth tokens (Vercel cookie fallback).
 * @param {{ session?: object } | null | undefined} req
 * @returns {boolean}
 */
function isCookieOnlyBffSession(req) {
  return (
    req.session?._restoredFromCookie === true ||
    req.session?.oauthTokens?.accessToken === '_cookie_session'
  );
}

const SESSION_NOT_HYDRATED_MESSAGE =
  'Your browser shows you as signed in, but this server instance does not have your OAuth tokens. ' +
  'The session store is unhealthy -- check GET /api/auth/debug and read sessionStoreError for the exact cause. ' +
  'Required env vars: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN). ' +
  'Apply to Production in Vercel -> Settings -> Environment Variables, redeploy, sign out, sign in again. ' +
  '"Refresh access token" cannot fix this until a real session-store-backed session holds refresh_token.';

/**
 * 401 body for MCP/BFF routes when there is no bearer-equivalent session token.
 * @param {{ session?: object } | null | undefined} req
 * @param {unknown} [tokenEvents]
 * @returns {{ status: number, body: object }}
 */
function mcpNoBearerResponse(req, tokenEvents) {
  if (isCookieOnlyBffSession(req)) {
    return {
      status: 401,
      body: {
        error: 'session_not_hydrated',
        message: SESSION_NOT_HYDRATED_MESSAGE,
        tokenEvents,
      },
    };
  }
  return {
    status: 401,
    body: {
      error: 'authentication_required',
      message: 'Sign in to use the banking agent.',
      tokenEvents,
    },
  };
}

module.exports = {
  isCookieOnlyBffSession,
  mcpNoBearerResponse,
  SESSION_NOT_HYDRATED_MESSAGE,
};
