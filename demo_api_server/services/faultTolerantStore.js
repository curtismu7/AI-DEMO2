// banking_api_server/services/faultTolerantStore.js
'use strict';

/**
 * Wraps a connect-redis (or compatible) session store so that Redis errors in
 * get(), set(), and destroy() are swallowed rather than propagated as callback
 * errors.  This prevents two classes of production failures on Vercel:
 *
 *   1. store.get() error → express-session calls next(err) → oauthErrorHandler
 *      returns { error: 'server_error' } (500) instead of an empty session (401).
 *
 *   2. store.set() error → session.save(cb) calls cb(err) → login routes redirect
 *      to ?error=session_error before the user ever reaches PingOne.
 *
 * Fault-tolerant behaviour:
 *   get()     → error returns null (empty session, user gets 401)
 *   set()     → error is logged; cb called with null (session.save() succeeds silently)
 *   destroy() → error is logged; cb called with null
 *
 * All other store methods (touch, length, clear, ids) are passed through unchanged.
 *
 * @param {object} store  An express-session compatible store instance.
 * @param {object} [opts]
 * @param {Function} [opts.onError]  Optional callback(method, err) for observability.
 * @returns {object} The same store object with get/set/destroy patched in-place.
 */
function createFaultTolerantStore(store, { onError } = {}) {
  const _report = (method, err) => {
    console.error(`[session-store] Redis ${method} error (swallowed):`, err.message);
    if (onError) onError(method, err);
  };

  const _origGet = store.get.bind(store);
  store.get = (sid, cb) => {
    _origGet(sid, (err, session) => {
      if (err) { _report('get', err); return cb(null, null); }
      cb(null, session);
    });
  };

  const _origSet = store.set.bind(store);
  store.set = (sid, session, cb) => {
    _origSet(sid, session, (err) => {
      if (err) _report('set', err);
      if (cb) cb(null);
    });
  };

  if (typeof store.destroy === 'function') {
    const _origDestroy = store.destroy.bind(store);
    store.destroy = (sid, cb) => {
      _origDestroy(sid, (err) => {
        if (err) _report('destroy', err);
        if (cb) cb(null);
      });
    };
  }

  return store;
}

module.exports = { createFaultTolerantStore };
