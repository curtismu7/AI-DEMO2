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
        console.error('Session regeneration error during login:', err);
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
    console.error('Login error:', error);
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
        console.error('Session regeneration error during register:', err);
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
    console.error('Registration error:', error);
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
  // A cookie-only stub session has no OAuth token — callers that check
  // `authenticated` must treat this as not signed in and prompt re-auth.
  // cookieOnlyBffSession:true is still included so the P1 polling loop
  // in BankingAgent can detect when the Redis session propagates.
  if (cookieOnlyBffSession) {
    return res.json({
      authenticated: false,
      user: null,
      cookieOnlyBffSession: true,
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
    cookieOnlyBffSession: false,
    sessionStoreError: req._sessionStoreError ?? null,
    sessionStoreHealthy: req._sessionStoreHealthy ?? null,
  });
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = dataStore.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });

  } catch (error) {
    console.error('Get user error:', error);
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
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Session status — callable by unauthenticated users (returns authenticated: false when not logged in)
router.get('/session', (req, res) => {
  try {
    const hasOAuthTokens = !!req.session?.oauthTokens?.accessToken;
    const hasLocalSession = !!req.session?.user;
    const authenticated = hasOAuthTokens || hasLocalSession;

    res.json({
      authenticated,
      user: req.session?.user ?? null,
      oauthType: req.session?.oauthType ?? null,
      clientType: req.session?.clientType ?? null,
      sessionStoreHealthy: req._sessionStoreHealthy ?? null,
      sessionStoreError: req._sessionStoreError ?? null,
    });
  } catch (error) {
    console.error('Session status error:', error);
    res.status(500).json({ error: 'Internal server error', authenticated: false });
  }
});

module.exports = router;
