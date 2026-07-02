'use strict';
/**
 * get-customer-token.js — demo helper for the ungoverned-agent sidecar.
 *
 * Finds a signed-in Customer's OAuth session in the BFF's LMDB session store and
 * prints its access token to stdout. If the token has less than MIN_MINUTES left
 * (default 5), it refreshes it first using the session's refresh token (via the
 * customer OAuth client) and persists the rotation back to the session so the
 * user's own browser session stays valid.
 *
 * Runs INSIDE the api-server container (cwd = /app), e.g.:
 *   docker exec -i ai-demo-api-server node - < demo_ungoverned_agent/get-customer-token.js
 *
 * Diagnostics go to stderr; ONLY the token is written to stdout so callers can
 * capture it cleanly:  TOK="$(docker exec -i ai-demo-api-server node - < …)"
 */
const MIN_MINUTES = Number(process.env.MIN_MINUTES || '5');

const { LmdbSessionStore } = require('./services/lmdb/sessionStore');
const oauthUserService = require('./services/oauthUserService');

function expOf(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return p.exp || 0;
  } catch { return 0; }
}

const store = new LmdbSessionStore({ ttl: 24 * 60 * 60 * 1000 });

store.all(async (err, sessions) => {
  if (err) { console.error('[get-token] session store read failed:', err.message); process.exit(1); }

  const now = Math.floor(Date.now() / 1000);
  const cands = Object.entries(sessions || {})
    .map(([sid, sess]) => ({ sid, sess, tok: sess?.oauthTokens?.accessToken, refresh: sess?.oauthTokens?.refreshToken }))
    .filter((c) => c.tok && c.tok !== '_cookie_session' && c.sess?.user?.role === 'customer')
    .map((c) => ({ ...c, exp: expOf(c.tok) }))
    .sort((a, b) => b.exp - a.exp);

  if (!cands.length) {
    console.error('[get-token] no Customer session with an access token — sign in as a Customer at the UI first.');
    process.exit(1);
  }

  const c = cands[0];
  const minsLeft = Math.round((c.exp - now) / 60);

  if (c.exp - now > MIN_MINUTES * 60) {
    console.error(`[get-token] using existing token (${minsLeft} min left)`);
    process.stdout.write(c.tok);
    process.exit(0);
  }

  if (!c.refresh) {
    console.error(`[get-token] token has ${minsLeft} min left and no refresh token — sign in again.`);
    process.exit(1);
  }

  console.error(`[get-token] token has ${minsLeft} min left — refreshing…`);
  try {
    const td = await oauthUserService.refreshAccessToken(c.refresh);
    if (!td.access_token) throw new Error('refresh returned no access_token');

    // Persist the rotated tokens back so the user's browser session keeps working.
    c.sess.oauthTokens = {
      ...c.sess.oauthTokens,
      accessToken: td.access_token,
      refreshToken: td.refresh_token || c.sess.oauthTokens.refreshToken,
      idToken: td.id_token || c.sess.oauthTokens.idToken,
      expiresAt: Date.now() + ((td.expires_in || 3600) * 1000),
    };
    await new Promise((resolve) => store.set(c.sid, c.sess, (e) => {
      if (e) console.error('[get-token] warn: could not persist refreshed token to session:', e.message);
      resolve();
    }));

    console.error('[get-token] refreshed OK');
    process.stdout.write(td.access_token);
    process.exit(0);
  } catch (e) {
    console.error('[get-token] refresh failed:', e.message);
    process.exit(1);
  }
});
