import React, { useState, useRef, useEffect } from 'react';
import { MdPerson, MdSettings, MdNotifications, MdLogout, MdLogin, MdArrowDropDown } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';
import './UserMenu.css';
import NotificationsPanel from './NotificationsPanel';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import { useSessionToken } from '../context/SessionTokenContext';
import FunAvatar from './FunAvatar';

export default function UserMenu({ user, onLogout, isAdminView = false, onSwitchView }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState('menu');
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const { hasActiveToken } = useSessionToken();

  const closeMenu = () => {
    setIsOpen(false);
    setView('menu');
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setView('menu');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    closeMenu();
    onLogout();
  };

  const handleLogin = () => {
    closeMenu();
    navigateToCustomerOAuthLogin();
  };

  const goTo = (path) => {
    closeMenu();
    navigate(path);
  };

  // /settings is admin-gated (RequireAdminLogin); /security is the customer surface.
  const settingsPath = isAdminView ? '/settings' : '/security';

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="User menu"
        type="button"
      >
        <div className="user-menu-avatar">
          <FunAvatar seed={user?.id || user?.email} size={32} />
        </div>
        <MdArrowDropDown className="user-menu-dropdown-icon" />
      </button>

      {isOpen && view === 'notifications' && (
        <div className="user-menu-dropdown">
          <NotificationsPanel
            prefs={user?.notificationPrefs}
            onBack={() => setView('menu')}
          />
        </div>
      )}

      {isOpen && view === 'menu' && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-avatar user-menu-avatar-large">
              <FunAvatar seed={user?.id || user?.email} size={48} />
            </div>
            <div className="user-menu-info">
              <div className="user-menu-name">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="user-menu-email">{user?.email || ''}</div>
              {user?.id && (
                <div className="user-menu-userid" title="User ID">{user.id}</div>
              )}
              <div className="user-menu-role">
                {user?.role === 'admin' ? 'Admin' : 'Customer'}
              </div>
            </div>
          </div>

          <div className="user-menu-divider"></div>

          <div className="user-menu-items">
            <button className="user-menu-item" type="button" onClick={() => goTo('/profile')}>
              <MdPerson className="user-menu-item-icon" />
              <span>Profile</span>
            </button>
            <button className="user-menu-item" type="button" onClick={() => setView('notifications')}>
              <MdNotifications className="user-menu-item-icon" />
              <span>Preferences</span>
            </button>
            <button className="user-menu-item" type="button" onClick={() => goTo(settingsPath)}>
              <MdSettings className="user-menu-item-icon" />
              <span>Settings</span>
            </button>
          </div>

          {onSwitchView && (
            <button
              className="user-menu-item"
              type="button"
              onClick={() => { setIsOpen(false); onSwitchView(); }}
            >
              <span className="user-menu-item-icon">↔</span>
              <span>{isAdminView ? 'Switch to Customer View' : 'Switch to Admin View'}</span>
            </button>
          )}

          <div className="user-menu-divider"></div>

          {hasActiveToken ? (
            <button className="user-menu-item user-menu-item-danger" onClick={handleLogout} type="button">
              <MdLogout className="user-menu-item-icon" />
              <span>Sign Out</span>
            </button>
          ) : (
            <button className="user-menu-item user-menu-item-primary" onClick={handleLogin} type="button">
              <MdLogin className="user-menu-item-icon" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
