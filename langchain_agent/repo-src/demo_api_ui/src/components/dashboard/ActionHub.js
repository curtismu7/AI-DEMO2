// banking_api_ui/src/components/dashboard/ActionHub.js
import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useVertical } from '../../vertical/useVertical';
import { useAgentConfig } from '../hooks/useAgentConfig';
import './ActionHub.css';

const ActionHub = ({ onNavigateToAccounts, onOpenAgent, onOpenEducation }) => {
  const { isAuthenticated } = useAuth();
  const { activeId: currentVertical, pageManifest } = useVertical();
  const verticalName = pageManifest?.identity?.displayName || 'Banking';
  const { agentConfig } = useAgentConfig();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Get vertical-specific primary actions
  const getPrimaryActions = () => {
    switch (currentVertical) {
      case 'retail':
        return [
          {
            id: 'sales',
            label: 'View Sales',
            icon: '📊',
            description: 'Track daily sales performance',
            primary: true,
            onClick: () => onNavigateToAccounts?.()
          },
          {
            id: 'inventory',
            label: 'Manage Inventory',
            icon: '📦',
            description: 'Update stock levels and products',
            primary: true,
            onClick: () => onNavigateToAccounts?.()
          },
          {
            id: 'customers',
            label: 'Customer Insights',
            icon: '👥',
            description: 'Analyze customer behavior',
            primary: false,
            onClick: () => onNavigateToAccounts?.()
          }
        ];
      case 'workforce':
        return [
          {
            id: 'employees',
            label: 'Manage Employees',
            icon: '👤',
            description: 'View and manage employee data',
            primary: true,
            onClick: () => onNavigateToAccounts?.()
          },
          {
            id: 'payroll',
            label: 'Process Payroll',
            icon: '💰',
            description: 'Run payroll and manage compensation',
            primary: true,
            onClick: () => onNavigateToAccounts?.()
          },
          {
            id: 'benefits',
            label: 'Benefits Admin',
            icon: '🏥',
            description: 'Manage employee benefits',
            primary: false,
            onClick: () => onNavigateToAccounts?.()
          }
        ];
      case 'banking':
      default:
        return [
          {
            id: 'accounts',
            label: 'View Accounts',
            icon: '💳',
            description: 'Check balances and transactions',
            primary: true,
            onClick: () => onNavigateToAccounts?.()
          },
          {
            id: 'transfer',
            label: 'Transfer Money',
            icon: '💸',
            description: 'Send money between accounts',
            primary: true,
            onClick: () => onNavigateToAccounts?.()
          },
          {
            id: 'deposit',
            label: 'Make Deposit',
            icon: '📥',
            description: 'Add funds to your accounts',
            primary: false,
            onClick: () => onNavigateToAccounts?.()
          }
        ];
    }
  };

  // Get secondary actions
  const getSecondaryActions = () => {
    const actions = [
      {
        id: 'agent',
        label: 'AI Assistant',
        icon: '🤖',
        description: agentConfig?.enabled ? 'Get help from AI assistant' : 'AI assistant disabled',
        onClick: () => agentConfig?.enabled && onOpenAgent?.(),
        disabled: !agentConfig?.enabled
      },
      {
        id: 'education',
        label: 'Learn More',
        icon: '📚',
        description: `Learn about ${verticalName.toLowerCase()} features`,
        onClick: () => onOpenEducation?.()
      }
    ];

    // Add vertical-specific actions
    if (currentVertical === 'retail') {
      actions.push({
        id: 'reports',
        label: 'Reports',
        icon: '📈',
        description: 'Generate business reports',
        onClick: () => onNavigateToAccounts?.()
      });
    } else if (currentVertical === 'workforce') {
      actions.push({
        id: 'compliance',
        label: 'Compliance',
        icon: '🔐',
        description: 'Review compliance status',
        onClick: () => onNavigateToAccounts?.()
      });
    } else {
      actions.push({
        id: 'settings',
        label: 'Settings',
        icon: '⚙️',
        description: 'Manage account settings',
        onClick: () => onNavigateToAccounts?.()
      });
    }

    return actions;
  };

  const primaryActions = getPrimaryActions();
  const secondaryActions = getSecondaryActions();

  if (!isAuthenticated) {
    return (
      <div className="action-hub action-hub--unauthenticated">
        <div className="action-hub__content">
          <h2 className="action-hub__title">Get Started</h2>
          <p className="action-hub__subtitle">
            Sign in to access your {verticalName.toLowerCase()} dashboard
          </p>
          <div className="action-hub__actions">
            <button
              type="button"
              className="action-hub__btn action-hub__btn--primary action-hub__btn--large"
              onClick={() => {
  window.location.hash = '#login';
}}
            >
              Sign In
            </button>
            <button
              type="button"
              className="action-hub__btn action-hub__btn--secondary"
              onClick={() => onOpenEducation?.()}
            >
              Learn More
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`action-hub ${isLoaded ? 'action-hub--loaded' : ''}`}>
      <div className="action-hub__content">
        <div className="action-hub__header">
          <h2 className="action-hub__title">Quick Actions</h2>
          <p className="action-hub__subtitle">
            {currentVertical === 'retail' && 'Manage your store operations efficiently'}
            {currentVertical === 'workforce' && 'Handle your workforce management tasks'}
            {currentVertical === 'banking' && 'Manage your finances with ease'}
            {!currentVertical && 'Access your most important features quickly'}
          </p>
        </div>

        {/* Primary Actions */}
        <div className="action-hub__primary-actions">
          {primaryActions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={`action-hub__primary-btn ${action.primary ? 'action-hub__primary-btn--primary' : 'action-hub__primary-btn--secondary'}`}
              onClick={action.onClick}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="action-hub__primary-btn__icon">
                {action.icon}
              </div>
              <div className="action-hub__primary-btn__content">
                <span className="action-hub__primary-btn__label">{action.label}</span>
                <span className="action-hub__primary-btn__description">{action.description}</span>
              </div>
              <div className="action-hub__primary-btn__arrow">
                →
              </div>
            </button>
          ))}
        </div>

        {/* Secondary Actions */}
        <div className="action-hub__secondary-actions">
          <h3 className="action-hub__secondary-title">More Options</h3>
          <div className="action-hub__secondary-grid">
            {secondaryActions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={`action-hub__secondary-btn ${action.disabled ? 'action-hub__secondary-btn--disabled' : ''}`}
                onClick={action.onClick}
                disabled={action.disabled}
                style={{ animationDelay: `${(primaryActions.length + index) * 50}ms` }}
              >
                <div className="action-hub__secondary-btn__icon">
                  {action.icon}
                </div>
                <div className="action-hub__secondary-btn__content">
                  <span className="action-hub__secondary-btn__label">{action.label}</span>
                  <span className="action-hub__secondary-btn__description">{action.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Contextual Help */}
        <div className="action-hub__help">
          <div className="action-hub__help__icon">❓</div>
          <div className="action-hub__help__content">
            <h4>Need Help?</h4>
            <p>
              {currentVertical === 'retail' && 'Check our education panels for retail management tips and best practices.'}
              {currentVertical === 'workforce' && 'Learn more about workforce management and HR best practices in our education center.'}
              {currentVertical === 'banking' && 'Explore our education panels to learn about banking security and features.'}
              {!currentVertical && 'Explore our education panels to learn about all available features.'}
            </p>
            <button
              type="button"
              className="action-hub__help__btn"
              onClick={() => onOpenEducation?.()}
            >
              Browse Education
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionHub;
