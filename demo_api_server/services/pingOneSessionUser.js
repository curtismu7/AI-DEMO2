'use strict';

const { fetchPingOneUserByUsername } = require('./pingOneUserLookupService');

/**
 * The PingOne user id to use for a PingOne per-user call (MFA, directory groups)
 * on behalf of the signed-in user.
 *
 * A PingOne session's subject already is that id, so `sessionId` — whatever the
 * caller used before — is returned untouched. A PingFederate session's subject is
 * a PingFederate username, which PingOne does not know as an id: the PingOne
 * account with the same username is used instead (PingOne matches it
 * case-insensitively), looked up once and remembered on the session.
 *
 * Returns null for a PingFederate user with no PingOne account — never the
 * PingFederate subject, which PingOne would reject or, worse, match by accident.
 *
 * The provider is read from the session first: the admin sign-in stores
 * 'pingone_sso' on the user record whichever provider signed the admin in.
 */
async function pingOneUserIdFor(req, sessionId) {
  const session = req?.session;
  const user = session?.user;
  if ((session?.oauthProvider || user?.oauthProvider) !== 'pingfederate') return sessionId || null;
  if (user.pingOneUserId) return user.pingOneUserId;
  const { user: linked } = await fetchPingOneUserByUsername(user.username || user.oauthId);
  if (!linked?.id) return null;
  user.pingOneUserId = linked.id;
  return linked.id;
}

module.exports = { pingOneUserIdFor };
