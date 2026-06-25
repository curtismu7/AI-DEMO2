const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { requireAdmin, requireOwnershipOrAdmin, requireAIAgent, authenticateToken, requireScopes, requireNotBankDelegate, hashPassword } = require('../middleware/auth');
const { blockInDemoMode, isDemoMode } = require('../middleware/demoMode');
const pingOneUserService = require('../services/pingOneUserService');

/**
 * Normalize a PingOne user object to the shape the UI expects.
 */
function normalizePingOneUser(u) {
  return {
    id: u.id,
    firstName: u.name?.given || '',
    lastName: u.name?.family || '',
    username: u.username || u.email || '',
    email: u.email || '',
    role: u.population?.id ? 'user' : 'user',  // PingOne has no role field; default to 'user'
    isActive: u.enabled !== false,
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt,
    population: u.population,
    agentRestrictions: u.agentRestrictions ?? 'write',
  };
}

// Query user by email (AI agents only)
router.get('/query/by-email/:email', authenticateToken, requireAIAgent, (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Find user by email
    const user = dataStore.getAllUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        email: email,
        exists: false
      });
    }

    // Remove sensitive information from response
    const { password: _password, ...userWithoutPassword } = user;

    // Log the AI agent query for audit purposes
    console.log(`🤖 [AI Agent Query] User lookup by email: ${email} - Found: ${user.username} (${user.role}) - Agent: ${req.user.username}`);

    res.json({ 
      user: userWithoutPassword,
      exists: true,
      queriedBy: req.user.username,
      queriedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI agent user query error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (admin only) — fetches live from PingOne
router.get('/', authenticateToken, requireScopes(['read']), requireAdmin, async (req, res) => {
  try {
    pingOneUserService.initialize();
    const { limit = 100 } = req.query;
    const result = await pingOneUserService.listUsers({ limit: parseInt(limit) });
    const raw = result._embedded?.users || [];
    res.json({ users: raw.map(normalizePingOneUser), total: raw.length });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get user by ID
router.get('/:userId', authenticateToken, requireScopes(['read']), requireOwnershipOrAdmin, (req, res) => {
  try {
    const { userId } = req.params;
    const user = dataStore.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password from response
    const { password: _password, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new user (admin only)
router.post('/', blockInDemoMode('user creation'), authenticateToken, requireScopes(['write']), requireAdmin, async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role } = req.body;

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
      role: role || 'customer'
    };

    const newUser = await dataStore.createUser(userData);
    
    // Remove password from response
    const { password: _passwordOut, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.put('/:userId', authenticateToken, requireScopes(['write']), requireOwnershipOrAdmin, requireNotBankDelegate('profile changes'), async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    // Demo mode: block password changes
    if (isDemoMode() && (req.body.password !== undefined)) {
      return res.status(403).json({
        error:   'demo_mode',
        operation: 'password change',
        message: '"password change" is disabled on the shared public demo. Deploy your own instance to enable all operations.',
      });
    }

    const user = dataStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent updating certain fields for non-admin users
    if (req.user.role !== 'admin') {
      delete updates.role;
      delete updates.isActive;
    }

    // If password is being updated, hash it
    if (updates.password) {
      if (updates.password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }
      updates.password = hashPassword(updates.password);
    }

    // Check for username/email conflicts
    if (updates.username) {
      const existingUser = dataStore.getUserByUsername(updates.username);
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    if (updates.email) {
      const existingEmail = dataStore.getAllUsers().find(user => user.email === updates.email && user.id !== userId);
      if (existingEmail) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    const updatedUser = await dataStore.updateUser(userId, updates);
    
    // Remove password from response
    const { password: _passwordOut, ...userWithoutPassword } = updatedUser;

    res.json({
      message: 'User updated successfully',
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only)
router.delete('/:userId', blockInDemoMode('user deletion'), authenticateToken, requireScopes(['write']), requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = dataStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has accounts
    const userAccounts = dataStore.getAccountsByUserId(userId);
    if (userAccounts.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete user with existing accounts. Deactivate user instead.' 
      });
    }

    await dataStore.deleteUser(userId);

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users (admin only) — fetches live from PingOne
router.get('/search/:query', authenticateToken, requireScopes(['read']), requireAdmin, async (req, res) => {
  try {
    const { query } = req.params;
    pingOneUserService.initialize();
    const result = await pingOneUserService.searchUsers(query);
    const raw = result._embedded?.users || [];
    res.json({ users: raw.map(normalizePingOneUser) });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// PATCH /api/users/:userId/attributes — update PingOne custom attributes (may_act). Admin only.
router.patch('/:userId/attributes', authenticateToken, requireScopes(['write']), requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { mayAct } = req.body;

    pingOneUserService.initialize();

    if (mayAct !== undefined) {
      if (mayAct === null) {
        await pingOneUserService.setMayActAttribute(userId, null);
      } else {
        const { sub } = mayAct;
        if (!sub) return res.status(400).json({ error: 'mayAct.sub is required' });
        await pingOneUserService.setMayActAttribute(userId, { sub });
      }
    }

    res.json({ success: true, userId });
  } catch (error) {
    console.error('PATCH user attributes error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
