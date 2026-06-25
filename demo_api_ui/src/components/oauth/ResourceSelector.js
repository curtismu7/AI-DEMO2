/**
 * ResourceSelector.js
 *
 * RFC 9728 Resource Indicators UI Component
 * Allows users to select resources for OAuth authorization with resource indicators.
 */

import React, { useState, useEffect } from 'react';
import { useResourceIndicators } from '../../hooks/useResourceIndicators';

const ResourceCard = ({ resource, selected, onToggle, disabled = false }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`resource-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => !disabled && onToggle(resource.uri)}
    >
      <div className="resource-header">
        <div className="resource-icon">{resource.icon}</div>
        <div className="resource-info">
          <h4 className="resource-name">{resource.name}</h4>
          <div className="resource-uri">{resource.uri}</div>
        </div>
        <div className="resource-checkbox">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(resource.uri)}
            disabled={disabled}
          />
        </div>
      </div>
      
      <div className="resource-description">
        {resource.description}
      </div>
      
      <div className="resource-scopes">
        <span className="scopes-label">Required scopes:</span>
        <div className="scopes-list">
          {resource.scopes.map(scope => (
            <span key={scope} className="scope-badge">
              {scope}
            </span>
          ))}
        </div>
      </div>
      
      {isHovered && (
        <div className="resource-tooltip">
          Click to {selected ? 'deselect' : 'select'} this resource
        </div>
      )}
    </div>
  );
};

const ResourceSelector = ({ 
  clientId, 
  selectedResources = [], 
  onSelectionChange, 
  maxResources = 3,
  disabled = false 
}) => {
  const {
    availableResources,
    loading,
    error,
    validateSelection
  } = useResourceIndicators(clientId);

  const [localErrors, setLocalErrors] = useState([]);
  const [localWarnings, setLocalWarnings] = useState([]);

  useEffect(() => {
    if (selectedResources.length > 0) {
      const validation = validateSelection(selectedResources);
      setLocalErrors(validation.errors);
      setLocalWarnings(validation.warnings);
    } else {
      setLocalErrors([]);
      setLocalWarnings([]);
    }
  }, [selectedResources, validateSelection]);

  const handleResourceToggle = (resourceUri) => {
    if (disabled) return;

    const isSelected = selectedResources.includes(resourceUri);
    let newSelection;

    if (isSelected) {
      // Remove resource
      newSelection = selectedResources.filter(r => r !== resourceUri);
    } else {
      // Add resource if under limit
      if (selectedResources.length >= maxResources) {
        setLocalErrors([`Maximum ${maxResources} resources allowed`]);
        return;
      }
      newSelection = [...selectedResources, resourceUri];
    }

    // Validate new selection
    const validation = validateSelection(newSelection);
    
    if (validation.valid) {
      setLocalErrors([]);
      setLocalWarnings(validation.warnings);
      onSelectionChange(newSelection);
    } else {
      setLocalErrors(validation.errors);
      setLocalWarnings(validation.warnings);
    }
  };

  const groupResourcesByCategory = (resources) => {
    return resources.reduce((groups, resource) => {
      const category = resource.category || 'other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(resource);
      return groups;
    }, {});
  };

  if (loading) {
    return (
      <div className="resource-selector loading">
        <div className="loading-spinner">Loading resources...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="resource-selector error">
        <div className="error-message">
          Failed to load resources: {error.message}
        </div>
      </div>
    );
  }

  if (availableResources.length === 0) {
    return (
      <div className="resource-selector empty">
        <div className="empty-message">
          No resources available for this client
        </div>
      </div>
    );
  }

  const groupedResources = groupResourcesByCategory(availableResources);
  const selectedCount = selectedResources.length;

  return (
    <div className="resource-selector">
      <div className="resource-selector-header">
        <h3>Select Resources to Access</h3>
        <div className="resource-counter">
          {selectedCount} / {maxResources} selected
        </div>
      </div>

      <div className="resource-description">
        Choose which resources this application should access. Each resource has specific 
        permissions and scopes that will be requested during authorization.
      </div>

      {localErrors.length > 0 && (
        <div className="resource-errors">
          {localErrors.map((error, index) => (
            <div key={index} className="error-item">
              ⚠️ {error}
            </div>
          ))}
        </div>
      )}

      {localWarnings.length > 0 && (
        <div className="resource-warnings">
          {localWarnings.map((warning, index) => (
            <div key={index} className="warning-item">
              ℹ️ {warning}
            </div>
          ))}
        </div>
      )}

      <div className="resource-grid">
        {Object.entries(groupedResources).map(([category, resources]) => (
          <div key={category} className="resource-category">
            <h4 className="category-title">
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </h4>
            <div className="category-resources">
              {resources.map(resource => (
                <ResourceCard
                  key={resource.uri}
                  resource={resource}
                  selected={selectedResources.includes(resource.uri)}
                  onToggle={handleResourceToggle}
                  disabled={disabled || (selectedCount >= maxResources && !selectedResources.includes(resource.uri))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="resource-selector-footer">
        <div className="selection-summary">
          {selectedCount === 0 ? (
            <span className="no-selection">
              No resources selected. At least one resource is recommended.
            </span>
          ) : (
            <span className="has-selection">
              {selectedCount} resource{selectedCount !== 1 ? 's' : ''} selected
            </span>
          )}
        </div>
        
        {selectedCount > 0 && (
          <button
            className="clear-selection-btn"
            onClick={() => onSelectionChange([])}
            disabled={disabled}
          >
            Clear Selection
          </button>
        )}
      </div>
    </div>
  );
};

export default ResourceSelector;
