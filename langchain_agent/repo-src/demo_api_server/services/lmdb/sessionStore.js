'use strict';
/**
 * sessionStore.js — LMDB-backed express-session store.
 *
 * Implements the express-session Store interface. Entries are stored as
 * { sess, expire } objects. Expired sessions are pruned on get() and by
 * an hourly cleanup interval.
 *
 * Imported by server.js as the sole session store.
 */
const { Store } = require('express-session');
const { openEnv } = require('./openEnv');

const DB_NAME = 'sessions';
const ONE_HOUR_MS = 60 * 60 * 1000;

class LmdbSessionStore extends Store {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 24 * 60 * 60 * 1000; // 24h default
    this._db = openEnv().openDB(DB_NAME, { encoding: 'json' });
    this._startCleanup();
  }

  _startCleanup() {
    this._cleanupInterval = setInterval(() => this._cleanup(), ONE_HOUR_MS);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  _cleanup() {
    const now = Date.now();
    for (const { key, value } of this._db.getRange()) {
      if (value.expire <= now) this._db.removeSync(key);
    }
  }

  // IMPORTANT: every method invokes its SUCCESS callback OUTSIDE the try/catch.
  // The express-session success callback (e.g. req.session.save(fn)) runs app
  // code (the OAuth callback's posthog.identify, redirect, etc.). If that code
  // throws synchronously and we called cb() inside the try, the throw re-enters
  // catch and fires cb(err) a SECOND time — express-session then treats the
  // just-saved session as a failed save and destroys it (the 2026-06-12 login
  // self-destruct). Catch must cover only the LMDB op, never the callback.

  get(sid, cb) {
    let sess;
    try {
      const entry = this._db.get(sid);
      sess = (!entry || entry.expire <= Date.now()) ? null : entry.sess;
    } catch (e) { return cb(e); }
    cb(null, sess);
  }

  set(sid, sess, cb) {
    try {
      // sess.cookie.maxAge is already in milliseconds (express-session stores
      // remaining ms, not seconds). Do NOT multiply by 1000 — that produced
      // ~3-year expiry (86 400 000 ms * 1000 ≈ 2 740 years).
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : this.ttl;
      const expire = Date.now() + maxAge;
      this._db.putSync(sid, { sess, expire });
    } catch (e) { return cb(e); }
    cb(null);
  }

  destroy(sid, cb) {
    try {
      this._db.removeSync(sid);
    } catch (e) { return cb(e); }
    cb(null);
  }

  all(cb) {
    let sessions;
    try {
      const now = Date.now();
      sessions = {};
      for (const { key, value } of this._db.getRange()) {
        if (value.expire > now) sessions[key] = value.sess;
      }
    } catch (e) { return cb(e); }
    cb(null, sessions);
  }

  length(cb) {
    let count;
    try {
      const now = Date.now();
      count = 0;
      for (const { value } of this._db.getRange()) {
        if (value.expire > now) count++;
      }
    } catch (e) { return cb(e); }
    cb(null, count);
  }

  clear(cb) {
    try {
      this._db.clearSync();
    } catch (e) { return cb(e); }
    cb(null);
  }

  close() {
    clearInterval(this._cleanupInterval);
  }
}

module.exports = { LmdbSessionStore };
