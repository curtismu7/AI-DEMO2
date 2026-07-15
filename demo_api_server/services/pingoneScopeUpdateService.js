/**
 * PingOne Scope Update Service
 *
 * Non-destructive repair for PingOne resource-server scopes. Adds any scopes
 * missing from scope-topology.json (SSOT) onto the Demo API, Agent Gateway,
 * and MCP Server resources. Never renames or deletes scopes — agent:invoke and
 * ai:agent:read are both valid on different audiences.
 *
 * Uses silent worker-token acquisition via configStore.
 */

'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const scopeTopology = require('./scopeTopology');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');
const { getTokenEndpoint } = require('./oauthEndpointResolver');

/** Resolve live PingOne audiences, preferring runtime config over topology defaults. */
function resolveAudienceTargets() {
  const audiences = scopeTopology.audiences();
  return [
    {
      key: 'api',
      label: scopeTopology.provisionedResourceName('Super Banking API'),
      audience:
        configStore.getEffective('pingone_audience_enduser') ||
        process.env.ENDUSER_AUDIENCE ||
        audiences.enduser,
      scopes: scopeTopology.resourceScopes('Super Banking API'),
    },
    {
      key: 'agent',
      label: scopeTopology.provisionedResourceName('Super Banking Agent Gateway'),
      audience:
        configStore.getEffective('pingone_resource_agent_gateway_uri') ||
        process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI ||
        audiences.agentGateway,
      scopes: scopeTopology.resourceScopes('Super Banking Agent Gateway'),
    },
    {
      key: 'mcp',
      label: scopeTopology.provisionedResourceName('Super Banking MCP Server'),
      audience:
        configStore.getEffective('pingone_resource_mcp_server_uri') ||
        process.env.PINGONE_RESOURCE_MCP_SERVER_URI ||
        audiences.mcpServer,
      scopes: scopeTopology.resourceScopes('Super Banking MCP Server'),
    },
  ];
}

/** Match a PingOne resource by audience URI or provisioned/display name. */
function findResourceForTarget(resources, target) {
  const byAudience = resources.find((r) => {
    const aud = r.audience || (r.accessControl && r.accessControl.audience) || '';
    return aud === target.audience;
  });
  if (byAudience) return byAudience;
  const label = String(target.label || '').toLowerCase();
  const key = String(target.key || '').toLowerCase();
  return resources.find((r) => {
    const name = String(r.name || '').toLowerCase();
    return (label && name === label) || (key && name.includes(key));
  });
}

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
   * Add any scopes missing from scope-topology.json onto core resource servers.
   * Non-destructive: only creates missing scopes; never renames or deletes.
   */
  async fixScopeConfiguration() {
    const steps = [];
    const results = {
      success: true,
      steps,
      summary: null,
    };

    try {
      if (!this.workerToken || !this.tokenCache.expiresAt || Date.now() >= this.tokenCache.expiresAt) {
        steps.push({ icon: '🔐', message: 'Validating worker credentials...' });
        await this.getOrRefreshWorkerToken(this.envId, this.region);
        steps.push({ icon: '✅', message: 'Worker token obtained' });
      }

      const targets = resolveAudienceTargets();
      steps.push({
        icon: '✅',
        message: `Checking ${targets.length} resource servers against scope-topology.json (add-only)`,
      });

      const listResponse = await this.makeRequest('GET', '/resources');
      const resources = listResponse.data._embedded?.resources || [];
      let addedCount = 0;
      let missingRsCount = 0;

      for (const target of targets) {
        const resource = findResourceForTarget(resources, target);
        if (!resource) {
          missingRsCount += 1;
          results.success = false;
          steps.push({
            icon: '❌',
            message: `${target.label} not found (audience ${target.audience})`,
          });
          continue;
        }

        steps.push({
          icon: '✅',
          message: `Found ${resource.name} (${resource.id})`,
        });

        const existing = await this.getResourceScopes(resource.id);
        const existingNames = existing.map((s) => s.name || s.value || s);
        const toAdd = target.scopes.filter((s) => !existingNames.includes(s));

        if (toAdd.length === 0) {
          steps.push({
            icon: '✅',
            message: `${resource.name}: all ${target.scopes.length} expected scopes present`,
          });
          continue;
        }

        steps.push({
          icon: '⚠️',
          message: `${resource.name}: adding ${toAdd.length} missing scope(s): ${toAdd.join(', ')}`,
        });

        for (const scopeName of toAdd) {
          const createResult = await this.createScope(
            resource.id,
            scopeName,
            `Scope: ${scopeName} (from scope-topology.json)`
          );
          steps.push({
            icon: createResult.success ? '✅' : '❌',
            message: createResult.message,
          });
          if (createResult.success) addedCount += 1;
          else results.success = false;
        }
      }

      if (!results.success && missingRsCount === targets.length) {
        results.summary = '❌ No matching PingOne resource servers found';
      } else if (!results.success) {
        results.summary = '⚠️ Some scope updates failed';
      } else if (addedCount === 0) {
        results.summary = '✅ All expected PingOne scopes already present';
      } else {
        results.summary = `✅ Added ${addedCount} missing PingOne scope(s)`;
      }

      return results;
    } catch (error) {
      steps.push({
        icon: '❌',
        message: `Error: ${error.message}`,
      });
      results.success = false;
      results.summary = `Failed: ${error.message}`;
      return results;
    }
  }

}

module.exports = PingOneScopeUpdateService;
module.exports.resolveAudienceTargets = resolveAudienceTargets;
module.exports.findResourceForTarget = findResourceForTarget;
