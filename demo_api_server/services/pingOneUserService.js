/**
 * pingOneUserService.js
 *
 * PingOne Management API service for user provisioning and mayAct setup.
 * Uses worker app credentials for administrative operations.
 */

const axios = require('axios');
const configStore = require('./configStore');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');
const { logger, LOG_CATEGORIES } = require('../utils/logger');
const { getTokenEndpoint } = require('./oauthEndpointResolver');
const { authMethodOrder, isInvalidClientError } = require('./pingOneTokenAuth');

// PingOne admin roles every demo login persona needs. Without one, PingOne
// denies interactive Management-API logins outright ("User does not have any
// role assignments"), which breaks the pingone-admin MCP server and admin
// console access for demo users.
const DEMO_ADMIN_ROLE_NAMES = ['Environment Admin', 'Identity Data Admin'];

class PingOneUserService {
  constructor() {
    this.baseUrl = null;
    this.environmentId = null;
    this.workerAppClientId = null;
    this.workerAppClientSecret = null;
    this.adminPopulationId = null;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Initialize the service with configuration
   */
  initialize() {
    const region = process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
    const environmentId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
    const workerAppClientId = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID || process.env.PINGONE_WORKER_CLIENT_ID || configStore.getEffective('pingone_worker_token_client_id') || configStore.getEffective('PINGONE_MGMT_CLIENT_ID') || configStore.getEffective('PINGONE_MANAGEMENT_CLIENT_ID');
    const workerAppClientSecret = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET || process.env.PINGONE_WORKER_CLIENT_SECRET || configStore.getEffective('pingone_worker_token_client_secret') || configStore.getEffective('PINGONE_MGMT_CLIENT_SECRET') || configStore.getEffective('PINGONE_MANAGEMENT_CLIENT_SECRET');
    const adminPopulationId = configStore.getEffective('admin_population_id');

    if (!environmentId || !workerAppClientId || !workerAppClientSecret) {
      throw new Error('PingOne user service requires environment ID and worker app credentials');
    }

    this.baseUrl = `https://api.pingone.${region}/v1/environments/${environmentId}`;
    this.region = region;
    this.environmentId = environmentId;
    this.workerAppClientId = workerAppClientId;
    this.workerAppClientSecret = workerAppClientSecret;
    this.adminPopulationId = adminPopulationId;

    logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'PingOne user service initialized', {
      region,
      environmentId,
      hasWorkerCredentials: true,
      adminPopulationId: adminPopulationId || 'not_set'
    });
  }

  /**
   * Get or refresh worker app access token
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const tokenEndpoint = getTokenEndpoint();
      const configured = (process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD || configStore.getEffective('pingone_mgmt_token_auth_method') || 'basic').toLowerCase();
      const order = authMethodOrder(configured);

      // Never log the request body — it carries client_secret in the `post` method.
      logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'Getting worker app token', {
        environmentId: this.environmentId,
        configuredAuthMethod: configured,
        hasClientId: !!this.workerAppClientId,
        hasClientSecret: !!this.workerAppClientSecret,
        clientIdPrefix: this.workerAppClientId?.substring(0, 8),
      });

      // Self-heal a basic/post mismatch: try the configured method, then the alternate on
      // an invalid_client rejection (PingOne — not our config — owns which method the app
      // accepts). A stale `pingone_mgmt_token_auth_method` no longer wedges the worker token.
      let response, usedMethod;
      for (let i = 0; i < order.length; i++) {
        const method = order[i];
        let body = 'grant_type=client_credentials';
        const axiosConfig = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
        if (method === 'post') {
          body += `&client_id=${encodeURIComponent(this.workerAppClientId)}&client_secret=${encodeURIComponent(this.workerAppClientSecret)}`;
        } else {
          axiosConfig.auth = { username: this.workerAppClientId, password: this.workerAppClientSecret };
        }
        try {
          response = await axios.post(tokenEndpoint, body, axiosConfig);
          usedMethod = method;
          break;
        } catch (err) {
          const canRetry = isInvalidClientError(err) && i < order.length - 1;
          if (!canRetry) throw err;
          logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, `Worker token auth '${method}' rejected (invalid_client) — retrying with '${order[i + 1]}'`);
        }
      }

      this.accessToken = response.data.access_token;
      const expiresIn = Math.max(response.data.expires_in || 300, 60);
      this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;

      logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'Worker app token obtained', {
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type,
        authMethod: usedMethod,
      });

      return this.accessToken;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to get worker app token', {
        error: error.message,
        status: error.response?.status
      });
      throw new Error('Failed to authenticate with PingOne Management API');
    }
  }

  /**
   * Make authenticated API request to PingOne
   */
  async makeRequest(method, path, data = null, options = {}) {
    const token = await this.getAccessToken();
    
    const config = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      ...options
    };

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'PingOne API request failed', {
        method,
        path,
        status: error.response?.status,
        error: error.response?.data?.error || error.message
      });
      
      if (error.response?.status === 401) {
        // Token might be expired, clear it and retry once
        this.accessToken = null;
        this.tokenExpiry = null;
        
        const token = await this.getAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        
        try {
          const response = await axios(config);
          return response.data;
        } catch (retryError) {
          throw new Error(`PingOne API request failed: ${retryError.response?.data?.error?.message || retryError.message}`, { cause: sanitizeAxiosCause(retryError) });
        }
      }

      throw new Error(`PingOne API request failed: ${error.response?.data?.error?.message || error.message}`, { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Idempotently ensure a user carries the demo admin role assignments
   * (Environment Admin + Identity Data Admin, ENVIRONMENT-scoped).
   *
   * Without at least one admin role, PingOne refuses interactive
   * Management-API logins ("Request denied: User does not have any role
   * assignments") — e.g. the pingone-admin MCP server browser login.
   *
   * The worker can only grant roles it holds itself; failures are reported
   * per-role, never thrown.
   *
   * @param {string} userId PingOne user id
   * @returns {Promise<{assigned: string[], existing: string[], failed: Array<{role: string, error: string}>}>}
   */
  async ensureAdminRoleAssignments(userId) {
    const result = { assigned: [], existing: [], failed: [] };

    // Resolve role name → id once per process (org-level endpoint, not under /environments)
    if (!this._roleIdsByName) {
      const token = await this.getAccessToken();
      const { data } = await axios.get(`https://api.pingone.${this.region}/v1/roles`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });
      this._roleIdsByName = {};
      for (const r of data._embedded?.roles || []) this._roleIdsByName[r.name] = r.id;
    }

    let current = [];
    try {
      const list = await this.makeRequest('GET', `/users/${userId}/roleAssignments`);
      current = list._embedded?.roleAssignments || [];
    } catch (err) {
      logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'Could not list role assignments', { userId, error: err.message });
    }

    for (const roleName of DEMO_ADMIN_ROLE_NAMES) {
      const roleId = this._roleIdsByName[roleName];
      if (!roleId) {
        result.failed.push({ role: roleName, error: 'role not found in /v1/roles' });
        continue;
      }
      if (current.some(ra => ra.role?.id === roleId)) {
        result.existing.push(roleName);
        continue;
      }
      try {
        await this.makeRequest('POST', `/users/${userId}/roleAssignments`, {
          role: { id: roleId },
          scope: { id: this.environmentId, type: 'ENVIRONMENT' },
        });
        result.assigned.push(roleName);
      } catch (err) {
        // Duplicate assignment race is success
        if (/unique|already|exist|duplicate/i.test(err.message)) {
          result.existing.push(roleName);
        } else {
          result.failed.push({ role: roleName, error: err.message });
        }
      }
    }

    logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'Admin role assignments ensured', { userId, ...result });
    return result;
  }

  /**
   * Create a new PingOne user
   */
  async createPingOneUser(userData) {
    const {
      email,
      username,
      firstName,
      lastName,
      password,
      phone,
      address,
      role = 'customer'
    } = userData;

    // Validate required fields
    if (!email || !username || !firstName || !lastName || !password) {
      throw new Error('Email, username, firstName, lastName, and password are required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const userPayload = {
      username,
      email,
      name: {
        given: firstName,
        family: lastName
      },
      enabled: true,
      population: role === 'admin' && this.adminPopulationId 
        ? { id: this.adminPopulationId }
        : undefined
    };

    // Add optional fields
    if (phone) {
      userPayload.phone = phone;
    }

    if (address) {
      userPayload.address = address;
    }

    logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'Creating PingOne user', {
      email,
      username,
      role,
      populationId: userPayload.population?.id
    });

    try {
      const user = await this.makeRequest('POST', '/users', userPayload);
      
      // Set password
      await this.setUserPassword(user.id, password);
      
      // Set mayAct attribute for admin users
      if (role === 'admin') {
        await this.setMayActAttribute(user.id, {
          enabled: true,
          clientIds: [configStore.getEffective('pingone_core_client_id')]
        });
      }

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'PingOne user created successfully', {
        userId: user.id,
        email,
        role
      });

      return user;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to create PingOne user', {
        email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update user password
   */
  async setUserPassword(userId, password) {
    try {
      const token = await this.getAccessToken();
      await axios({
        method: 'PUT',
        url: `${this.baseUrl}/users/${userId}/password`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.pingidentity.password.set+json',
        },
        data: { value: password },
      });

      logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'User password set successfully', {
        userId
      });
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to set user password', {
        userId,
        error: error.message
      });
      throw new Error(`Failed to set user password: ${error.message}`);
    }
  }

  /**
   * Set mayAct custom attribute on user
   */
  async setMayActAttribute(userId, mayActConfig) {
    try {
      // PingOne custom JSON user attributes (added via Schema → User Schema) are
      // written at the TOP LEVEL by name with a flat PATCH body — NOT under /custom
      // and NOT as a JSON-Patch op array (the proven shape — see
      // pingOneUserService.mayAct.test.js). A null value clears the attribute.
      await this.makeRequest('PATCH', `/users/${userId}`, { mayAct: mayActConfig });

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'mayAct attribute set successfully', {
        userId,
        mayActConfig
      });
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to set mayAct attribute', {
        userId,
        error: error.message
      });
      throw new Error(`Failed to set mayAct attribute: ${error.message}`);
    }
  }

  /**
   * Set the `delegatedTo` custom attribute (family-delegation lane) on a user.
   * Flat top-level PATCH (same rule as mayAct). `subs` is an array of delegate
   * sub strings; pass [] or null to clear.
   * @param {string} userId
   * @param {string[]|null} subs
   */
  async setDelegatedToAttribute(userId, subs) {
    try {
      const value = Array.isArray(subs) && subs.length > 0 ? subs : null;
      await this.makeRequest('PATCH', `/users/${userId}`, { delegatedTo: value });
      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'delegatedTo attribute set', { userId, count: value ? value.length : 0 });
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to set delegatedTo attribute', { userId, error: error.message });
      throw new Error(`Failed to set delegatedTo attribute: ${error.message}`);
    }
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId) {
    try {
      const user = await this.makeRequest('GET', `/users/${userId}`);
      
      // Include population information
      const populatedUser = await this.makeRequest('GET', `/users/${userId}?populate=true`);
      
      logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'User profile retrieved', {
        userId
      });

      return populatedUser;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to get user profile', {
        userId,
        error: error.message
      });
      throw new Error(`Failed to get user profile: ${error.message}`);
    }
  }

  /**
   * Update user
   */
  async updatePingOneUser(userId, updates) {
    try {
      const user = await this.makeRequest('PATCH', `/users/${userId}`, updates);

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'User updated successfully', {
        userId
      });

      return user;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to update user', {
        userId,
        error: error.message
      });
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  /**
   * Delete user
   */
  async deletePingOneUser(userId) {
    try {
      await this.makeRequest('DELETE', `/users/${userId}`);

      logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'User deleted successfully', {
        userId
      });

      return true;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to delete user', {
        userId,
        error: error.message
      });
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  /**
   * List users (with optional filtering)
   */
  async listUsers(options = {}) {
    const { limit = 100, filter } = options;
    
    try {
      let path = '/users';
      const params = [];
      
      if (limit) {
        params.push(`limit=${limit}`);
      }
      
      if (filter) {
        params.push(`filter=${encodeURIComponent(filter)}`);
      }
      
      if (params.length > 0) {
        path += '?' + params.join('&');
      }

      const response = await this.makeRequest('GET', path);
      
      logger.debug(LOG_CATEGORIES.USER_MANAGEMENT, 'Users listed', {
        count: response._embedded?.users?.length || 0
      });

      return response;
    } catch (error) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to list users', {
        error: error.message
      });
      throw new Error(`Failed to list users: ${error.message}`);
    }
  }

  /**
   * Search users by email or username
   */
  async searchUsers(query) {
    if (!query || query.length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }

    const filter = `email sw "${query}" or username sw "${query}"`;
    return this.listUsers({ filter, limit: 50 });
  }

}

// Export singleton instance
module.exports = new PingOneUserService();
