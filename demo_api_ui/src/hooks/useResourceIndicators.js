/**
 * useResourceIndicators.js
 *
 * Custom hook for RFC 9728 Resource Indicators
 * Provides resource management functionality for OAuth flows.
 */

import { useState, useEffect, useCallback } from 'react';

// Mock API service - replace with actual API calls
const resourceApiService = {
  getAvailableResources: async (clientId) => {
    // This would be an actual API call to get resources for the client
    // For now, return mock data based on the resource definitions
    const mockResources = {
      'banking-demo-client': [
        {
          uri: 'enduser.ping.demo/',
          name: 'Banking API',
          description: 'Core banking operations and account management',
          scopes: ['read', 'write', 'transactions:read', 'accounts:read'],
          icon: '🏦',
          category: 'core',
          required: false
        },
        {
          uri: 'mcpserver.ping.demo/',
          name: 'AI Agent Server',
          description: 'AI agent and MCP protocol server',
          scopes: ['ai:act', 'ai:read', 'ai:write', 'agent:manage'],
          icon: '🤖',
          category: 'ai',
          required: false
        }
      ],
      'admin-client': [
        {
          uri: 'https://admin-api.ping.demo/',
          name: 'Admin API',
          description: 'Administrative operations and user management',
          scopes: ['admin:read', 'admin:write', 'users:manage', 'config:read'],
          icon: '⚙️',
          category: 'admin',
          required: false
        },
        {
          uri: 'https://config-api.ping.demo/',
          name: 'Configuration API',
          description: 'System configuration and settings',
          scopes: ['config:read', 'config:write', 'settings:manage'],
          icon: '🔧',
          category: 'config',
          required: false
        }
      ]
    };

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return mockResources[clientId] || [];
  },

  validateResourceSelection: async (clientId, resources) => {
    // This would be an actual API call to validate resource selection
    // For now, return mock validation
    const errors = [];
    const warnings = [];

    // Validate resource count
    if (resources.length > 3) {
      errors.push('Maximum 3 resources allowed');
    }

    // Validate resource format
    for (const resource of resources) {
      try {
        new URL(resource);
        if (!resource.startsWith('https://')) {
          errors.push(`Invalid resource format: ${resource}`);
        }
      } catch {
        errors.push(`Invalid resource URI: ${resource}`);
      }
    }

    // Check for unknown resources
    const knownResources = [
      'enduser.ping.demo/',
      'mcpserver.ping.demo/',
      'https://admin-api.ping.demo/',
      'https://config-api.ping.demo/'
    ];

    for (const resource of resources) {
      if (!knownResources.includes(resource)) {
        warnings.push(`Unknown resource: ${resource}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      allowedResources: resources.filter(resource => 
        knownResources.includes(resource) && resource.startsWith('https://')
      )
    };
  },

  getDefaultResources: async (clientId) => {
    // Get default resources for client
    const defaults = {
      'banking-demo-client': ['enduser.ping.demo/'],
      'admin-client': ['https://admin-api.ping.demo/']
    };

    return defaults[clientId] || [];
  }
};

export const useResourceIndicators = (clientId) => {
  const [availableResources, setAvailableResources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load available resources for client.
  // Accepts an optional cancellation token so the effect can guard stale resolves.
  const loadResources = useCallback(async ({ cancelled } = {}) => {
    if (!clientId) return;

    setLoading(true);
    setError(null);

    try {
      const resources = await resourceApiService.getAvailableResources(clientId);
      // Guard: skip setState if a newer clientId change cancelled this load
      if (cancelled?.value) return;
      setAvailableResources(resources);
    } catch (err) {
      if (cancelled?.value) return;
      setError(err);
      console.error('Failed to load resources:', err);
    } finally {
      if (!cancelled?.value) setLoading(false);
    }
  }, [clientId]);

  // Validate resource selection
  const validateSelection = useCallback(async (resources) => {
    if (!clientId) {
      return { valid: false, errors: ['Client ID required'], warnings: [], allowedResources: [] };
    }

    try {
      return await resourceApiService.validateResourceSelection(clientId, resources);
    } catch (err) {
      console.error('Resource validation failed:', err);
      return { valid: false, errors: ['Validation failed'], warnings: [], allowedResources: [] };
    }
  }, [clientId]);

  // Get default resources
  const getDefaultResources = useCallback(async () => {
    if (!clientId) return [];

    try {
      return await resourceApiService.getDefaultResources(clientId);
    } catch (err) {
      console.error('Failed to get default resources:', err);
      return [];
    }
  }, [clientId]);

  // Filter scopes by resources
  const filterScopesByResources = useCallback((scopes, resources) => {
    if (!resources || resources.length === 0) return scopes;

    return scopes.filter(scope => {
      return resources.some(resource => {
        if (resource.includes('banking-api') && scope.startsWith('')) return true;
        if (resource.includes('mcp-server') && (scope.startsWith('ai:') || scope.startsWith('mcp:'))) return true;
        if (resource.includes('admin-api') && scope.startsWith('admin:')) return true;
        if (resource.includes('config-api') && scope.startsWith('config:')) return true;
        return false;
      });
    });
  }, []);

  // Get resource by URI
  const getResourceByUri = useCallback((uri) => {
    return availableResources.find(resource => resource.uri === uri);
  }, [availableResources]);

  // Check if resource indicators are enabled
  const isEnabled = useCallback(() => {
    // This could be a configuration check
    return process.env.REACT_APP_RFC_9728_ENABLED === 'true';
  }, []);

  // Load resources when client ID changes.
  // cancelled token prevents stale async resolves from overwriting newer state.
  useEffect(() => {
    if (clientId && isEnabled()) {
      const cancelled = { value: false };
      loadResources({ cancelled });
      return () => { cancelled.value = true; };
    } else {
      setAvailableResources([]);
    }
  }, [clientId, loadResources, isEnabled]);

  return {
    // Data
    availableResources,
    loading,
    error,
    
    // Actions
    loadResources,
    validateSelection,
    getDefaultResources,
    filterScopesByResources,
    getResourceByUri,
    
    // Status
    isEnabled
  };
};

export default useResourceIndicators;
