// Session-establish steps shared by routes/davinciLogin.js (widget + code
// exchange) and routes/davinciSdkLogin.js (SDK lesson sandbox).
//
// Only the steps that are byte-for-byte the same live here. WHERE the tokens go
// differs on purpose (the widget writes the main session; the SDK lesson writes
// its own sandbox slot and restores the main one), so that stays in the routes.
// Responses and log text are unchanged: callers pass their own log prefix.
'use strict';
const dataStore = require('../data/store');

// Demo customer-login sandbox: authenticate an EXISTING demo user only. Never
// auto-create or auto-admin an account from an arbitrary DaVinci login.
// Returns the user, or sends the 404 and returns null.
function findDemoUser(oauthUser, res) {
  const user = dataStore.getUserByUsername(oauthUser.username);
  if (!user) {
    res.status(404).json({ error: 'user_not_found', message: `No demo user found for "${oauthUser.username}".` });
    return null;
  }
  return user;
}

// Regenerate before storing credentials to prevent session fixation. Failure is
// fatal: sends the 500 and does not call `next`.
function regenerateSession(req, res, logPrefix, next) {
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      console.error(`${logPrefix} Session regenerate FAILED — aborting login:`, regenErr.message);
      return res.status(500).json({ error: 'session_regenerate_failed', message: 'Could not establish a session.' });
    }
    return next();
  });
}

// Persist the session, then run `onSaved`. Failure sends the 500.
function saveSession(req, res, logPrefix, onSaved) {
  req.session.save((saveErr) => {
    if (saveErr) {
      console.error(`${logPrefix} Session save FAILED:`, saveErr.message);
      return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist session.' });
    }
    return onSaved();
  });
}

module.exports = { findDemoUser, regenerateSession, saveSession };
