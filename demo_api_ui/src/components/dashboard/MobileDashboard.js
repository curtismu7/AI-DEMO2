// banking_api_ui/src/components/dashboard/MobileDashboard.js
import React, { useState, useEffect } from 'react';
import { performLogout } from '../../services/logout';
import { useAuth } from '../auth/AuthContext';
import { useVertical } from '../../vertical/useVertical';
import DashboardHero from './DashboardHero';
import AccountSummary from './AccountSummary';
import ActionHub from './ActionHub';
import MobileNavigation from './MobileNavigation';
import './MobileDashboard.css';

const MobileDashboard = ({ 
  user, 
  accounts, 
  isDemoMode, 
  onNavigateToLogin,
  onNavigateToAccounts,
  onOpenAgent,
  onOpenEducation 
}) => {
  const { isAuthenticated } = useAuth();
  const { activeId: currentVertical, pageManifest } = useVertical();
  const verticalName = pageManifest?.identity?.displayName || 'Banking';
  const [activeTab, setActiveTab] = useState('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Handle tab navigation
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsMenuOpen(false);
  };

  // Handle menu toggle
  const handleMenuToggle = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen && !event.target.closest('.mobile-dashboard')) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMenuOpen]);

  // Get tab content
  const getTabContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <div className="mobile-dashboard__tab-content">
            <DashboardHero />
            <ActionHub 
              onNavigateToAccounts={onNavigateToAccounts}
              onOpenAgent={onOpenAgent}
              onOpenEducation={onOpenEducation}
            />
          </div>
        );
      case 'accounts':
        return (
          <div className="mobile-dashboard__tab-content">
            <AccountSummary 
              accounts={accounts}
              isDemoMode={isDemoMode}
              onNavigateToLogin={onNavigateToLogin}
            />
          </div>
        );
      case 'agent':
        return (
          <div className="mobile-dashboard__tab-content">
            <div className="mobile-dashboard__agent-placeholder">
              <h3>AI Assistant</h3>
              <p>Get help from your AI assistant for banking questions and tasks.</p>
              <button
                type="button"
                className="mobile-dashboard__btn mobile-dashboard__btn--primary"
                onClick={onOpenAgent}
              >
                Open AI Assistant
              </button>
            </div>
          </div>
        );
      case 'more':
        return (
          <div className="mobile-dashboard__tab-content">
            <div className="mobile-dashboard__more-menu">
              <div className="mobile-dashboard__more-section">
                <h4>Learning</h4>
                <button
                  type="button"
                  className="mobile-dashboard__more-item"
                  onClick={onOpenEducation}
                >
                  <span className="mobile-dashboard__more-icon">📚</span>
                  <span>Education Center</span>
                </button>
              </div>
              
              <div className="mobile-dashboard__more-section">
                <h4>Settings</h4>
                <button
                  type="button"
                  className="mobile-dashboard__more-item"
                  onClick={() => window.location.hash = '#settings'}
                >
                  <span className="mobile-dashboard__more-icon">⚙️</span>
                  <span>Settings</span>
                </button>
                <button
                  type="button"
                  className="mobile-dashboard__more-item"
                  onClick={() => window.location.hash = '#demo'}
                >
                  <span className="mobile-dashboard__more-icon">🔧</span>
                  <span>Demo Settings</span>
                </button>
              </div>

              {isAuthenticated && (
                <div className="mobile-dashboard__more-section">
                  <h4>Account</h4>
                  <button
                    type="button"
                    className="mobile-dashboard__more-item"
                    onClick={() => window.location.hash = '#profile'}
                  >
                    <span className="mobile-dashboard__more-icon">👤</span>
                    <span>Profile</span>
                  </button>
                  <button
                    type="button"
                    className="mobile-dashboard__more-item mobile-dashboard__more-item--danger"
                    onClick={performLogout}
                  >
                    <span className="mobile-dashboard__more-icon">🚪</span>
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`mobile-dashboard ${isMenuOpen ? 'mobile-dashboard--menu-open' : ''}`}>
      {/* Header */}
      <header className="mobile-dashboard__header">
        <div className="mobile-dashboard__header-content">
          <div className="mobile-dashboard__header-left">
            <button
              type="button"
              className="mobile-dashboard__menu-btn"
              onClick={handleMenuToggle}
              aria-label="Toggle menu"
            >
              <span className={`mobile-dashboard__menu-icon ${isMenuOpen ? 'mobile-dashboard__menu-icon--open' : ''}`}>
                ☰
              </span>
            </button>
            
            <h1 className="mobile-dashboard__title">
              {verticalName}
            </h1>
          </div>

          <div className="mobile-dashboard__header-right">
            {isAuthenticated && (
              <div className="mobile-dashboard__user-info">
                <span className="mobile-dashboard__user-avatar">
                  {user?.given_name?.[0] || user?.name?.[0] || 'U'}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mobile-dashboard__main">
        {getTabContent()}
      </main>

      {/* Mobile Navigation */}
      <MobileNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isAuthenticated={isAuthenticated}
        currentVertical={currentVertical}
      />

      {/* Slide-out Menu */}
      <div className={`mobile-dashboard__slide-menu ${isMenuOpen ? 'mobile-dashboard__slide-menu--open' : ''}`}>
        <div className="mobile-dashboard__slide-menu-content">
          <div className="mobile-dashboard__slide-menu-header">
            <h2>Menu</h2>
            <button
              type="button"
              className="mobile-dashboard__slide-menu-close"
              onClick={handleMenuToggle}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          <nav className="mobile-dashboard__slide-menu-nav">
            <button
              type="button"
              className={`mobile-dashboard__slide-menu-item ${activeTab === 'home' ? 'mobile-dashboard__slide-menu-item--active' : ''}`}
              onClick={() => handleTabChange('home')}
            >
              <span className="mobile-dashboard__slide-menu-icon">🏠</span>
              <span>Home</span>
            </button>

            <button
              type="button"
              className={`mobile-dashboard__slide-menu-item ${activeTab === 'accounts' ? 'mobile-dashboard__slide-menu-item--active' : ''}`}
              onClick={() => handleTabChange('accounts')}
            >
              <span className="mobile-dashboard__slide-menu-icon">💳</span>
              <span>Accounts</span>
            </button>

            <button
              type="button"
              className={`mobile-dashboard__slide-menu-item ${activeTab === 'agent' ? 'mobile-dashboard__slide-menu-item--active' : ''}`}
              onClick={() => handleTabChange('agent')}
            >
              <span className="mobile-dashboard__slide-menu-icon">🤖</span>
              <span>AI Assistant</span>
            </button>

            <button
              type="button"
              className={`mobile-dashboard__slide-menu-item ${activeTab === 'more' ? 'mobile-dashboard__slide-menu-item--active' : ''}`}
              onClick={() => handleTabChange('more')}
            >
              <span className="mobile-dashboard__slide-menu-icon">⋯</span>
              <span>More</span>
            </button>
          </nav>

          <div className="mobile-dashboard__slide-menu-footer">
            {isAuthenticated ? (
              <div className="mobile-dashboard__slide-menu-user">
                <div className="mobile-dashboard__slide-menu-user-info">
                  <span className="mobile-dashboard__slide-menu-user-avatar">
                    {user?.given_name?.[0] || user?.name?.[0] || 'U'}
                  </span>
                  <span className="mobile-dashboard__slide-menu-user-name">
                    {user?.given_name || user?.name || 'User'}
                  </span>
                </div>
                <button
                  type="button"
                  className="mobile-dashboard__slide-menu-signout"
                  onClick={performLogout}
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="mobile-dashboard__slide-menu-auth">
                <button
                  type="button"
                  className="mobile-dashboard__slide-menu-signin"
                  onClick={onNavigateToLogin}
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlay */}
      {isMenuOpen && (
        <div 
          className="mobile-dashboard__overlay"
          onClick={handleMenuToggle}
        />
      )}
    </div>
  );
};

export default MobileDashboard;
