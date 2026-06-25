/**
 * PingOne Scope Update Service
 * 
 * Utility to fix scope configuration in existing PingOne environments.
 * Handles renaming incorrect scope names to Phase 69.1 standardized names.
 * 
 * Enhanced with silent worker token acquisition using configStore.
 */

'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');
const { getTokenEndpoint } = require('./oauthEndpointResolver');

class PingOneScopeUpdateService {
  constructor() {
    this.baseURL = null;
    this.workerToken = null;
    this.envId = null;
    this.region = null;
    this.tokenCache = {
      token: null,
      expiresAt: null,
      ttl: 30 * 60 * 1000 // 30 minutes TTL
    };
  }

  /**
   * Get or refresh worker token with caching
   * Returns cached token if valid, otherwise fetches new token
   */
  async getOrRefreshWorkerToken(envId, region = 'com') {
    const now = Date.now();
    
    // Check if cached token is still valid
    if (this.tokenCache.token && this.tokenCache.expiresAt && now < this.tokenCache.expiresAt) {
      this.workerToken = this.tokenCache.token;
      console.log('[PingOneScopeUpdateService] Using cached worker token');
      return { success: true, cached: true, message: 'Using cached worker token' };
    }
    
    // Fetch new token
    try {
      this.envId = envId;
      this.region = region;
      this.baseURL = `https://api.pingone.${region}/${envId}`;
      
      const workerClientId = configStore.getEffective('pingone_worker_client_id');
      const workerClientSecret = configStore.getEffective('pingone_authorize_worker_client_secret');
      
      if (!workerClientId || !workerClientSecret) {
        throw new Error('Worker client credentials not configured');
      }
      
      const tokenUrl = getTokenEndpoint() || `https://auth.pingone.${region}/${envId}/as/token`;
      const response = await axios.post(
        tokenUrl,
        'grant_type=client_credentials',
        {
          auth: { username: workerClientId, password: workerClientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );

      // Cache the new token
      this.tokenCache.token = response.data.access_token;
      this.tokenCache.expiresAt = now + this.tokenCache.ttl;
      this.workerToken = this.tokenCache.token;
      
      console.log(`[PingOneScopeUpdateService] Refreshed worker token for client: ${workerClientId}`);
      return { success: true, cached: false, message: 'Refreshed worker token' };
    } catch (error) {
      throw new Error(`Failed to obtain worker token: ${error.response?.data?.error_description || error.message}`, { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Validate credentials without fetching token
   */
  validateCredentials() {
    const workerClientId = configStore.getEffective('pingone_worker_client_id');
    const workerClientSecret = configStore.getEffective('pingone_authorize_worker_client_secret');
    
    if (!workerClientId || !workerClientSecret) {
      return { valid: false, message: 'Worker client credentials not configured' };
    }
    
    return { valid: true, message: 'Worker client credentials configured' };
  }

  /**
   * Initialize with automatic worker token acquisition
   */
  async initialize(envId, region = 'com') {
    try {
      return await this.getOrRefreshWorkerToken(envId, region);
    } catch (error) {
      throw new Error(`Failed to initialize: ${error.response?.data?.error_description || error.message}`, { cause: error });
    }
  }

  /**
   * Legacy initialize method for backward compatibility
   * @deprecated Use initialize() without parameters for silent token acquisition
   */
  async initializeWithCredentials(envId, workerClientId, workerClientSecret, region = 'com') {
    try {
      this.envId = envId;
      this.region = region;
      this.baseURL = `https://api.pingone.${region}/${envId}`;
      
      // Get worker token with provided credentials
      const tokenUrl = getTokenEndpoint() || `https://auth.pingone.${region}/${envId}/as/token`;
      const response = await axios.post(
        tokenUrl,
        'grant_type=client_credentials',
        {
          auth: { username: workerClientId, password: workerClientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );
      
      this.workerToken = response.data.access_token;
      return { success: true, message: 'Authenticated with PingOne' };
    } catch (error) {
      throw new Error(`Failed to initialize: ${error.response?.data?.error_description || error.message}`, { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Make authenticated request to PingOne Management API
   */
  async makeRequest(method, endpoint, data = null) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.workerToken}`,
      'Content-Type': 'application/json',
    };

    try {
      const config = { method, url, headers };
      if (data) config.data = data;
      const response = await axios(config);
      return response;
    } catch (error) {
      const errorMessage = error.response?.data?.details?.[0]?.message || 
                          error.response?.data?.message || 
                          error.message;
      throw new Error(`${method} ${endpoint} failed: ${errorMessage}`, { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Find Main Banking Resource Server
   */
  async findMainBankingResource() {
    try {
      const response = await this.makeRequest('GET', '/resources');
      const resources = response.data._embedded?.resources || [];
      
      const mainBanking = resources.find(r => 
        r.name && (r.name.toLowerCase().includes('banking') || r.name.toLowerCase().includes('super'))
      );
      
      if (!mainBanking) {
        throw new Error('Main Banking Resource Server not found');
      }
      
      return mainBanking;
    } catch (error) {
      throw new Error(`Failed to find resource: ${error.message}`, { cause: error });
    }
  }

  /**
   * Get scopes on a resource
   */
  async getResourceScopes(resourceId) {
    try {
      const response = await this.makeRequest('GET', `/resources/${resourceId}/scopes`);
      return response.data._embedded?.scopes || [];
    } catch (error) {
      throw new Error(`Failed to get scopes: ${error.message}`, { cause: error });
    }
  }

  /**
   * Delete a scope
   */
  async deleteScope(resourceId, scopeName) {
    try {
      // First, find the scope ID
      const scopes = await this.getResourceScopes(resourceId);
      const scope = scopes.find(s => s.name === scopeName);
      
      if (!scope) {
        return { success: false, message: `Scope '${scopeName}' not found` };
      }

      await this.makeRequest('DELETE', `/resources/${resourceId}/scopes/${scope.id}`);
      return { success: true, scopeName, message: `Deleted scope '${scopeName}'` };
    } catch (error) {
      return { success: false, scopeName, message: error.message };
    }
  }

  /**
   * Create a scope
   */
  async createScope(resourceId, scopeName, description) {
    try {
      const data = {
        name: scopeName,
        description: description,
        schema: 'urn:pingone:common:scope'
      };

      const response = await this.makeRequest('POST', `/resources/${resourceId}/scopes`, data);
      return { success: true, scopeName, message: `Created scope '${scopeName}'` };
    } catch (error) {
      // If scope already exists, that's OK
      if (error.message.includes('Duplicate')) {
        return { success: true, scopeName, message: `Scope '${scopeName}' already exists` };
      }
      return { success: false, scopeName, message: error.message };
    }
  }

  /**
   * Get all applications
   */
  async getApplications() {
    try {
      const response = await this.makeRequest('GET', '/applications');
      return response.data._embedded?.applications || [];
    } catch (error) {
      throw new Error(`Failed to get applications: ${error.message}`, { cause: error });
    }
  }

  /**
   * Get application resource scopes
   */
  async getApplicationResourceScopes(appId, resourceId) {
    try {
      const response = await this.makeRequest('GET', `/applications/${appId}/resourceGrants?filter=resource.id eq "${resourceId}"`);
      const grants = response.data._embedded?.resourceGrants || [];
      return grants.flatMap(grant => grant.scopes || []);
    } catch (error) {
      return [];
    }
  }

  /**
   * Grant scopes to application
   */
  async grantScopesToApplication(appId, resourceId, scopeNames) {
    try {
      const data = {
        scopes: scopeNames
      };

      await this.makeRequest('PUT', `/applications/${appId}/resourceGrants/${resourceId}`, data);
      return { success: true, appId, scopeNames };
    } catch (error) {
      return { success: false, appId, message: error.message };
    }
  }

  /**
   * Fix scope configuration (main update function)
   * Handles: agent:invoke → ai:agent:read
   */
  async fixScopeConfiguration() {
    const steps = [];
    const results = {
      success: true,
      steps: steps,
      summary: null
    };

    try {
      // Ensure we have a valid token (uses caching)
      if (!this.workerToken || !this.tokenCache.expiresAt || Date.now() >= this.tokenCache.expiresAt) {
        steps.push({ 
          icon: '🔐', 
          message: 'Validating worker credentials...' 
        });
        await this.getOrRefreshWorkerToken(this.envId, this.region);
        steps.push({ 
          icon: '✅', 
          message: 'Worker token obtained' 
        });
      }
      // Step 1: Find Main Banking Resource
      steps.push({ 
        icon: '🔍', 
        message: 'Finding Main Banking Resource Server...' 
      });
      
      const resource = await this.findMainBankingResource();
      steps.push({ 
        icon: '✅', 
        message: `Found: ${resource.name} (${resource.id})` 
      });

      // Step 2: Get existing scopes
      steps.push({ 
        icon: '🔍', 
        message: 'Checking for incorrect scopes...' 
      });
      
      const scopes = await this.getResourceScopes(resource.id);
      const hasOldScope = scopes.some(s => s.name === 'agent:invoke');
      const hasNewScope = scopes.some(s => s.name === 'ai:agent:read');

      if (!hasOldScope && hasNewScope) {
        steps.push({ 
          icon: '✅', 
          message: 'Correct scope already exists, nothing to fix' 
        });
        return results;
      }

      if (!hasOldScope && !hasNewScope) {
        steps.push({ 
          icon: '⚠️', 
          message: 'Neither old nor new scope found, creating new scope...' 
        });
        
        const createResult = await this.createScope(
          resource.id, 
          'ai:agent:read', 
          'Agent delegation scope (Phase 69.1 standardized)'
        );
        steps.push({ 
          icon: createResult.success ? '✅' : '❌', 
          message: createResult.message 
        });

        if (!createResult.success) {
          results.success = false;
          results.summary = 'Failed to create scope';
          return results;
        }
      } else if (hasOldScope && !hasNewScope) {
        // Create new scope first
        steps.push({ 
          icon: '➕', 
          message: 'Creating new scope ai:agent:read...' 
        });
        
        const createResult = await this.createScope(
          resource.id, 
          'ai:agent:read', 
          'Agent delegation scope (Phase 69.1 standardized)'
        );
        steps.push({ 
          icon: createResult.success ? '✅' : '⚠️', 
          message: createResult.message 
        });

        // Delete old scope
        steps.push({ 
          icon: '🗑️', 
          message: 'Removing old scope agent:invoke...' 
        });
        
        const deleteResult = await this.deleteScope(resource.id, 'agent:invoke');
        steps.push({ 
          icon: deleteResult.success ? '✅' : '⚠️', 
          message: deleteResult.message 
        });
      } else if (hasOldScope && hasNewScope) {
        // Both exist - just remove old one
        steps.push({ 
          icon: '🗑️', 
          message: 'Both scopes exist, removing old scope agent:invoke...' 
        });
        
        const deleteResult = await this.deleteScope(resource.id, 'agent:invoke');
        steps.push({ 
          icon: deleteResult.success ? '✅' : '⚠️', 
          message: deleteResult.message 
        });
      }

      // Step 3: Update application scope grants
      steps.push({ 
        icon: '🔍', 
        message: 'Updating application scope grants...' 
      });
      
      const applications = await this.getApplications();
      const relevantApps = applications.filter(a => 
        a.name && (a.name.includes('User') || a.name.includes('user') || a.name.includes('Customer'))
      );

      for (const app of relevantApps) {
        steps.push({ 
          icon: '🔄', 
          message: `Checking ${app.name}...` 
        });
        
        const currentScopes = await this.getApplicationResourceScopes(app.id, resource.id);
        
        // Check if app has old scope
        const hasOldAppScope = currentScopes.includes('agent:invoke');
        const hasNewAppScope = currentScopes.includes('ai:agent:read');

        if (hasOldAppScope || !hasNewAppScope) {
          const scopesToGrant = currentScopes.filter(s => s !== 'agent:invoke');
          if (!scopesToGrant.includes('ai:agent:read')) {
            scopesToGrant.push('ai:agent:read');
          }

          const grantResult = await this.grantScopesToApplication(app.id, resource.id, scopesToGrant);
          steps.push({ 
            icon: grantResult.success ? '✅' : '❌', 
            message: grantResult.success 
              ? `Updated ${app.name} with correct scopes` 
              : `Failed to update ${app.name}: ${grantResult.message}` 
          });

          if (!grantResult.success) {
            results.success = false;
          }
        } else {
          steps.push({ 
            icon: '✅', 
            message: `${app.name} already has correct scopes` 
          });
        }
      }

      results.summary = results.success 
        ? '✅ Scope configuration updated successfully' 
        : '⚠️ Some updates failed';

      return results;
    } catch (error) {
      steps.push({ 
        icon: '❌', 
        message: `Error: ${error.message}` 
      });
      results.success = false;
      results.summary = error.message;
      return results;
    }
  }
}

module.exports = PingOneScopeUpdateService;
