const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { verifyPassword, hashPassword, authenticateToken } = require('../middleware/auth');
const posthog = require('../services/posthog');

// Login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = dataStore.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    const isValidPassword = verifyPassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Regenerate session ID on privilege elevation to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error during login:', err?.stack || String(err));
        return res.status(500).json({ error: 'Internal server error' });
      }
      req.session.user = user;
      req.session.clientType = 'enduser';
      req.session.tokenType = 'local_session';

      posthog.identify({
        distinctId: user.id,
        properties: {
          $set: { email: user.email, username: user.username, role: user.role },
        },
      });
      posthog.capture({
        distinctId: user.id,
        event: 'user_logged_in',
        properties: { auth_method: 'local', role: user.role },
      });

      const { password: _, ...userWithoutPassword } = user;
      res.json({
        message: 'Login successful',
        user: userWithoutPassword
      });
    });

  } catch (error) {
    console.error('Login error:', error?.stack || String(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName } = req.body;

    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if username already exists
    const existingUser = dataStore.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Check if email already exists
    const existingEmail = dataStore.getAllUsers().find(user => user.email === email);
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Validate password strength (NIST SP 800-63B: minimum 8 chars)
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const hashedPassword = hashPassword(password);
    
    const userData = {
      username,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: 'customer'
    };

    const newUser = await dataStore.createUser(userData);

    // Regenerate session ID on privilege elevation to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error during register:', err?.stack || String(err));
        return res.status(500).json({ error: 'Internal server error' });
      }
      req.session.user = newUser;
      req.session.clientType = 'enduser';
      req.session.tokenType = 'local_session';

      posthog.identify({
        distinctId: newUser.id,
        properties: {
          $set: { email: newUser.email, username: newUser.username, role: newUser.role },
          $set_once: { first_login: new Date().toISOString() },
        },
      });
      posthog.capture({
        distinctId: newUser.id,
        event: 'user_registered',
        properties: { auth_method: 'local', role: newUser.role },
      });

      const { password: _, ...userWithoutPassword } = newUser;
      res.status(201).json({
        message: 'User registered successfully',
        user: userWithoutPassword
      });
    });

  } catch (error) {
    console.error('Registration error:', error?.stack || String(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generic session status — works for all auth types (basic auth, OAuth admin, OAuth user).
// Used by BankingAgent.js and apiClient.js to detect any active session without
// caring whether the user authenticated via username/password or PingOne OAuth.
router.get('/session', (req, res) => {
  const u = req.session?.user;
  if (!u) return res.json({ authenticated: false, user: null });
  const cookieOnlyBffSession =
    req.session._restoredFromCookie === true ||
    req.session.oauthTokens?.accessToken === '_cookie_session';
  const wasOAuthLogin = req.session.oauthType === 'user' || req.session.oauthType === 'admin'
    || (!req.session.oauthType && u.role === 'admin' && req.session.tokenType !== 'local_session');
  const oauthToken = req.session.oauthTokens?.accessToken;
  const expiresAt = req.session.oauthTokens?.expiresAt;
  const staleOAuthSession = wasOAuthLogin && (!oauthToken || (expiresAt && Date.now() >= expiresAt));
  // A cookie-only stub session has no OAuth token — callers that check
  // `authenticated` must treat this as not signed in and prompt re-auth.
  // cookieOnlyBffSession:true is still included so the P1 polling loop
  // in BankingAgent can detect when the Redis session propagates.
  if (cookieOnlyBffSession || staleOAuthSession) {
    return res.json({
      authenticated: false,
      user: null,
      cookieOnlyBffSession,
      sessionStoreError: req._sessionStoreError ?? null,
      sessionStoreHealthy: req._sessionStoreHealthy ?? null,
    });
  }
  res.json({
    authenticated: true,
    user: {
      id:        u.id,
      username:  u.username,
      email:     u.email,
      firstName: u.firstName,
      lastName:  u.lastName,
      role:      u.role,
    },
    authType: req.session.oauthType || req.session.tokenType || 'session',
    expiresAt: req.session.oauthTokens?.expiresAt || req.session.cookie?.expires?.getTime?.() || null,
    cookieOnlyBffSession: false,
    sessionStoreError: req._sessionStoreError ?? null,
    sessionStoreHealthy: req._sessionStoreHealthy ?? null,
  });
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  try {
    // PingFederate tokens carry sub as the IdP user key (PingOne UUID), not the
    // local store's numeric id, and legacy store records can exist keyed by that
    // UUID with stale roles. The session/callback path already reconciles identity
    // by username (see routes/oauth.js), so prefer a username lookup and only fall
    // back to id. PingOne tokens with UUID subs still resolve via the session
    // user's username (also set from userinfo).
    const sessionUser = req.session?.user;
    const user = (sessionUser?.username && dataStore.getUserByUsername(sessionUser.username))
      || (req.user.username && dataStore.getUserByUsername(req.user.username))
      || dataStore.getUserById(req.user.id)
      || dataStore.getUserByUsername(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });

  } catch (error) {
    console.error('Get user error:', error?.stack || String(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const user = dataStore.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidCurrentPassword = verifyPassword(currentPassword, user.password);
    if (!isValidCurrentPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const hashedNewPassword = hashPassword(newPassword);
    await dataStore.updateUser(req.user.id, { password: hashedNewPassword });

    posthog.capture({
      distinctId: req.user.id,
      event: 'password_changed',
    });

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error?.stack || String(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NOTE: Duplicate GET /session handler removed (was dead code — Express only
// invokes the first matching handler). The canonical session handler above
// handles all auth types (basic auth, OAuth admin, OAuth user).

module.exports = router;
