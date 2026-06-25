/**
 * ResourceConsent.js
 *
 * RFC 9728 Resource Consent Display Component
 * Shows users what resources and scopes will be requested during OAuth authorization.
 */

import React from 'react';

const ResourceConsent = ({ resources, scopes = [], onProceed, onCancel, loading = false }) => {
  const getScopesForResource = (resourceUri, allScopes) => {
    // Filter scopes that are relevant to this resource
    return allScopes.filter(scope => {
      // Simple scope-to-resource mapping
      if (resourceUri.includes('banking-api') && scope.startsWith('')) return true;
      if (resourceUri.includes('mcp-server') && (scope.startsWith('ai:') || scope.startsWith('mcp:'))) return true;
      if (resourceUri.includes('admin-api') && scope.startsWith('admin:')) return true;
      if (resourceUri.includes('config-api') && scope.startsWith('config:')) return true;
      return false;
    });
  };

  const getResourceIcon = (resourceUri) => {
    if (resourceUri.includes('banking-api')) return '🏦';
    if (resourceUri.includes('mcp-server')) return '🤖';
    if (resourceUri.includes('admin-api')) return '⚙️';
    if (resourceUri.includes('config-api')) return '🔧';
    return '🌐';
  };

  const getResourceName = (resourceUri) => {
    if (resourceUri.includes('banking-api')) return 'Banking API';
    if (resourceUri.includes('mcp-server')) return 'AI Agent Server';
    if (resourceUri.includes('admin-api')) return 'Admin API';
    if (resourceUri.includes('config-api')) return 'Configuration API';
    return 'Unknown Resource';
  };

  if (!resources || resources.length === 0) {
    return (
      <div className="resource-consent empty">
        <h3>Resource Access Consent</h3>
        <p>No resources selected for access.</p>
        <div className="consent-actions">
          <button type="button" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="resource-consent">
      <div className="consent-header">
        <h3>Resource Access Consent</h3>
        <p>
          This application is requesting access to the following resources. 
          Review the permissions and scopes before proceeding.
        </p>
      </div>

      <div className="consent-resources">
        {resources.map(resourceUri => {
          const resourceScopes = getScopesForResource(resourceUri, scopes);
          return (
            <div key={resourceUri} className="consent-resource">
              <div className="resource-header">
                <div className="resource-icon">{getResourceIcon(resourceUri)}</div>
                <div className="resource-info">
                  <h4 className="resource-name">{getResourceName(resourceUri)}</h4>
                  <div className="resource-uri">{resourceUri}</div>
                </div>
              </div>

              {resourceScopes.length > 0 && (
                <div className="resource-scopes">
                  <h5>Requested Scopes:</h5>
                  <div className="scopes-list">
                    {resourceScopes.map(scope => (
                      <div key={scope} className="scope-item">
                        <span className="scope-name">{scope}</span>
                        <span className="scope-description">
                          {getScopeDescription(scope)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="consent-summary">
        <div className="summary-stats">
          <div className="stat">
            <span className="stat-label">Resources:</span>
            <span className="stat-value">{resources.length}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Scopes:</span>
            <span className="stat-value">{scopes.length}</span>
          </div>
        </div>
      </div>

      <div className="consent-warning">
        <div className="warning-icon">⚠️</div>
        <div className="warning-text">
          By proceeding, you authorize this application to access the specified resources 
          with the listed permissions. You can revoke this access at any time from your account settings.
        </div>
      </div>

      <div className="consent-actions">
        <button 
          type="button" 
          onClick={onCancel} 
          disabled={loading}
          className="cancel-btn"
        >
          Cancel
        </button>
        <button 
          type="button" 
          onClick={onProceed} 
          disabled={loading}
          className="proceed-btn"
        >
          {loading ? 'Authorizing...' : 'Authorize Access'}
        </button>
      </div>
    </div>
  );
};

const getScopeDescription = (scope) => {
  const descriptions = {
    'read': 'Read banking data and account information',
    'write': 'Perform banking operations and transactions',
    'transactions:read': 'View transaction history and details',
    'accounts:read': 'Access account information and balances',
    'ai:act': 'Perform AI agent actions and operations',
    'ai:read': 'Read AI agent data and configurations',
    'ai:write': 'Modify AI agent settings and data',
    'agent:manage': 'Manage AI agent configurations',
    'mcp:read': 'Read MCP server data',
    'mcp:write': 'Write to MCP server',
    'admin:read': 'Read administrative data and system status',
    'admin:write': 'Modify administrative settings',
    'admin:delete': 'Delete administrative resources',
    'users:read': 'Read user profiles and information',
    'users:manage': 'Manage user accounts and permissions',
    'config:read': 'Read system configuration',
    'config:write': 'Modify system configuration',
    'settings:manage': 'Manage system settings'
  };

  return descriptions[scope] || 'Access to system resource';
};

export default ResourceConsent;
