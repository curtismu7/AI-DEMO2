'use strict';

const crypto = require('crypto');
const cookie = require('cookie');
const signature = require('cookie-signature');

const COOKIE_NAME = 'hosted.sid';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function deriveHostedSessionSecret(sessionSecret) {
  return crypto.createHmac('sha256', sessionSecret || 'dev-session-secret-change-in-production')
    .update('ai-demo-hosted-front-door-session')
    .digest('hex');
}

function newSessionId() {
  return crypto.randomBytes(24).toString('hex');
}

function readSignedSessionId(req, secret) {
  const raw = cookie.parse(req.headers.cookie || '')[COOKIE_NAME];
  if (!raw) return null;
  const encoded = decodeURIComponent(raw);
  const signed = encoded.startsWith('s:') ? encoded.slice(2) : encoded;
  return signature.unsign(signed, secret) || null;
}

function cookieOptions(production) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

function setHostedCookie(res, id, secret, production) {
  const value = `s:${signature.sign(id, secret)}`;
  res.append('Set-Cookie', cookie.serialize(COOKIE_NAME, value, cookieOptions(production)));
}

function clearHostedCookie(res, production) {
  res.append('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    ...cookieOptions(production),
    maxAge: 0,
  }));
}

function createHostedSessionRecord(id, stored) {
  const record = stored && typeof stored === 'object' ? { ...stored } : {};
  delete record.id;
  delete record.save;
  delete record.destroy;
  return record;
}

function createHostedSessionMiddleware({ store, secret, production = false } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.destroy !== 'function') {
    throw new TypeError('A session-compatible store is required');
  }
  if (!secret) throw new TypeError('A hosted session signing secret is required');

  const middleware = (req, res, next) => {
    const existingId = readSignedSessionId(req, secret);
    const id = existingId || newSessionId();

    store.get(id, (err, stored) => {
      if (err) return next(err);

      const hostedSession = createHostedSessionRecord(id, stored);
      hostedSession.id = id;
      hostedSession.cookie = {
        ...cookieOptions(production),
        maxAge: SESSION_TTL_MS,
      };
      hostedSession.save = (callback = () => {}) => {
        const persistable = createHostedSessionRecord(id, hostedSession);
        persistable.cookie = hostedSession.cookie;
        store.set(id, persistable, (saveErr) => {
          if (!saveErr) setHostedCookie(res, id, secret, production);
          callback(saveErr || null);
        });
      };
      hostedSession.destroy = (callback = () => {}) => {
        store.destroy(id, (destroyErr) => {
          clearHostedCookie(res, production);
          callback(destroyErr || null);
        });
      };

      req.hostedSession = hostedSession;
      next();
    });
  };

  middleware.cookieName = COOKIE_NAME;
  middleware.sessionTtlMs = SESSION_TTL_MS;
  return middleware;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createHostedSessionMiddleware,
  deriveHostedSessionSecret,
};
