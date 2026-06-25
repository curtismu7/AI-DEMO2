/**
 * selfServiceUsers.js
 *
 * Self-service user provisioning REST API endpoints.
 * Allows users to create customer and admin accounts with profile data.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const pingOneUserService = require('../services/pingOneUserService');
const { logger, LOG_CATEGORIES } = require('../utils/logger');
const { OAuthError, OAUTH_ERROR_TYPES } = require('../middleware/oauthErrorHandler');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg);
    throw new OAuthError(
      OAUTH_ERROR_TYPES.INVALID_REQUEST,
      `Validation failed: ${errorMessages.join(', ')}`,
      400
    );
  }
  next();
};

/**
 * POST /api/self-service/users
 * Create a new PingOne user with profile data
 */
router.post('/',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('username')
      .isLength({ min: 3, max: 50 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Username must be 3-50 characters, alphanumeric, underscore, or hyphen only'),
    body('firstName')
      .isLength({ min: 1, max: 50 })
      .trim()
      .withMessage('First name is required (max 50 characters)'),
    body('lastName')
      .isLength({ min: 1, max: 50 })
      .trim()
      .withMessage('Last name is required (max 50 characters)'),
    body('password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must be at least 8 characters with uppercase, lowercase, and number'),
    body('role')
      .optional()
      .isIn(['customer', 'admin'])
      .withMessage('Role must be either "customer" or "admin"'),
    body('phone')
      .optional()
      .isMobilePhone()
      .withMessage('Invalid phone number format'),
    body('address')
      .optional()
      .isObject()
      .withMessage('Address must be an object'),
    body('address.street')
      .optional()
      .isLength({ max: 100 })
      .withMessage('Street address max 100 characters'),
    body('address.city')
      .optional()
      .isLength({ max: 50 })
      .withMessage('City max 50 characters'),
    body('address.state')
      .optional()
      .isLength({ max: 50 })
      .withMessage('State max 50 characters'),
    body('address.zipCode')
      .optional()
      .isPostalCode()
      .withMessage('Invalid ZIP code format'),
    body('address.country')
      .optional()
      .isLength({ min: 2, max: 2 })
      .withMessage('Country must be 2-letter ISO code')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        email,
        username,
        firstName,
        lastName,
        password,
        role = 'customer',
        phone,
        address
      } = req.body;

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'Creating new user via self-service', {
        email,
        username,
        role,
        requestIp: req.ip
      });

      // Initialize the service
      pingOneUserService.initialize();

      // Check if user already exists
      try {
        const existingUsers = await pingOneUserService.searchUsers(email);
        if (existingUsers._embedded?.users?.length > 0) {
          throw new OAuthError(
            OAUTH_ERROR_TYPES.INVALID_REQUEST,
            'A user with this email already exists',
            409
          );
        }
      } catch (searchError) {
        // If search fails, continue with creation (might be permissions issue)
        logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'Could not check for existing users', {
          email,
          error: searchError.message
        });
      }

      // Create the user
      const user = await pingOneUserService.createPingOneUser({
        email,
        username,
        firstName,
        lastName,
        password,
        role,
        phone,
        address
      });

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'User created successfully via self-service', {
        userId: user.id,
        email,
        username,
        role
      });

      // Grant the demo admin role assignments so the new user can complete
      // interactive Management-API logins (pingone-admin MCP, admin console).
      // Non-fatal — the user is created either way.
      let adminRoles = null;
      try {
        adminRoles = await pingOneUserService.ensureAdminRoleAssignments(user.id);
      } catch (roleError) {
        logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'Could not assign admin roles to new user', {
          userId: user.id,
          error: roleError.message
        });
      }

      res.status(201).json({
        message: 'User created successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          enabled: user.enabled,
          role,
          createdAt: user.createdAt
        },
        adminRoles
      });
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to create user via self-service', {
        error: error.message,
        body: req.body
      });

      if (error instanceof OAuthError) {
        return res.status(error.statusCode || 400).json({
          error: error.type || 'creation_failed',
          error_description: error.message,
          timestamp: new Date().toISOString()
        });
      }

      res.status(500).json({
        error: 'creation_failed',
        error_description: error.message || 'Failed to create user',
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * GET /api/self-service/users/me
 * Get current user's PingOne profile
 */
router.get('/me', async (req, res) => {
  try {
    // This endpoint requires authentication - user must be logged in
    if (!req.user || !req.user.id) {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        'Authentication required to access user profile',
        401
      );
    }

    logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'Fetching user profile', {
      userId: req.user.id
    });

    // Initialize the service
    pingOneUserService.initialize();

    // Get user profile
    const userProfile = await pingOneUserService.getUserProfile(req.user.id);

    res.json({
      user: {
        id: userProfile.id,
        email: userProfile.email,
        username: userProfile.username,
        name: userProfile.name,
        enabled: userProfile.enabled,
        phone: userProfile.phone,
        address: userProfile.address,
        population: userProfile.population,
        createdAt: userProfile.createdAt,
        updatedAt: userProfile.updatedAt
      },
      role: req.user.role,
      scopes: req.user.scopes
    });
  } catch (error) {
    logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to get user profile', {
      userId: req.user?.id,
      error: error.message
    });

    if (error instanceof OAuthError) {
      return res.status(error.statusCode || 401).json({
        error: error.type || 'profile_fetch_failed',
        error_description: error.message,
        timestamp: new Date().toISOString()
      });
    }

    res.status(500).json({
      error: 'profile_fetch_failed',
      error_description: error.message || 'Failed to get user profile',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * PATCH /api/self-service/users/me
 * Update the current user's profile in PingOne
 */
router.patch('/me',
  [
    body('firstName').optional().isLength({ min: 1, max: 50 }).trim().withMessage('First name max 50 characters'),
    body('lastName').optional().isLength({ min: 1, max: 50 }).trim().withMessage('Last name max 50 characters'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email required'),
    body('phone').optional().isLength({ max: 30 }).trim(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'authentication_required', error_description: 'Authentication required' });
      }

      const { firstName, lastName, email, phone } = req.body;
      const patch = {};
      if (firstName !== undefined || lastName !== undefined) {
        patch.name = {};
        if (firstName !== undefined) patch.name.given = firstName;
        if (lastName !== undefined) patch.name.family = lastName;
      }
      if (email !== undefined) patch.email = email;
      if (phone !== undefined) patch.phone = phone;

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'No updatable fields provided' });
      }

      pingOneUserService.initialize();
      const updated = await pingOneUserService.updatePingOneUser(req.user.id, patch);

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'User profile updated', { userId: req.user.id });

      res.json({
        message: 'Profile updated successfully',
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          phone: updated.phone,
        }
      });
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to update profile', { userId: req.user?.id, error: error.message });
      res.status(500).json({ error: 'update_failed', error_description: error.message || 'Failed to update profile' });
    }
  }
);

/**
 * DELETE /api/self-service/users/:userId
 * Delete a PingOne user (admin only)
 */
router.delete('/:userId', async (req, res) => {
  try {
    // This endpoint requires authentication and admin role
    if (!req.user || !req.user.id) {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        'Authentication required to delete users',
        401
      );
    }

    if (req.user.role !== 'admin') {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
        'Admin role required to delete users',
        403
      );
    }

    const { userId } = req.params;

    if (!userId) {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.INVALID_REQUEST,
        'User ID is required',
        400
      );
    }

    logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'Deleting user', {
      targetUserId: userId,
      adminUserId: req.user.id
    });

    // Initialize the service
    pingOneUserService.initialize();

    // Prevent self-deletion
    if (userId === req.user.id) {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.INVALID_REQUEST,
        'Cannot delete your own account',
        400
      );
    }

    await pingOneUserService.deletePingOneUser(userId);

    res.json({
      message: 'User deleted successfully'
    });
  } catch (error) {
    logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to delete user', {
      targetUserId: req.params?.userId,
      adminUserId: req.user?.id,
      error: error.message
    });

    if (error instanceof OAuthError) {
      return res.status(error.statusCode || 403).json({
        error: error.type || 'user_deletion_failed',
        error_description: error.message,
        timestamp: new Date().toISOString()
      });
    }

    res.status(500).json({
      error: 'user_deletion_failed',
      error_description: error.message || 'Failed to delete user',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/self-service/users
 * List users (admin only)
 */
router.get('/', async (req, res) => {
  try {
    // This endpoint requires authentication and admin role
    if (!req.user || !req.user.id) {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        'Authentication required to list users',
        401
      );
    }

    if (req.user.role !== 'admin') {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
        'Admin role required to list users',
        403
      );
    }

    const { limit = 50, search } = req.query;

    logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'Listing users', {
      adminUserId: req.user.id,
      limit,
      search
    });

    // Initialize the service
    pingOneUserService.initialize();

    let result;
    if (search) {
      result = await pingOneUserService.searchUsers(search);
    } else {
      result = await pingOneUserService.listUsers({ limit: parseInt(limit) });
    }

    const users = result._embedded?.users || [];

    res.json({
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        enabled: user.enabled,
        phone: user.phone,
        population: user.population,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })),
      total: users.length,
      limit: parseInt(limit)
    });
  } catch (error) {
    logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to list users', {
      adminUserId: req.user?.id,
      error: error.message
    });

    if (error instanceof OAuthError) {
      return res.status(error.statusCode || 403).json({
        error: error.type || 'user_list_failed',
        error_description: error.message,
        timestamp: new Date().toISOString()
      });
    }

    res.status(500).json({
      error: 'user_list_failed',
      error_description: error.message || 'Failed to list users',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
