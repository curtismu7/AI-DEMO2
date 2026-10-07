'use strict';

// One place that decides the login_hint a sign-in sends, for PingOne and PingFederate alike, so the sign-in page
// is pre-filled with who the app already knows is signing in instead of a fixed demo name or nothing.
//
// The two servers spell the same person differently. PingFederate's own users are case-sensitive and lowercase
// here ("demouser"); PingOne spells the account "demoUser" (and matches usernames case-insensitively). A
// PingFederate session already carries PingFederate's spelling, so it is kept; a name from any other session is
// lowercased when the target is PingFederate. Sent to PingFederate as-is, "demoUser" fails with "bad password".
// ponytail: assumes PingFederate's users are lowercase; map names per user if that stops being true.
const PINGFEDERATE = 'pingfederate';

const normalized = (provider) => (String(provider || '').toLowerCase() === PINGFEDERATE ? PINGFEDERATE : 'pingone');

// The server that signed the current session in ('' when nobody is).
function sessionProvider(req) {
  const provider = req?.session?.oauthProvider || req?.session?.user?.oauthProvider;
  return provider ? normalized(provider) : '';
}

function cleanName(name) {
  const text = String(name || '').trim();
  return text && text.length <= 256 && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
}

// `name` as `targetProvider` spells it, or '' when there is no usable name.
function spelledFor(targetProvider, name, knownProvider = '') {
  const text = cleanName(name);
  if (!text) return '';
  return normalized(targetProvider) === PINGFEDERATE && normalized(knownProvider) !== PINGFEDERATE ? text.toLowerCase() : text;
}

// The hint for a sign-in at `targetProvider` for the person already in this session (or `name`, if given).
// '' means "nobody known": the caller then keeps its own default, or sends no hint at all.
function loginHintFor(req, targetProvider, name = req?.session?.user?.username) {
  return spelledFor(targetProvider, name, sessionProvider(req));
}

module.exports = { PINGFEDERATE, sessionProvider, spelledFor, loginHintFor };
