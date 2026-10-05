// Sign-in start shared by the Cursor page and the footprint skins. The request is
// injected (Cursor's fetch api() vs the skins' axios adapter); every side effect
// (overlay, flags, navigation, modal) stays with the caller.

/**
 * POST /auth/start. A door with no authorization server needs no sign-in; a start
 * with no authUrl is a misconfigured door or a changed body shape and throws, so
 * the caller's catch reports it instead of navigating to the string "undefined".
 * The skins pass `{ returnTo }` as `body` so the OAuth callback returns to the skin;
 * with no body the options carry no `body` key (Cursor's call).
 */
export async function requestAuthStart(request, body) {
  const data = await request('/auth/start', body ? { method: 'POST', body } : { method: 'POST' });
  if (data?.noAuthRequired) return { kind: 'no-auth-required' };
  if (!data?.authUrl) throw new Error('sign-in did not return an authorization URL');
  return { kind: 'redirect', authUrl: data.authUrl };
}

/** True when the authUrl is a prompt=none (silent) attempt. Throws on an invalid URL. */
export function isSilentAuthUrl(authUrl) {
  return new URL(authUrl).searchParams.get('prompt') === 'none';
}
