'use strict';

/**
 * The façade's upstream leg to the Privilege AI Gateway.
 *
 * WHY THIS EXISTS. Standalone MCP clients (LM Studio) register themselves with
 * whatever authorization server a door advertises. The gateway keeps its RFC
 * 7591 client registry in MEMORY — verified 2026-09-02, there is no on-disk
 * store in the container — so every gateway restart forgets every client, and a
 * client that cached its registration dead-ends on a bare "Unknown client" page
 * until a human deletes and re-adds the integration.
 *
 * The fix is to stop pointing those clients at the gateway. A door backed by
 * this module advertises OUR durable authorization server instead and keeps the
 * gateway leg server-side, where the BFF already re-registers itself when the
 * gateway forgets it (see isDcrClientStillKnown in routes/privilegeMcpClient.js).
 * The client's own registration then never breaks.
 *
 * WHAT THIS DOES NOT FIX. The gateway offers only authorization_code and
 * refresh_token — no client_credentials (checked against its published
 * metadata) — so a gateway token can only be minted by a human completing a
 * browser sign-in, and every token is bound to a client the restart destroyed.
 * After a gateway restart someone must sign in once at /privilege-mcp-client;
 * this module then carries that session for the door. That is one browser click
 * instead of reconfiguring every MCP client, and it is the ceiling until the
 * gateway persists its registry.
 *
 * Deliberately in-memory and single-session: the demo drives one operator
 * identity through this door, and a token store that outlives the process would
 * be a credential at rest for no demo benefit.
 * ponytail: single shared session; key it per user if a second identity ever
 * needs this door.
 */

// Refresh this far before expiry so a call never races the clock.
const REFRESH_SKEW_MS = 60_000;

let current = null;

/**
 * Record a gateway session established by the interactive sign-in flow.
 * Called on every successful authorization-code exchange and refresh.
 */
function remember({ accessToken, refreshToken, expiresIn, tokenUri, clientId, clientSecret }) {
  if (!accessToken || !tokenUri) return;
  current = {
    accessToken,
    refreshToken: refreshToken || null,
    tokenUri,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    // A token with no expires_in is treated as short-lived rather than eternal.
    expiresAt: Date.now() + (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : 300_000),
  };
}

function clear() {
  current = null;
}

/** What the door reports when it cannot serve a request, for the operator. */
function status() {
  if (!current) return { ready: false, reason: 'no_session' };
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return { ready: true };
  return { ready: Boolean(current.refreshToken), reason: current.refreshToken ? 'refreshable' : 'expired' };
}

async function refresh() {
  if (!current?.refreshToken) return null;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });
  if (current.clientId) form.set('client_id', current.clientId);
  if (current.clientSecret) form.set('client_secret', current.clientSecret);

  let response;
  try {
    response = await fetch(current.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch {
    // Network trouble is not proof the session is dead — keep it and let the
    // next call try again.
    return null;
  }
  if (!response.ok) {
    // The gateway restarted (client gone) or the refresh token expired. Either
    // way this session can never be revived; drop it so status() tells the
    // operator to sign in again instead of failing opaquely forever.
    clear();
    return null;
  }
  let data;
  try { data = JSON.parse(await response.text()); } catch { return null; }
  if (!data.access_token) return null;

  remember({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    expiresIn: data.expires_in,
    tokenUri: current.tokenUri,
    clientId: current.clientId,
    clientSecret: current.clientSecret,
  });
  return current.accessToken;
}

/** A usable gateway access token, or null when a human must sign in again. */
async function getAccessToken() {
  if (!current) return null;
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return current.accessToken;
  return refresh();
}

module.exports = { remember, clear, status, getAccessToken };
