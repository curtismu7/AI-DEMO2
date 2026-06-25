// banking_api_ui/src/components/dashboard/DashboardHero.js
import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useVertical } from '../../vertical/useVertical';
import { useAgentConfig } from '../hooks/useAgentConfig';

const DashboardHero = () => {
  const { user, isAuthenticated } = useAuth();
  const { activeId: currentVertical, pageManifest } = useVertical();
  const verticalName = pageManifest?.identity?.displayName || 'Banking';
  const { agentConfig } = useAgentConfig();
  
  const [greeting, setGreeting] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isLoaded, setIsLoaded] = useState(false);

  // Update greeting based on time of day
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now);
      
      const hour = now.getHours();
      let newGreeting = '';
      
      if (hour < 12) {
        newGreeting = 'Good morning';
      } else if (hour < 18) {
        newGreeting = 'Good afternoon';
      } else {
        newGreeting = 'Good evening';
      }
      
      setGreeting(newGreeting);
    };

    updateTime();
    const timer = setInterval(updateTime, 60000); // Update every minute
    
    return () => clearInterval(timer);
  }, []);

  // Trigger animation after mount
  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Get contextual message based on user state
  const getContextualMessage = () => {
    if (!isAuthenticated) {
      return 'Sign in to access your secure banking dashboard';
    }
    
    if (!user) {
      return 'Loading your profile...';
    }
    
    const firstName = user.given_name || user.name || 'there';
    
    // Vertical-specific messages
    switch (currentVertical) {
      case 'retail':
        return `${firstName}, manage your retail operations with confidence`;
      case 'workforce':
        return `${firstName}, streamline your workforce management`;
      case 'banking':
      default:
        return `${firstName}, welcome to your secure banking dashboard`;
    }
  };

  // Get vertical-specific value proposition
  const getValueProposition = () => {
    switch (currentVertical) {
      case 'retail':
        return 'Complete retail management with secure transactions, inventory tracking, and customer insights';
      case 'workforce':
        return 'Streamline HR operations with secure employee management, payroll, and compliance tools';
      case 'banking':
      default:
        return 'Secure banking with real-time transactions, advanced security, and intelligent financial insights';
    }
  };

  // Get vertical-specific features
  const getFeatures = () => {
    switch (currentVertical) {
      case 'retail':
        return [
          { icon: '💳', label: 'Secure Payments' },
          { icon: '📊', label: 'Sales Analytics' },
          { icon: '📦', label: 'Inventory Management' },
          { icon: '👥', label: 'Customer Insights' }
        ];
      case 'workforce':
        return [
          { icon: '👤', label: 'Employee Management' },
          { icon: '💰', label: 'Payroll Processing' },
          { icon: '📈', label: 'Performance Analytics' },
          { icon: '🔐', label: 'Compliance Tools' }
        ];
      case 'banking':
      default:
        return [
          { icon: '💰', label: 'Real-time Balances' },
          { icon: '🔒', label: 'Advanced Security' },
          { icon: '📊', label: 'Financial Insights' },
          { icon: '🤖', label: 'AI Assistant' }
        ];
    }
  };

  const features = getFeatures();
  const contextualMessage = getContextualMessage();
  const valueProposition = getValueProposition();

  return (
    <header className="dashboard-hero">
      <div className="dashboard-hero__container">
        <div className="dashboard-hero__content">
          {/* Welcome Message */}
          <div className={`dashboard-hero__welcome ${isLoaded ? 'loaded' : ''}`}>
            <div className="dashboard-hero__time">
              <span className="dashboard-hero__greeting">{greeting}</span>
              <span className="dashboard-hero__clock">
                {currentTime.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                })}
              </span>
            </div>
            
            {isAuthenticated && user && (
              <h1 className="dashboard-hero__title">
                {contextualMessage}
              </h1>
            )}
          </div>

          {/* Value Proposition */}
          <div className={`dashboard-hero__value-prop ${isLoaded ? 'loaded' : ''}`}>
            <p className="dashboard-hero__description">
              {valueProposition}
            </p>
            
            {/* Quick Stats */}
            {isAuthenticated && (
              <div className="dashboard-hero__stats">
                <div className="dashboard-hero__stat">
                  <span className="dashboard-hero__stat-label">Accounts</span>
                  <span className="dashboard-hero__stat-value">4</span>
                </div>
                <div className="dashboard-hero__stat">
                  <span className="dashboard-hero__stat-label">Security</span>
                  <span className="dashboard-hero__stat-value">Active</span>
                </div>
                <div className="dashboard-hero__stat">
                  <span className="dashboard-hero__stat-label">AI</span>
                  <span className="dashboard-hero__stat-value">
                    {agentConfig?.enabled ? 'Ready' : 'Off'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Call to Actions */}
          <div className={`dashboard-hero__actions ${isLoaded ? 'loaded' : ''}`}>
            {isAuthenticated ? (
              <div className="dashboard-hero__primary-actions">
                <button
                  type="button"
                  className="dashboard-hero__btn dashboard-hero__btn--primary"
                  onClick={() => {
                    // Navigate to accounts or main action
                    window.location.hash = '#accounts';
                  }}
                >
                  View Accounts
                </button>
                
                <button
                  type="button"
                  className="dashboard-hero__btn dashboard-hero__btn--secondary"
                  onClick={() => {
                    // Open agent if enabled
                    if (agentConfig?.enabled) {
                      window.dispatchEvent(new CustomEvent('openAgent'));
                    }
                  }}
                  disabled={!agentConfig?.enabled}
                >
                  {agentConfig?.enabled ? 'Open AI Assistant' : 'AI Assistant Disabled'}
                </button>
              </div>
            ) : (
              <div className="dashboard-hero__auth-actions">
                <button
                  type="button"
                  className="dashboard-hero__btn dashboard-hero__btn--primary dashboard-hero__btn--large"
                  onClick={() => {
                    // Trigger login
                    window.location.hash = '#login';
                  }}
                >
                  Sign In to Get Started
                </button>
                
                <button
                  type="button"
                  className="dashboard-hero__btn dashboard-hero__btn--outline"
                  onClick={() => {
                    // Navigate to demo info
                    window.location.hash = '#demo';
                  }}
                >
                  Learn More
                </button>
              </div>
            )}
            
            <div className="dashboard-hero__secondary-actions">
              <button
                type="button"
                className="dashboard-hero__link"
                onClick={() => {
                  // Open education drawer
                  window.dispatchEvent(new CustomEvent('openEducation'));
                }}
              >
                Learn About {verticalName}
              </button>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className={`dashboard-hero__features ${isLoaded ? 'loaded' : ''}`}>
          <div className="dashboard-hero__features-grid">
            {features.map((feature, index) => (
              <div
                key={feature.label}
                className="dashboard-hero__feature"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="dashboard-hero__feature-icon">
                  {feature.icon}
                </div>
                <span className="dashboard-hero__feature-label">
                  {feature.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Background Elements */}
      <div className="dashboard-hero__background">
        <div className="dashboard-hero__gradient"></div>
        <div className="dashboard-hero__pattern"></div>
      </div>

      {/* Vertical Branding */}
      {currentVertical && (
        <div className="dashboard-hero__vertical-badge">
          <span className="dashboard-hero__vertical-name">
            {verticalName}
          </span>
        </div>
      )}
    </header>
  );
};

export default DashboardHero;
